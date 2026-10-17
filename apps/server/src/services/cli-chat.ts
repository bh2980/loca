import type { UIMessage } from 'ai';
import type { ChatTurn } from './chat-turns.ts';
import { takeInterjections, writeInterjections } from './chat-interject.ts';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { logged } from './ai-calls.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog, jsonSchemaOf, type CatalogTool } from './agent-catalog.ts';
import { chatStream, runCatalogTool, turnPrompt, writeText } from './chat-stream.ts';
import { catchUp, CONTEXT_BUDGET, handover, textOf, type AnsweredBy } from './chat-context.ts';

/**
 * Project chat through an agent CLI (Claude Code, Codex, Grok, agy, opencode). The CLI keeps the
 * conversation in its own session, resumed every turn (see packages/ai cli-chat.ts). The CLIs'
 * own tools stay off; workbench tools are the same catalog pi and the CLI use, called through
 * the answer: the agent ends a reply with a `loca-tools` block, the server runs the tools (reads
 * at once, changes as proposals for this chat) and resumes the session with the results.
 * The browser receives the AI SDK UI message stream like any other chat.
 */
/** Tool rounds in one turn before stopping to report, the same allowance the API chat gets (stepCountIs(30)): a guard against a looping model, not a budget. */
const MAX_ROUNDS = 30;
const RESULT_LIMIT = 20_000;
const TOOL_BLOCK = /```loca-tools[ \t]*\r?\n([\s\S]*?)```/g;

/** Instructions that teach the protocol, with every tool's input schema. */
export function toolProtocol(tools: CatalogTool[]) {
  const list = tools.map((tool) => `### ${tool.name}${tool.changes ? ' (변경: 제안으로 올라감)' : ''}\n${tool.description}\n입력 스키마: ${JSON.stringify(jsonSchemaOf(tool.schema))}`).join('\n\n');
  return [
    '## 작업실 도구 사용법',
    '이 대화에서는 당신의 셸·파일·웹 도구를 쓰지 않습니다. 프로젝트를 읽거나 바꾸려면 아래 작업실 도구를 씁니다.',
    // Codex (gpt-6) tries its code-mode `exec` / ALL_TOOLS first even when it is off; one failed call per turn otherwise.
    '당신 쪽의 도구 호출(exec·ALL_TOOLS 같은 코드 실행, 함수 호출)은 이 대화에서 모두 꺼져 있어 실패합니다. 시도하지 말고 처음부터 아래 블록을 쓰세요.',
    '도구가 필요하면 답의 맨 끝에 다음 블록 하나를 쓰고 멈추세요. 블록 안은 JSON 배열이며 한 번에 여러 도구를 부를 수 있습니다:',
    '```loca-tools\n[{"tool": "find_lines", "input": {"speakers": ["Alice"], "limit": 20}}]\n```',
    '그러면 다음 메시지로 "작업실 도구 결과"가 옵니다. 결과를 보고 이어서 답하거나 다시 도구를 부르세요. 도구가 필요 없으면 블록 없이 답만 씁니다.',
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

export type CliTurn = (route: ai.ResolvedRoute, turn: ai.CliChatTurn) => Promise<ai.CliChatResult>;

export async function cliChatResponse(input: {
  db: Db;
  chat: typeof s.chatSessions.$inferSelect;
  route: ai.ResolvedRoute;
  system: string;
  view: string | null;
  /** The conversation record with the new user message last (the server's, not the browser's). */
  messages: UIMessage[];
  answeredBy: AnsweredBy;
  timeoutMs: number;
  /** The conversation's running turn (chat-turns startTurn): its signal, end and closing mark. */
  turn: Pick<ChatTurn, 'signal' | 'end' | 'record' | 'markClosing'>;
  /** The CLI call; tests pass a fake. */
  cli?: CliTurn;
}): Promise<Response> {
  const { db, chat, route, messages } = input;
  const run = input.cli ?? ai.cliChat;
  const tools = agentCatalog(db, chat.projectId, { model: route.model });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const system = [input.system, toolProtocol(tools)].join('\n\n');
  // The CLI's own session is a cache of the record, reused while the connection kind and model stay
  // the same. It is told what it missed (another model answered in between); a new one gets the record.
  const saved = chat.agentSession && chat.agentSession.kind === route.kind && chat.agentSession.model === route.model ? chat.agentSession : null;
  const earlier = messages.slice(0, -1);
  const last = messages.at(-1);
  const context = saved ? catchUp(earlier, saved.seen ?? earlier.length, CONTEXT_BUDGET.cli) : handover(earlier, CONTEXT_BUDGET.cli);
  // Messages a previous turn could not take come after the new one.
  // Messages and decisions that came in since the last turn come after the new message.
  const leftover = takeInterjections(db, chat.id);
  let prompt = turnPrompt({ context, view: input.view, text: last ? textOf(last) : '', leftover });
  let sessionId = saved?.id;
  let totalsBefore = saved?.totals;

  return chatStream({
    db,
    chat,
    messages,
    turn: input.turn,
    execute: async (writer) => {
      writer.write({ type: 'message-metadata', messageMetadata: { answeredBy: input.answeredBy } });
      writeInterjections(writer, leftover);
      for (let round = 0; round < MAX_ROUNDS; round++) {
        writer.write({ type: 'start-step' });
        const answer = await logged(db, { projectId: chat.projectId, kind: 'chat', refId: chat.id, label: `채팅 (CLI${round ? ` · 도구 결과 후 ${round}` : ''})` }, route, () => run(route, { sessionId, system, prompt, timeoutMs: input.timeoutMs, signal: input.turn.signal, totalsBefore }));
        sessionId = answer.sessionId;
        totalsBefore = answer.totals;
        db.update(s.chatSessions).set({ agentSession: { kind: route.kind, model: route.model, id: sessionId, lastTurnAt: Date.now(), totals: totalsBefore } }).where(eq(s.chatSessions.id, chat.id)).run();
        const { visible, calls, error } = readToolCalls(answer.text);
        if (visible) writeText(writer, visible);
        if (!calls.length && !error) {
          writer.write({ type: 'finish-step' });
          // A message sent while it was answering: carry on with it instead of ending the turn (#44).
          const items = takeInterjections(db, chat.id);
          if (!items.length) {
            input.turn.markClosing();
            return;
          }
          prompt = writeInterjections(writer, items);
          continue;
        }
        const results: string[] = error ? [error] : [];
        for (const call of calls) {
          const toolCallId = crypto.randomUUID();
          const tool = byName.get(call.tool);
          writer.write({ type: 'tool-input-available', toolCallId, toolName: call.tool, input: call.input });
          try {
            if (!tool) throw new Error(`알 수 없는 도구입니다: ${call.tool}`);
            // A change's input is checked here, so a malformed one fails like a read would.
            const result = await runCatalogTool(db, { ...chat, model: route.model }, 'cli', tool, tool.changes ? (tool.schema.parse(call.input) as Record<string, unknown>) : call.input, RESULT_LIMIT);
            if (!result.ok) {
              // The panel shows the plain reason; the agent also gets the ids to fix it with.
              writer.write({ type: 'tool-output-error', toolCallId, errorText: result.error });
              results.push(`${call.tool}: 제안을 만들지 않았습니다 — ${result.reason}`);
              continue;
            }
            results.push(`${call.tool}: ${result.text}`);
            writer.write({ type: 'tool-output-available', toolCallId, output: result.output });
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            writer.write({ type: 'tool-output-error', toolCallId, errorText: message });
            results.push(`${call.tool}: 실패 — ${message}`);
          }
        }
        writer.write({ type: 'finish-step' });
        prompt = [`작업실 도구 결과:\n${results.join('\n\n')}`, writeInterjections(writer, takeInterjections(db, chat.id))].filter(Boolean).join('\n\n');
      }
      input.turn.markClosing();
      writeText(writer, `(도구를 ${MAX_ROUNDS}번 연달아 불러 여기서 멈췄습니다. 이어서 하려면 메시지를 보내세요.)`);
    },
    alsoSave: (final) => {
      // The CLI session has now seen the whole record, its own reply included.
      const agentSession = db.select({ agentSession: s.chatSessions.agentSession }).from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()?.agentSession;
      return agentSession && sessionId === agentSession.id ? { agentSession: { ...agentSession, seen: final.length } } : {};
    },
  });
}
