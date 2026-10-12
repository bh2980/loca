import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { agentCatalog, jsonSchemaOf } from './agent-catalog.ts';
import { prepareProposal, reportText } from './proposal-check.ts';
import { propose, proposedText } from './proposals.ts';

/**
 * Project chat through pi. pi keeps the conversation in an in-process session per chat; the
 * browser still receives the AI SDK UI message stream, so the chat panel works unchanged.
 * Changes become proposals (cards in the panel); the next turn tells the agent how each was decided.
 */
interface Live {
  pi: ai.PiSession;
  model: string;
  /** The connection switches the session was built with; a change rebuilds it. */
  options: string;
  /** Proposal ids whose decision the agent has already been told. */
  reported: Set<string>;
  /** Earlier conversation to hand over once, when the session had to be (re)created. */
  handover: string | null;
}
const sessions = new Map<string, Live>();

const textOf = (message: UIMessage) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');

/** The visible conversation before this message, for a session created after a restart or model change. */
function transcript(messages: UIMessage[]) {
  const lines = messages
    .slice(0, -1)
    .slice(-20)
    .map((message) => `${message.role === 'user' ? '사용자' : '에이전트'}: ${textOf(message)}`)
    .filter((line) => !line.endsWith(': '));
  const text = lines.join('\n').slice(-12_000);
  return text ? `이전 대화(참고용 기록):\n${text}` : null;
}

function decisions(db: Db, chatId: string, live: Live) {
  const decided = db
    .select()
    .from(s.proposals)
    .where(eq(s.proposals.sessionId, chatId))
    .all()
    .filter((proposal) => proposal.status !== 'pending' && !live.reported.has(proposal.id));
  for (const proposal of decided) live.reported.add(proposal.id);
  if (!decided.length) return null;
  const word = { accepted: '수락되어 반영됨', rejected: '사용자가 거절함', failed: '수락했지만 실패함', pending: '' } as const;
  return `지난 제안의 결과:\n${decided.map((proposal) => `- ${proposal.tool} (${proposal.id}): ${word[proposal.status]}${proposal.status === 'failed' ? ` — ${JSON.stringify(proposal.result).slice(0, 200)}` : ''}`).join('\n')}`;
}

export async function piChatResponse(input: {
  db: Db;
  chat: typeof s.chatSessions.$inferSelect;
  route: ai.ResolvedRoute;
  system: string;
  view: string | null;
  messages: UIMessage[];
  signal: AbortSignal;
}): Promise<Response> {
  const { db, chat, route, messages } = input;
  let live = sessions.get(chat.id);
  const options = JSON.stringify(route.piOptions ?? null);
  if (live && (live.model !== route.model || live.options !== options)) {
    live.pi.dispose();
    live = undefined;
  }
  if (!live) {
    const tools: ai.PiToolSpec[] = agentCatalog(db, chat.projectId, { profileId: chat.profileId, model: route.model }).map((tool) => ({
      name: tool.name,
      label: tool.name,
      description: tool.changes ? `${tool.description} (변경 도구: 바로 실행되지 않고 사용자 수락을 기다리는 제안으로 올라갑니다.)` : tool.description,
      parameters: jsonSchemaOf(tool.schema),
      execute: async (args) => {
        if (tool.changes) {
          const prepared = prepareProposal(db, chat.projectId, tool.name, args);
          if (!prepared.ok) return { text: `제안을 만들지 않았습니다: ${prepared.error}`, details: { error: prepared.error } };
          const proposal = propose(db, { projectId: chat.projectId, sessionId: chat.id, source: 'pi', tool: tool.name, input: prepared.input, report: prepared.report });
          return { text: proposedText(proposal.id) + reportText(prepared.report), details: { proposalId: proposal.id } };
        }
        const result = await tool.run(args);
        return { text: JSON.stringify(result).slice(0, 40_000), details: result };
      },
    }));
    live = {
      pi: await ai.createPiChatSession({ piOptions: route.piOptions, model: route.model, effort: route.effort, system: input.system, tools }),
      model: route.model,
      options,
      reported: new Set(),
      handover: transcript(messages),
    };
    sessions.set(chat.id, live);
  }
  const current = live;
  if (current.pi.isStreaming) throw new Error('이전 응답이 아직 끝나지 않았습니다. 잠시 후 다시 보내세요.');

  const last = messages.at(-1);
  const prompt = [current.handover, decisions(db, chat.id, current), input.view, last ? textOf(last) : ''].filter(Boolean).join('\n\n');
  current.handover = null;

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      let textId: string | null = null;
      const closeText = () => {
        if (textId) writer.write({ type: 'text-end', id: textId });
        textId = null;
      };
      // Steps mirror pi turns (one model call and its tool calls), so the client sees that a turn
      // ended in text and does not resubmit as if a tool result were still waiting for the model.
      const unsubscribe = current.pi.subscribe((event) => {
        if (event.type === 'turn_start') writer.write({ type: 'start-step' });
        else if (event.type === 'turn_end') {
          closeText();
          writer.write({ type: 'finish-step' });
        } else if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          if (!textId) {
            textId = crypto.randomUUID();
            writer.write({ type: 'text-start', id: textId });
          }
          writer.write({ type: 'text-delta', id: textId, delta: event.assistantMessageEvent.delta });
        } else if (event.type === 'message_end') closeText();
        else if (event.type === 'tool_execution_start') {
          closeText();
          writer.write({ type: 'tool-input-available', toolCallId: event.toolCallId, toolName: event.toolName, input: event.args });
        } else if (event.type === 'tool_execution_end') {
          if (event.isError) writer.write({ type: 'tool-output-error', toolCallId: event.toolCallId, errorText: String(event.result?.content?.[0]?.text ?? '도구 실행 실패') });
          else writer.write({ type: 'tool-output-available', toolCallId: event.toolCallId, output: event.result?.details ?? null });
        }
      });
      const abort = () => void current.pi.abort();
      input.signal.addEventListener('abort', abort);
      try {
        await current.pi.prompt(prompt);
      } finally {
        closeText();
        unsubscribe();
        input.signal.removeEventListener('abort', abort);
      }
    },
    onFinish: ({ messages: final }) => {
      db.update(s.chatSessions).set({ messages: final }).where(eq(s.chatSessions.id, chat.id)).run();
      events.changed(chat.projectId, 'chat');
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
  return createUIMessageStreamResponse({ stream });
}

/** A deleted chat or a changed profile frees its pi session. */
export function closePiChat(chatId: string) {
  sessions.get(chatId)?.pi.dispose();
  sessions.delete(chatId);
}
