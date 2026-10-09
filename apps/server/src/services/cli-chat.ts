import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { agentCatalog, jsonSchemaOf, type CatalogTool } from './agent-catalog.ts';
import { decisionsSince, propose, proposedText } from './proposals.ts';

/**
 * Project chat through an agent CLI (Claude Code, Codex, Grok, agy, opencode). The CLI keeps the
 * conversation in its own session, resumed every turn (see packages/ai cli-chat.ts). The CLIs'
 * own tools stay off; workbench tools are the same catalog pi and the CLI use, called through
 * the answer: the agent ends a reply with a `loca-tools` block, the server runs the tools (reads
 * at once, changes as proposals for this chat) and resumes the session with the results.
 * The browser receives the AI SDK UI message stream like any other chat.
 */
const MAX_ROUNDS = 8;
const RESULT_LIMIT = 20_000;
const TOOL_BLOCK = /```loca-tools[ \t]*\r?\n([\s\S]*?)```/g;

/** Instructions that teach the protocol, with every tool's input schema. */
export function toolProtocol(tools: CatalogTool[]) {
  const list = tools.map((tool) => `### ${tool.name}${tool.changes ? ' (변경: 제안으로 올라감)' : ''}\n${tool.description}\n입력 스키마: ${JSON.stringify(jsonSchemaOf(tool.schema))}`).join('\n\n');
  return [
    '## 작업실 도구 사용법',
    '이 대화에서는 당신의 셸·파일·웹 도구를 쓰지 않습니다. 프로젝트를 읽거나 바꾸려면 아래 작업실 도구를 씁니다.',
    '도구가 필요하면 답의 맨 끝에 다음 블록 하나를 쓰고 멈추세요. 블록 안은 JSON 배열이며 한 번에 여러 도구를 부를 수 있습니다:',
    '```loca-tools\n[{"tool": "find_lines", "input": {"speakers": ["Alice"], "limit": 20}}]\n```',
    '그러면 다음 메시지로 "작업실 도구 결과"가 옵니다. 결과를 보고 이어서 답하거나 다시 도구를 부르세요. 도구가 필요 없으면 블록 없이 답만 씁니다.',
    '변경 도구(save_*, propose_*, start_run 등)는 바로 실행되지 않고 사용자가 채팅 패널에서 수락해야 반영되는 제안으로 올라갑니다. 제안한 뒤에는 무엇을 왜 제안했는지 짧게 설명하고 기다리세요.',
    '',
    list,
  ].join('\n');
}

/** Tool calls in an answer, and the answer without the blocks. Malformed blocks are reported, not dropped silently. */
export function readToolCalls(text: string): { visible: string; calls: { tool: string; input: Record<string, unknown> }[]; error?: string } {
  const calls: { tool: string; input: Record<string, unknown> }[] = [];
  let error: string | undefined;
  for (const match of text.matchAll(TOOL_BLOCK)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        const call = entry as { tool?: unknown; input?: unknown };
        if (typeof call?.tool === 'string') calls.push({ tool: call.tool, input: call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {} });
      }
    } catch (cause) {
      error = `loca-tools 블록의 JSON을 읽지 못했습니다: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
  }
  return { visible: text.replace(TOOL_BLOCK, '').trim(), calls, error };
}

const textOf = (message: UIMessage) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');

/** Earlier conversation, for a new CLI session (first use, or after the profile changed). */
function transcript(messages: UIMessage[]) {
  const lines = messages
    .slice(0, -1)
    .slice(-20)
    .map((message) => `${message.role === 'user' ? '사용자' : '에이전트'}: ${textOf(message)}`)
    .filter((line) => !line.endsWith(': '));
  const text = lines.join('\n').slice(-12_000);
  return text ? `이전 대화(참고용 기록):\n${text}` : null;
}

function decisions(db: Db, chatId: string, since: number) {
  const decided = decisionsSince(db, chatId, new Date(since));
  if (!decided.length) return null;
  const word = { accepted: '수락되어 반영됨', rejected: '사용자가 거절함', failed: '수락했지만 실패함', pending: '' } as const;
  return `지난 제안의 결과:\n${decided.map((proposal) => `- ${proposal.tool} (${proposal.id}): ${word[proposal.status]}`).join('\n')}`;
}

export type CliTurn = (route: ai.ResolvedRoute, turn: ai.CliChatTurn) => Promise<ai.CliChatResult>;

export async function cliChatResponse(input: {
  db: Db;
  chat: typeof s.chatSessions.$inferSelect;
  route: ai.ResolvedRoute;
  system: string;
  view: string | null;
  messages: UIMessage[];
  timeoutMs: number;
  signal: AbortSignal;
  /** The CLI call; tests pass a fake. */
  turn?: CliTurn;
}): Promise<Response> {
  const { db, chat, route, messages } = input;
  const run = input.turn ?? ai.cliChat;
  const tools = agentCatalog(db, chat.projectId, { profileId: chat.profileId, model: route.model });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const system = [input.system, toolProtocol(tools)].join('\n\n');
  // The CLI session is reused while the connection kind and model stay the same.
  const saved = chat.agentSession && chat.agentSession.kind === route.kind && chat.agentSession.model === route.model ? chat.agentSession : null;
  const last = messages.at(-1);
  let prompt = [saved ? null : transcript(messages), saved ? decisions(db, chat.id, saved.lastTurnAt) : null, input.view, last ? textOf(last) : ''].filter(Boolean).join('\n\n');
  let sessionId = saved?.id;

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        writer.write({ type: 'start-step' });
        const answer = await run(route, { sessionId, system, prompt, timeoutMs: input.timeoutMs, signal: input.signal });
        sessionId = answer.sessionId;
        db.update(s.chatSessions).set({ agentSession: { kind: route.kind, model: route.model, id: sessionId, lastTurnAt: Date.now() } }).where(eq(s.chatSessions.id, chat.id)).run();
        const { visible, calls, error } = readToolCalls(answer.text);
        if (visible) {
          const id = crypto.randomUUID();
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: visible });
          writer.write({ type: 'text-end', id });
        }
        if (!calls.length && !error) {
          writer.write({ type: 'finish-step' });
          return;
        }
        const results: string[] = error ? [error] : [];
        for (const call of calls) {
          const toolCallId = crypto.randomUUID();
          const tool = byName.get(call.tool);
          writer.write({ type: 'tool-input-available', toolCallId, toolName: call.tool, input: call.input });
          try {
            if (!tool) throw new Error(`알 수 없는 도구입니다: ${call.tool}`);
            let output: unknown;
            if (tool.changes) {
              tool.schema.parse(call.input);
              const proposal = propose(db, { projectId: chat.projectId, sessionId: chat.id, source: 'cli', tool: tool.name, input: call.input });
              output = { proposalId: proposal.id };
              results.push(`${call.tool}: ${proposedText(proposal.id)}`);
            } else {
              output = await tool.run(call.input);
              results.push(`${call.tool}: ${JSON.stringify(output).slice(0, RESULT_LIMIT)}`);
            }
            writer.write({ type: 'tool-output-available', toolCallId, output });
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            writer.write({ type: 'tool-output-error', toolCallId, errorText: message });
            results.push(`${call.tool}: 실패 — ${message}`);
          }
        }
        writer.write({ type: 'finish-step' });
        prompt = `작업실 도구 결과:\n${results.join('\n\n')}`;
      }
      const id = crypto.randomUUID();
      writer.write({ type: 'text-start', id });
      writer.write({ type: 'text-delta', id, delta: `(도구를 ${MAX_ROUNDS}번 연달아 불러 여기서 멈췄습니다. 이어서 하려면 메시지를 보내세요.)` });
      writer.write({ type: 'text-end', id });
    },
    onFinish: ({ messages: final }) => {
      db.update(s.chatSessions).set({ messages: final }).where(eq(s.chatSessions.id, chat.id)).run();
      events.changed(chat.projectId, 'chat');
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
  return createUIMessageStreamResponse({ stream });
}
