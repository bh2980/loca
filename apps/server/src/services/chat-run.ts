import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, type ModelMessage, type UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { chatTitle } from '@tw/shared';
import * as ai from '@tw/ai';
import type { Deps } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { startCall } from './ai-calls.ts';
import { AGENT_SYSTEM } from './agent-tools.ts';
import { gatedTools } from './change-gate.ts';
import { CONTEXT_BUDGET, fitMessages, mergeIncoming, type AnsweredBy } from './chat-context.ts';
import { hasInterjections, takeInterjections, writeInterjections, type Interjection } from './chat-interject.ts';
import { afterTurn, markStopped, readToEnd, startTurn, turnStartedAt, type ChatTurn } from './chat-turns.ts';
import { cliChatResponse } from './cli-chat.ts';
import { piChatResponse } from './pi-chat.ts';
import { hasUnreportedDecisions, openProposals, takeDecisions } from './proposals.ts';
import { liveChoice } from './routes.ts';
import { withFittedResults } from './tool-output.ts';

/**
 * One chat turn, whoever starts it: the person sending a message (routes/chat.ts) or the server
 * after the conversation's last proposal was decided (#43). The record is the server's (#46); the
 * turn picks the backend from the conversation's connection.
 */
/** The open workflow editor applies node edits in the browser, which only the API chat can wait for. */
const NO_EDITOR_NOTE = '워크플로 노드 편집(edit_workflow_node)은 이 대화에서 쓸 수 없습니다. 노드를 바꾸려면 save_workflow를 쓰세요.';

export async function runChatTurn(deps: Pick<Deps, 'db' | 'secrets'>, session: typeof s.chatSessions.$inferSelect, request: { incoming?: UIMessage; trigger?: 'submit-message' | 'regenerate-message'; view?: string | null }): Promise<Response> {
  const { db, secrets } = deps;
  if (!session.connectionId || !session.model) throw new Error('입력창 아래에서 채팅할 AI 연결과 모델을 고르세요.');
  const live = liveChoice(db, { connectionId: session.connectionId, model: session.model, ...(session.effort && { effort: session.effort }) }, secrets, 'chat');
  // A chat talks to one model: the connection's fallback is for workflow and analysis requests.
  const route = live.routes[0]!;
  const messages = mergeIncoming(session.messages as UIMessage[], request.incoming, request.trigger);
  if (!messages.length) throw new Error('보낼 메시지가 없습니다.');
  const answeredBy: AnsweredBy = { kind: route.kind, connectionId: session.connectionId, model: route.model };

  const firstUser = messages.find((message) => message.role === 'user');
  const firstText = firstUser?.parts.find((part) => part.type === 'text');
  if (session.title === '새 대화' && firstText && 'text' in firstText) {
    db.update(s.chatSessions).set({ title: chatTitle(firstText.text) }).where(eq(s.chatSessions.id, session.id)).run();
    events.changed(session.projectId, 'chat');
  }

  // Kept before the reply starts: if the turn is cut off (the page closed, the connection dropped),
  // the question is not lost; the reply replaces this when it ends.
  db.update(s.chatSessions).set({ messages }).where(eq(s.chatSessions.id, session.id)).run();

  const view = request.view ?? null;
  // The turn, not this request, decides when the reply stops (a reload keeps it going; 중단 stops it).
  const turn = startTurn(session.projectId, session.id);
  if ((ai.CHAT_CLI_KINDS as string[]).includes(route.kind))
    return cliChatResponse({ db, chat: session, route, system: [AGENT_SYSTEM, NO_EDITOR_NOTE].join('\n\n'), view, messages, answeredBy, timeoutMs: live.snapshot.timeoutSeconds * 1000, turn });
  if (route.kind === 'pi') {
    try {
      return await piChatResponse({ db, chat: session, route, system: [AGENT_SYSTEM, NO_EDITOR_NOTE].join('\n\n'), view, messages, answeredBy, turn });
    } catch (error) {
      turn.end();
      throw error;
    }
  }
  return apiChatResponse({ db, session, route, live, view, messages, answeredBy, turn });
}

/**
 * After a proposal is decided (#43): once none of the conversation's proposals is waiting, the
 * agent hears the results and carries on without the person having to say "I accepted it". A
 * running turn takes them at its next step; if it had already finished, this runs again when it
 * ends. Otherwise the server starts a turn whose question is the results (a user message marked
 * `metadata.kind = 'decisions'`), and the panel attaches to its stream (GET /chat/:id/stream).
 */
export function continueAfterDecisions(deps: Pick<Deps, 'db' | 'secrets'>, sessionId: string) {
  const { db } = deps;
  if (openProposals(db, sessionId) || !hasUnreportedDecisions(db, sessionId)) return;
  if (turnStartedAt(sessionId) !== null) {
    afterTurn(sessionId, () => continueAfterDecisions(deps, sessionId));
    return;
  }
  const session = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get();
  if (!session?.connectionId || !session.model) return;
  try {
    liveChoice(db, { connectionId: session.connectionId, model: session.model, ...(session.effort && { effort: session.effort }) }, deps.secrets, 'chat');
  } catch {
    return; // The connection is gone or unusable: the results wait for the next message.
  }
  const text = takeDecisions(db, sessionId);
  if (!text) return;
  const incoming: UIMessage = { id: crypto.randomUUID(), role: 'user', metadata: { kind: 'decisions' }, parts: [{ type: 'text', text }] };
  runChatTurn(deps, session, { incoming })
    // Nobody reads this response: the turn records its stream for windows that attach.
    .then((response) => void response.body?.cancel())
    // The results are in the record already, so the next turn still reads them.
    .catch((error) => {
      console.warn('chat: could not continue after decisions:', error instanceof Error ? error.message : error);
    });
}

/** Steps one API turn may take, across the passes steering messages start. */
const MAX_STEPS = 30;

/**
 * The API (OpenAI-compatible) chat turn: passes of streamText in one reply. A pass stops early when
 * a steering message is waiting; the next pass carries on with the model's work so far plus that
 * message, so the reply goes on as one message with the steer recorded where it came in (#44).
 */
function apiChatResponse(input: {
  db: Db;
  session: typeof s.chatSessions.$inferSelect;
  route: ai.ResolvedRoute;
  live: ReturnType<typeof liveChoice>;
  view: string | null;
  messages: UIMessage[];
  answeredBy: AnsweredBy;
  turn: ChatTurn;
}) {
  const { db, session, route, live, messages, answeredBy, turn } = input;
  const tools = withFittedResults(gatedTools(db, session.projectId, session.id, { model: route.model }));
  const last = messages.at(-1);
  // A reply whose tool approval was just answered goes on in the same message.
  const messageId = last?.role === 'assistant' ? last.id : crypto.randomUUID();
  const stream = createUIMessageStream({
    originalMessages: messages,
    generateId: () => crypto.randomUUID(),
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageId, messageMetadata: { answeredBy } });
      const interject = (items: Interjection[]) => ({ role: 'user' as const, content: writeInterjections(writer, items) });
      // An editor proposal left unanswered before the next message is dropped rather than failing the turn.
      let modelMessages: ModelMessage[] = await convertToModelMessages(fitMessages(messages, CONTEXT_BUDGET.api), { ignoreIncompleteToolCalls: true });
      // Messages a previous turn could not take (it stopped for an approval) come first.
      const leftover = takeInterjections(db, session.id);
      if (leftover.length) modelMessages = [...modelMessages, interject(leftover)];
      let steps = 0;
      let finishReason: string | undefined;
      for (let pass = 0; steps < MAX_STEPS; pass++) {
        // One log row per pass (its tool steps included); usage comes with the finish.
        const finish = startCall(db, { projectId: session.projectId, kind: 'chat', refId: session.id, label: pass ? '채팅 · 끼어든 메시지 후' : '채팅' }, route);
        const result = streamText({
          model: ai.chatModel(route),
          onFinish: ({ totalUsage }) => finish({ usage: { inputTokens: totalUsage.inputTokens, cachedInputTokens: totalUsage.inputTokenDetails?.cacheReadTokens, outputTokens: totalUsage.outputTokens } }),
          onError: ({ error }) => finish({ error }),
          onAbort: () => finish({ error: '중단함' }),
          system: [AGENT_SYSTEM, input.view].filter(Boolean).join('\n\n'),
          messages: modelMessages,
          tools,
          // A waiting steering message ends the pass after the current step (its tool results are in).
          stopWhen: [stepCountIs(MAX_STEPS - steps), () => hasInterjections(db, session.id)],
          maxOutputTokens: live.snapshot.maxOutputTokens,
          providerOptions: ai.openaiProviderOptions(route),
          abortSignal: turn.signal,
        });
        writer.merge(result.toUIMessageStream({ sendStart: false, sendFinish: false, onError: (error) => (error instanceof Error ? error.message : String(error)) }));
        const passSteps = await result.steps;
        steps += Math.max(1, passSteps.length);
        finishReason = await result.finishReason;
        // Waiting for the person to approve a tool: the turn ends; a queued message waits for the next one.
        if (passSteps.at(-1)?.content.some((part) => part.type === 'tool-approval-request')) break;
        const items = takeInterjections(db, session.id);
        if (!items.length) {
          turn.markClosing();
          break;
        }
        modelMessages = [...modelMessages, ...(await result.response).messages, interject(items)];
      }
      turn.markClosing();
      // Who answered, and why the turn ended (the panel says "hit the output limit" instead of going quiet).
      writer.write({ type: 'finish', ...(finishReason && { finishReason: finishReason as never }), messageMetadata: { answeredBy, finishReason } });
    },
    onFinish: ({ messages: final }) => {
      db.update(s.chatSessions).set({ messages: markStopped(final, turn.signal) }).where(eq(s.chatSessions.id, session.id)).run();
      events.changed(session.projectId, 'chat');
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
  return createUIMessageStreamResponse({ stream, ...readToEnd(turn) });
}
