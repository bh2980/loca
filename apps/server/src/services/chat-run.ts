import { convertToModelMessages, stepCountIs, streamText, type ModelMessage, type StopCondition, type ToolSet, type UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { CALL_TIMEOUT_MS, chatTitle, estimateTokens } from '@tw/shared';
import * as ai from '@tw/ai';
import type { Deps } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { startCall } from './ai-calls.ts';
import { AGENT_SYSTEM } from './agent-tools.ts';
import { expandRecord, isRunRecord, lastExchange, mergeIncoming, type AnsweredBy } from './chat-context.ts';
import { compactNow, compactionSettled, fitRecord } from './chat-compaction.ts';
import { imageDecision } from '@tw/shared';
import { incomingImageProblem, withoutImages } from './chat-images.ts';
import { agentCatalog, jsonSchemaOf } from './agent-catalog.ts';
import { hasInterjections, takeInterjections, writeInterjections, type Interjection } from './chat-interject.ts';
import { deletingChats, afterTurn, startTurn, turnEnded, turnStartedAt, type ChatTurn } from './chat-turns.ts';
import { chatStream, errorText } from './chat-stream.ts';
import { cliChatResponse } from './cli-chat.ts';
import { hasDecisionsToAnswer, openProposals, startsRun, takeDecisions } from './proposals.ts';
import { liveChoice } from './model-target.ts';
import { apiChatTools } from './tool-run.ts';

/**
 * One chat turn, whoever starts it: the person sending a message (routes/chat.ts) or the server
 * after the conversation's last proposal was decided (#43). The record is the server's (#46); the
 * turn picks the backend from the conversation's connection.
 */
/** The open workflow editor applies node edits in the browser, which only the API chat can wait for. */
const NO_EDITOR_NOTE = '워크플로 노드 편집(edit_workflow_node)은 이 대화에서 쓸 수 없습니다. 노드를 바꾸려면 save_workflow를 쓰세요.';

/** How long a new turn waits for the conversation's running one to end before cutting it off. */
export const PREVIOUS_TURN_WAIT_MS = 30_000;

export async function runChatTurn(deps: Pick<Deps, 'db' | 'secrets'>, given: typeof s.chatSessions.$inferSelect, request: { incoming?: UIMessage; trigger?: 'submit-message' | 'regenerate-message'; view?: string | null }): Promise<Response> {
  const { db, secrets } = deps;
  let session = given;
  // A turn still running (finishing its last step, or started in another window): wait for it, so
  // its reply is saved and this turn builds on it, instead of cutting it off as if it were stopped.
  if (turnStartedAt(session.id) !== null && (await turnEnded(session.id, PREVIOUS_TURN_WAIT_MS))) {
    session = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, session.id)).get() ?? session;
  }
  // A /compact still writing its summary: this turn starts from it.
  await compactionSettled(session.id);
  const current = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, session.id)).get();
  if (!current || deletingChats.has(session.id)) throw new Error('삭제되었거나 삭제 중인 대화입니다.');
  session = current;
  if (!session.connectionId || !session.model) throw new Error('입력창 아래에서 채팅할 AI 연결과 모델을 고르세요.');
  const imageProblem = incomingImageProblem(request.incoming);
  if (imageProblem) throw new Error(imageProblem);
  const live = liveChoice(db, { connectionId: session.connectionId, model: session.model, ...(session.effort && { effort: session.effort }) }, secrets, 'chat');
  const target = live.target;
  const messages = mergeIncoming(session.messages as UIMessage[], request.incoming, request.trigger);
  if (!messages.length) throw new Error('보낼 메시지가 없습니다.');
  const answeredBy: AnsweredBy = { kind: target.kind, connectionId: session.connectionId, model: target.model };

  const firstUser = messages.find((message) => message.role === 'user' && !isRunRecord(message));
  const firstText = firstUser?.parts.find((part) => part.type === 'text');
  if (session.title === '새 대화' && firstText && 'text' in firstText) {
    db.update(s.chatSessions).set({ title: chatTitle(firstText.text) }).where(eq(s.chatSessions.id, session.id)).run();
  }

  // Kept before the reply starts: if the turn is cut off (the page closed, the connection dropped),
  // the question is not lost; the reply replaces this when it ends.
  db.update(s.chatSessions).set({ messages }).where(eq(s.chatSessions.id, session.id)).run();

  const view = request.view ?? null;
  // The turn, not this request, decides when the reply stops (a reload keeps it going; 중단 stops it).
  const turn = startTurn(session.projectId, session.id);
  // A chat that moved to another connection or model lets its CLI session go. The record is ours:
  // back on the same CLI and model after API turns, the CLI's saved session is reopened; after
  // another CLI's turns, a new session gets the record.
  const previous = session.agentSession;
  if (previous && (previous.kind !== target.kind || previous.model !== target.model)) void ai.closeSession(previous.id);
  // An agent CLI answers through its own agent session; an API connection through the AI SDK with native tool calls.
  if (ai.providerOf(target.kind).chat?.via === 'agent')
    return cliChatResponse({ db, chat: session, target, system: [AGENT_SYSTEM, NO_EDITOR_NOTE].join('\n\n'), view, messages, answeredBy, idleMs: CALL_TIMEOUT_MS.chatIdle, turn });
  return apiChatResponse({ db, session, target, live, view, messages, answeredBy, turn });
}

/** /compact: the conversation so far becomes its summary now, written by the conversation's own model (chat-compaction.ts). */
export async function compactChat(deps: Pick<Deps, 'db' | 'secrets'>, sessionId: string, signal?: AbortSignal) {
  const { db, secrets } = deps;
  const session = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get();
  if (!session || deletingChats.has(sessionId)) throw new Error('삭제되었거나 삭제 중인 대화입니다.');
  if (turnStartedAt(sessionId) !== null) throw new Error('답변이 끝난 뒤에 압축할 수 있습니다.');
  if (!session.connectionId || !session.model) throw new Error('입력창 아래에서 채팅할 AI 연결과 모델을 고르세요.');
  const { target } = liveChoice(db, { connectionId: session.connectionId, model: session.model, ...(session.effort && { effort: session.effort }) }, secrets, 'chat');
  return compactNow({ db, sessionId, target, signal });
}

/**
 * After a proposal is decided (#43): once none of the conversation's proposals is waiting, the
 * agent hears the results and carries on without the person having to say "I accepted it". A
 * running turn takes them at its next step; if it had already finished, this runs again when it
 * ends. Otherwise the server starts a turn whose question is the results (a user message marked
 * `metadata.kind = 'decisions'`), and the panel attaches to its stream (GET /chat/:id/stream).
 * A run that was accepted starts no turn: it goes on by itself and records its end here (chat-run-end.ts).
 */
export function continueAfterDecisions(deps: Pick<Deps, 'db' | 'secrets'>, sessionId: string) {
  const { db } = deps;
  if (deletingChats.has(sessionId)) return;
  if (openProposals(db, sessionId) || !hasDecisionsToAnswer(db, sessionId)) return;
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

/** What the agent's tool definitions take in a request. */
export const toolTokens = (db: Db, projectId: string) => estimateTokens(agentCatalog(db, projectId).map((tool) => ({ name: tool.name, description: tool.description, input: jsonSchemaOf(tool.schema) })));

/** Steps one API turn may take, across the passes steering messages start. */
const MAX_STEPS = 30;

/** A run was started two steps ago: the step after it said so, and the turn is over (the run goes on without it). */
const afterStartingRun: StopCondition<ToolSet> = ({ steps }) => Boolean(steps.at(-2)?.toolCalls.some((call) => startsRun(call.toolName)));

/**
 * The API (OpenAI-compatible) chat turn: passes of streamText in one reply. A pass stops early when
 * a steering message is waiting; the next pass carries on with the model's work so far plus that
 * message, so the reply goes on as one message with the steer recorded where it came in (#44).
 */
function apiChatResponse(input: {
  db: Db;
  session: typeof s.chatSessions.$inferSelect;
  target: ai.ModelTarget;
  live: ReturnType<typeof liveChoice>;
  view: string | null;
  messages: UIMessage[];
  answeredBy: AnsweredBy;
  turn: ChatTurn;
}) {
  const { db, session, target, live, messages, answeredBy, turn } = input;
  const tools = apiChatTools(db, session.projectId, session.id, { model: target.model });
  // Run cards are not replies: the reply that carries on is the newest message that is not one.
  const last = lastExchange(messages);
  // A reply sent back with the result of a tool the browser carried out (edit_workflow_node) goes on in the same message.
  const messageId = last?.role === 'assistant' ? last.id : crypto.randomUUID();
  return chatStream({
    db,
    chat: session,
    messages,
    turn,
    execute: async (writer) => {
      writer.write({ type: 'start', messageId, messageMetadata: { answeredBy } });
      const interject = (items: Interjection[]) => ({ role: 'user' as const, content: writeInterjections(writer, items) });
      // An editor proposal left unanswered before the next message is dropped rather than failing the turn.
      // The whole record, its start summarized only when it would not fit the model (chat-compaction.ts).
      const system = [AGENT_SYSTEM, input.view].filter(Boolean).join('\n\n');
      const overhead = estimateTokens(system) + toolTokens(db, session.projectId);
      const fitted = await fitRecord({ db, chat: session, target, record: messages, overhead, signal: turn.signal });
      // A model whose list says it takes no images gets the text only (the composer's chip said so).
      const known = db.select({ modelLimits: s.connections.modelLimits }).from(s.connections).where(eq(s.connections.id, session.connectionId!)).get()?.modelLimits[target.model]?.images;
      const sendable = imageDecision(known, 1).send ? fitted : withoutImages(fitted);
      let modelMessages: ModelMessage[] = await convertToModelMessages(expandRecord(sendable), { ignoreIncompleteToolCalls: true });
      // Messages no turn has taken yet (sent as the last one was ending, decisions made since) come first.
      const leftover = takeInterjections(db, session.id);
      if (leftover.length) modelMessages = [...modelMessages, interject(leftover)];
      let steps = 0;
      let finishReason: string | undefined;
      for (let pass = 0; steps < MAX_STEPS; pass++) {
        // One log row per pass (its tool steps included); usage comes with the finish.
        const finish = startCall(db, { projectId: session.projectId, kind: 'chat', refId: session.id, label: pass ? '채팅 · 끼어든 메시지 후' : '채팅' }, target);
        // No overall limit (a turn with tool calls can run long): the pass stops when the model sends nothing for chatIdle.
        const idle = new AbortController();
        let quiet: NodeJS.Timeout | undefined;
        const arm = () => {
          clearTimeout(quiet);
          quiet = setTimeout(() => idle.abort(), CALL_TIMEOUT_MS.chatIdle);
        };
        arm();
        const sdk = ai.chatModel(target);
        const result = streamText({
          model: sdk.model,
          onFinish: ({ totalUsage }) => finish({ usage: { inputTokens: totalUsage.inputTokens, cachedInputTokens: totalUsage.inputTokenDetails?.cacheReadTokens, outputTokens: totalUsage.outputTokens } }),
          onError: ({ error }) => finish({ error }),
          onAbort: () => finish({ error: idle.signal.aborted ? `모델이 ${CALL_TIMEOUT_MS.chatIdle / 1000}초 동안 아무것도 보내지 않아 멈춤` : '중단함' }),
          onChunk: arm,
          system,
          messages: modelMessages,
          tools,
          // A waiting steering message ends the pass after the current step (its tool results are in).
          stopWhen: [stepCountIs(MAX_STEPS - steps), () => hasInterjections(db, session.id), afterStartingRun],
          maxOutputTokens: live.snapshot.maxOutputTokens,
          providerOptions: sdk.providerOptions,
          abortSignal: AbortSignal.any([turn.signal, idle.signal]),
        });
        writer.merge(result.toUIMessageStream({ sendStart: false, sendFinish: false, onError: errorText }));
        const passSteps = await Promise.resolve(result.steps).finally(() => clearTimeout(quiet));
        steps += Math.max(1, passSteps.length);
        finishReason = await result.finishReason;
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
  });
}
