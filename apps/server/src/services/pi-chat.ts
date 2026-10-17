import type { UIMessage } from 'ai';
import type { ChatTurn } from './chat-turns.ts';
import { enqueueSteer, takeInterjections, writeInterjections } from './chat-interject.ts';
import * as ai from '@tw/ai';
import { startCall } from './ai-calls.ts';
import type { Db } from '../db/index.ts';
import type * as s from '../db/schema.ts';
import { agentCatalog, jsonSchemaOf } from './agent-catalog.ts';
import { CHANGE_NOTE } from './change-gate.ts';
import { chatStream, runCatalogTool, turnPrompt } from './chat-stream.ts';
import { catchUp, CONTEXT_BUDGET, expandSteers, messageText, textOf, transcript, type AnsweredBy } from './chat-context.ts';

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
  /** How many messages of the conversation record this session has (#46): later ones are handed over. */
  seen: number;
}
const sessions = new Map<string, Live>();

export async function piChatResponse(input: {
  db: Db;
  chat: typeof s.chatSessions.$inferSelect;
  route: ai.ResolvedRoute;
  system: string;
  view: string | null;
  /** The conversation record with the new user message last (the server's, not the browser's). */
  messages: UIMessage[];
  answeredBy: AnsweredBy;
  /** The conversation's running turn (chat-turns startTurn): its signal, end and closing mark. */
  turn: Pick<ChatTurn, 'signal' | 'end' | 'record' | 'markClosing'>;
}): Promise<Response> {
  const { db, chat, route, messages } = input;
  let live = sessions.get(chat.id);
  const options = JSON.stringify(route.piOptions ?? null);
  if (live && (live.model !== route.model || live.options !== options)) {
    live.pi.dispose();
    live = undefined;
  }
  if (!live) {
    const tools: ai.PiToolSpec[] = agentCatalog(db, chat.projectId, { model: route.model }).map((tool) => ({
      name: tool.name,
      label: tool.name,
      description: tool.changes ? `${tool.description} (변경 도구: ${CHANGE_NOTE})` : tool.description,
      parameters: jsonSchemaOf(tool.schema),
      execute: async (args) => {
        const result = await runCatalogTool(db, { ...chat, model: route.model }, 'pi', tool, args);
        if (!result.ok) return { text: `제안을 만들지 않았습니다: ${result.reason}`, details: { ok: false, error: result.error } };
        return { text: result.text, details: result.output };
      },
    }));
    // A new session (first turn, a restart, another model) starts with the record as real messages.
    const earlier = messages.slice(0, -1);
    live = {
      pi: await ai.createPiChatSession({ piOptions: route.piOptions, model: route.model, effort: route.effort, system: input.system, tools, history: seedHistory(earlier) }),
      model: route.model,
      options,
      seen: earlier.length,
    };
    sessions.set(chat.id, live);
  }
  const current = live;
  if (current.pi.isStreaming) throw new Error('이전 응답이 아직 끝나지 않았습니다. 잠시 후 다시 보내세요.');

  const last = messages.at(-1);
  // Messages a previous turn could not take come after the new one.
  const leftover = takeInterjections(db, chat.id);
  const prompt = turnPrompt({ context: catchUp(messages.slice(0, -1), current.seen, CONTEXT_BUDGET.pi), view: input.view, text: last ? textOf(last) : '', leftover });

  return chatStream({
    db,
    chat,
    messages,
    turn: input.turn,
    execute: async (writer) => {
      writer.write({ type: 'message-metadata', messageMetadata: { answeredBy: input.answeredBy } });
      writeInterjections(writer, leftover);
      let textId: string | null = null;
      const closeText = () => {
        if (textId) writer.write({ type: 'text-end', id: textId });
        textId = null;
      };
      // Steps mirror pi turns (one model call and its tool calls), so the client sees that a turn
      // ended in text and does not resubmit as if a tool result were still waiting for the model.
      const usage: ai.Usage = {};
      const finish = startCall(db, { projectId: chat.projectId, kind: 'chat', refId: chat.id, label: '채팅 (pi)' }, route);
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
        } else if (event.type === 'message_end') {
          closeText();
          // Assistant messages carry their usage; the turn's log row adds them up.
          const reported = (event.message as { usage?: { input?: number; output?: number; cacheRead?: number } }).usage;
          if (reported) {
            usage.inputTokens = (usage.inputTokens ?? 0) + (reported.input ?? 0) + (reported.cacheRead ?? 0);
            usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + (reported.cacheRead ?? 0);
            usage.outputTokens = (usage.outputTokens ?? 0) + (reported.output ?? 0);
          }
        }
        else if (event.type === 'tool_execution_start') {
          closeText();
          writer.write({ type: 'tool-input-available', toolCallId: event.toolCallId, toolName: event.toolName, input: event.args });
        } else if (event.type === 'tool_execution_end') {
          if (event.isError) writer.write({ type: 'tool-output-error', toolCallId: event.toolCallId, errorText: String(event.result?.content?.[0]?.text ?? '도구 실행 실패') });
          else writer.write({ type: 'tool-output-available', toolCallId: event.toolCallId, output: event.result?.details ?? null });
          // A message sent meanwhile goes in before pi's next model call (#44).
          const items = takeInterjections(db, chat.id);
          if (items.length) {
            closeText();
            void current.pi.steer(writeInterjections(writer, items)).catch(() => {
              for (const item of items) if (item.kind === 'user') enqueueSteer(db, chat.id, item.text);
            });
          }
        }
      });
      const abort = () => void current.pi.abort();
      input.turn.signal.addEventListener('abort', abort);
      try {
        await current.pi.prompt(prompt);
        // A message sent while it was answering: carry on with it instead of ending the turn.
        for (let items = takeInterjections(db, chat.id); items.length && !input.turn.signal.aborted; items = takeInterjections(db, chat.id)) await current.pi.prompt(writeInterjections(writer, items));
        input.turn.markClosing();
        finish({ usage });
      } catch (error) {
        finish({ error, usage });
        throw error;
      } finally {
        closeText();
        unsubscribe();
        input.turn.signal.removeEventListener('abort', abort);
      }
    },
    alsoSave: (final) => {
      current.seen = final.length;
      return {};
    },
  });
}

/**
 * The record as pi history: what each side said, tools on one line each. The newest messages fit in
 * the budget as they are; anything older becomes one text message at the start (#46).
 */
export function seedHistory(record: UIMessage[]): ai.PiHistoryMessage[] {
  const earlier = expandSteers(record);
  let used = 0;
  let start = earlier.length;
  while (start > 0) {
    const size = messageText(earlier[start - 1]).length;
    if (used + size > CONTEXT_BUDGET.pi * 0.7) break;
    used += size;
    start--;
  }
  while (start < earlier.length && earlier[start].role !== 'user') start++;
  const older = start > 0 ? transcript(earlier.slice(0, start), CONTEXT_BUDGET.pi * 0.3) : '';
  const history: ai.PiHistoryMessage[] = older ? [{ role: 'user', text: `이 대화의 앞부분(길이 때문에 줄인 기록):\n${older}` }, { role: 'assistant', text: '앞부분을 읽었습니다.' }] : [];
  for (const message of earlier.slice(start)) {
    const text = messageText(message);
    if (text) history.push({ role: message.role === 'user' ? 'user' : 'assistant', text });
  }
  return history;
}

/** A deleted chat or a changed model frees its pi session. */
export function closePiChat(chatId: string) {
  sessions.get(chatId)?.pi.dispose();
  sessions.delete(chatId);
}
