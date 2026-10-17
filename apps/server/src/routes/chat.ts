import { Hono } from 'hono';
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, type ModelMessage, type UIMessage } from 'ai';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { modelChoiceSchema, type ModelChoice } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { startCall } from '../services/ai-calls.ts';
import { AGENT_SYSTEM, agentTools } from '../services/agent-tools.ts';
import { enqueueSteer, hasSteers, readToEnd, startTurn, steerable, steerPrompt, stopTurn, takeSteers, turnStartedAt } from '../services/chat-turns.ts';
import type { Db } from '../db/index.ts';
import { liveChoice } from '../services/routes.ts';
import { closePiChat, piChatResponse } from '../services/pi-chat.ts';
import { withFittedResults } from '../services/tool-output.ts';
import { cliChatResponse } from '../services/cli-chat.ts';
import { CONTEXT_BUDGET, fitMessages, mergeIncoming, type AnsweredBy } from '../services/chat-context.ts';

/** pi cannot pause a tool call for a card, so change tools there record a proposal instead. */
const PI_NOTE = `이 대화에서 프로젝트를 바꾸는 도구(save_*, propose_translation)는 바로 실행되지 않고 '제안'으로 올라갑니다. 사용자가 채팅 패널의 카드에서 수락하면 반영되고, 결과는 다음 메시지 앞에 알려 드립니다. 제안한 뒤에는 무엇을 왜 제안했는지 짧게 설명하고 기다리세요. 워크플로 노드 편집(edit_workflow_node)은 이 대화에서 쓸 수 없습니다.`;

/**
 * What the user is looking at when they send a message. The web app reports it from every page,
 * so "this line" or "this node" resolve without the user pasting ids.
 */
const viewSchema = z.object({
  page: z.string(),
  path: z.string(),
  items: z.array(z.object({ kind: z.string(), id: z.string(), label: z.string(), detail: z.string().max(6000).optional() })).max(20),
});

const describeView = (view: z.infer<typeof viewSchema>) =>
  [
    '사용자의 현재 화면 (지시어 "이것/이 대사/이 노드"는 여기를 가리킵니다):',
    `- 페이지: ${view.page} (${view.path})`,
    ...view.items.map((item) => `- ${item.kind}: ${item.label} [id=${item.id}]${item.detail ? `\n  ${item.detail}` : ''}`),
  ].join('\n');

const choiceColumns = (choice: Partial<ModelChoice> | { connectionId: string | null; model: string | null; effort: string | null } | undefined) => ({
  connectionId: choice?.connectionId ?? null,
  model: choice?.model ?? null,
  effort: choice?.effort || null,
});

export const chatRoutes = new Hono<Env>()
  .get('/projects/:projectId/chat', (c) => {
    const { db } = c.var.deps;
    return c.json(
      db
        // Each conversation's model use (its turns in the AI log): chats are not in 실행 기록, so the panel shows it.
        .select({
          id: s.chatSessions.id,
          title: s.chatSessions.title,
          connectionId: s.chatSessions.connectionId,
          model: s.chatSessions.model,
          effort: s.chatSessions.effort,
          updatedAt: s.chatSessions.updatedAt,
          calls: sql<number>`count(${s.aiCalls.id})`,
          tokens: sql<number>`coalesce(sum(${s.aiCalls.inputTokens}), 0) + coalesce(sum(${s.aiCalls.outputTokens}), 0)`,
        })
        .from(s.chatSessions)
        .leftJoin(s.aiCalls, eq(s.aiCalls.refId, s.chatSessions.id))
        .where(eq(s.chatSessions.projectId, c.req.param('projectId')))
        .groupBy(s.chatSessions.id)
        .orderBy(desc(s.chatSessions.updatedAt))
        .all(),
    );
  })
  .post('/projects/:projectId/chat', validate('json', z.object({ model: modelChoiceSchema.optional() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    // A new conversation talks to the AI the latest one picked, unless told otherwise.
    const latest = db.select({ connectionId: s.chatSessions.connectionId, model: s.chatSessions.model, effort: s.chatSessions.effort }).from(s.chatSessions).where(and(eq(s.chatSessions.projectId, projectId), sql`${s.chatSessions.model} is not null`)).orderBy(desc(s.chatSessions.updatedAt)).get();
    const choice = c.req.valid('json').model ?? latest;
    const row = db.insert(s.chatSessions).values({ projectId, title: '새 대화', ...choiceColumns(choice) }).returning().get();
    events.changed(projectId, 'chat');
    return c.json(row, 201);
  })
  .get('/chat/:sessionId', (c) => {
    const { db } = c.var.deps;
    const sessionId = c.req.param('sessionId');
    const session = found(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get(), '대화');
    // What the latest turn is doing or how it ended, for a panel that is not streaming it (after a reload).
    const call = db.select({ label: s.aiCalls.label, status: s.aiCalls.status, error: s.aiCalls.error, startedAt: s.aiCalls.startedAt }).from(s.aiCalls).where(eq(s.aiCalls.refId, sessionId)).orderBy(desc(s.aiCalls.startedAt)).get() ?? null;
    return c.json({ ...session, turn: { startedAt: turnStartedAt(sessionId), call } });
  })
  .patch('/chat/:sessionId', validate('json', z.object({ title: z.string().trim().min(1).optional(), model: modelChoiceSchema.optional() })), (c) => {
    const { db } = c.var.deps;
    const { title, model } = c.req.valid('json');
    const row = found(db.update(s.chatSessions).set({ title, ...(model && choiceColumns(model)) }).where(eq(s.chatSessions.id, c.req.param('sessionId'))).returning().get(), '대화');
    // A pi session is bound to its model: the next turn opens a new one.
    if (model) closePiChat(row.id);
    events.changed(row.projectId, 'chat');
    return c.json({ ok: true });
  })
  .delete('/chat/:sessionId', (c) => {
    const { db } = c.var.deps;
    const row = db.delete(s.chatSessions).where(eq(s.chatSessions.id, c.req.param('sessionId'))).returning().get();
    closePiChat(c.req.param('sessionId'));
    if (row) events.changed(row.projectId, 'chat');
    return c.json({ ok: true });
  })
  // The server owns the conversation record (#46): the browser sends the new message only (an
  // answered approval resends the reply it belongs to), and the turn reads everything else from here.
  .post('/chat/:sessionId/stream', validate('json', z.object({ message: z.any().optional(), messages: z.array(z.any()).optional(), trigger: z.enum(['submit-message', 'regenerate-message']).optional(), view: viewSchema.optional() })), async (c) => {
    const { db, secrets } = c.var.deps;
    const session = found(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, c.req.param('sessionId'))).get(), '대화');
    if (!session.connectionId || !session.model) badRequest('입력창 아래에서 채팅할 AI 연결과 모델을 고르세요.');
    let live: ReturnType<typeof liveChoice>;
    try {
      live = liveChoice(db, { connectionId: session.connectionId!, model: session.model!, ...(session.effort && { effort: session.effort }) }, secrets, 'chat');
    } catch (error) {
      badRequest(error instanceof Error ? error.message : String(error));
    }
    // A chat talks to one model: the connection's fallback is for workflow and analysis requests.
    const route = live.routes[0]!;
    const body = c.req.valid('json');
    const incoming = (body.message ?? body.messages?.at(-1)) as UIMessage | undefined;
    const messages = mergeIncoming(session.messages as UIMessage[], incoming, body.trigger);
    if (!messages.length) badRequest('보낼 메시지가 없습니다.');
    const answeredBy: AnsweredBy = { kind: route.kind, connectionId: session.connectionId!, model: route.model };

    const firstUser = messages.find((message) => message.role === 'user');
    const firstText = firstUser?.parts.find((part) => part.type === 'text');
    if (session.title === '새 대화' && firstText && 'text' in firstText) {
      db.update(s.chatSessions).set({ title: firstText.text.slice(0, 40) }).where(eq(s.chatSessions.id, session.id)).run();
      events.changed(session.projectId, 'chat');
    }

    // Kept before the reply starts: if the turn is cut off (the page closed, the connection dropped),
    // the question is not lost; the reply replaces this when it ends.
    db.update(s.chatSessions).set({ messages }).where(eq(s.chatSessions.id, session.id)).run();

    const view = c.req.valid('json').view;
    // The turn, not this request, decides when the reply stops (a reload keeps it going; 중단 stops it).
    const turn = startTurn(session.projectId, session.id);
    if ((ai.CHAT_CLI_KINDS as string[]).includes(route.kind)) {
      return cliChatResponse({
        db,
        chat: session,
        route,
        system: AGENT_SYSTEM,
        view: view ? describeView(view) : null,
        messages,
        answeredBy,
        timeoutMs: live.snapshot.timeoutSeconds * 1000,
        signal: turn.signal,
        onEnd: turn.end,
        markClosing: turn.markClosing,
      });
    }
    if (route.kind === 'pi') {
      try {
        return await piChatResponse({
          db,
          chat: session,
          route,
          system: [AGENT_SYSTEM, PI_NOTE].join('\n\n'),
          view: view ? describeView(view) : null,
          messages,
          answeredBy,
          signal: turn.signal,
          onEnd: turn.end,
          markClosing: turn.markClosing,
        });
      } catch (error) {
        turn.end();
        badRequest(error instanceof Error ? error.message : String(error));
      }
    }
    return apiChatResponse({ db, session, route, live, view: view ? describeView(view) : null, messages, answeredBy, turn });
  })
  // A message sent while the reply is running (#44): the turn takes it at its next step. Refused
  // (409) when no turn can take it any more; the browser then sends it as a new message.
  .post('/chat/:sessionId/steer', validate('json', z.object({ text: z.string().trim().min(1).max(20_000) })), (c) => {
    const sessionId = c.req.param('sessionId');
    if (!steerable(sessionId)) return c.json({ queued: false }, 409);
    enqueueSteer(sessionId, c.req.valid('json').text);
    return c.json({ queued: true });
  })
  .post('/chat/:sessionId/stop', (c) => c.json(stopTurn(c.req.param('sessionId'))));

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
  turn: ReturnType<typeof startTurn>;
}) {
  const { db, session, route, live, messages, answeredBy, turn } = input;
  const tools = withFittedResults(agentTools(db, session.projectId, { model: route.model }));
  const last = messages.at(-1);
  // A reply whose tool approval was just answered goes on in the same message.
  const messageId = last?.role === 'assistant' ? last.id : crypto.randomUUID();
  const stream = createUIMessageStream({
    originalMessages: messages,
    generateId: () => crypto.randomUUID(),
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageId, messageMetadata: { answeredBy } });
      const steer = (texts: string[]) => {
        for (const text of texts) writer.write({ type: 'data-steer', data: { text } });
        return { role: 'user' as const, content: steerPrompt(texts) };
      };
      // An editor proposal left unanswered before the next message is dropped rather than failing the turn.
      let modelMessages: ModelMessage[] = await convertToModelMessages(fitMessages(messages, CONTEXT_BUDGET.api), { ignoreIncompleteToolCalls: true });
      // Messages a previous turn could not take (it stopped for an approval) come first.
      const leftover = takeSteers(session.id);
      if (leftover.length) modelMessages = [...modelMessages, steer(leftover)];
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
          stopWhen: [stepCountIs(MAX_STEPS - steps), () => hasSteers(session.id)],
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
        const texts = takeSteers(session.id);
        if (!texts.length) {
          turn.markClosing();
          break;
        }
        modelMessages = [...modelMessages, ...(await result.response).messages, steer(texts)];
      }
      turn.markClosing();
      // Who answered, and why the turn ended (the panel says "hit the output limit" instead of going quiet).
      writer.write({ type: 'finish', ...(finishReason && { finishReason: finishReason as never }), messageMetadata: { answeredBy, finishReason } });
    },
    onFinish: ({ messages: final }) => {
      db.update(s.chatSessions).set({ messages: final }).where(eq(s.chatSessions.id, session.id)).run();
      events.changed(session.projectId, 'chat');
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
  return createUIMessageStreamResponse({ stream, ...readToEnd(turn.end) });
}
