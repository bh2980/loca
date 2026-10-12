import { Hono } from 'hono';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { CONNECTION_KIND_INFO } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { startCall } from '../services/ai-calls.ts';
import { AGENT_SYSTEM, agentTools } from '../services/agent-tools.ts';
import { readToEnd, startTurn, stopTurn, turnStartedAt } from '../services/chat-turns.ts';
import { liveProfileRoutes } from '../services/routes.ts';
import { closePiChat, piChatResponse } from '../services/pi-chat.ts';
import { withFittedResults } from '../services/tool-output.ts';
import { cliChatResponse } from '../services/cli-chat.ts';

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

export const chatRoutes = new Hono<Env>()
  .get('/projects/:projectId/chat', (c) => {
    const { db } = c.var.deps;
    return c.json(
      db
        // Each conversation's model use (its turns in the AI log): chats are not in 실행 기록, so the panel shows it.
        .select({
          id: s.chatSessions.id,
          title: s.chatSessions.title,
          profileId: s.chatSessions.profileId,
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
  .post('/projects/:projectId/chat', validate('json', z.object({ profileId: z.string().optional() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const row = db.insert(s.chatSessions).values({ projectId, title: '새 대화', profileId: c.req.valid('json').profileId ?? null }).returning().get();
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
  .patch('/chat/:sessionId', validate('json', z.object({ title: z.string().trim().min(1).optional(), profileId: z.string().nullable().optional() })), (c) => {
    const { db } = c.var.deps;
    const row = found(db.update(s.chatSessions).set(c.req.valid('json')).where(eq(s.chatSessions.id, c.req.param('sessionId'))).returning().get(), '대화');
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
  /** AI SDK UI message stream. The client sends the whole conversation; it is saved when the turn ends. */
  .post('/chat/:sessionId/stream', validate('json', z.object({ messages: z.array(z.any()), view: viewSchema.optional() })), async (c) => {
    const { db, secrets } = c.var.deps;
    const session = found(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, c.req.param('sessionId'))).get(), '대화');
    if (!session.profileId) badRequest('대화에 사용할 AI 프로필을 선택하세요.');
    const live = found(liveProfileRoutes(db, session.profileId!, secrets), 'AI 프로필');
    const route = live.routes[0];
    if (!route || !CONNECTION_KIND_INFO[route.kind].capabilities.includes('chat')) badRequest('이 프로필의 연결은 채팅을 지원하지 않습니다(System One은 판정 전용).');
    const messages = c.req.valid('json').messages as UIMessage[];

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
        system: [AGENT_SYSTEM, live.snapshot.instructions].filter(Boolean).join('\n\n'),
        view: view ? describeView(view) : null,
        messages,
        timeoutMs: live.snapshot.timeoutSeconds * 1000,
        signal: turn.signal,
        onEnd: turn.end,
      });
    }
    if (route.kind === 'pi') {
      try {
        return await piChatResponse({
          db,
          chat: session,
          route,
          system: [AGENT_SYSTEM, PI_NOTE, live.snapshot.instructions].filter(Boolean).join('\n\n'),
          view: view ? describeView(view) : null,
          messages,
          signal: turn.signal,
          onEnd: turn.end,
        });
      } catch (error) {
        turn.end();
        return badRequest(error instanceof Error ? error.message : String(error));
      }
    }
    // One log row per turn (its tool steps included); usage comes with the finish.
    const finish = startCall(db, { projectId: session.projectId, kind: 'chat', refId: session.id, label: '채팅', profileId: session.profileId }, route);
    const result = streamText({
      model: ai.chatModel(route),
      onFinish: ({ totalUsage }) => finish({ usage: { inputTokens: totalUsage.inputTokens, cachedInputTokens: totalUsage.inputTokenDetails?.cacheReadTokens, outputTokens: totalUsage.outputTokens } }),
      onError: ({ error }) => finish({ error }),
      onAbort: () => finish({ error: '중단함' }),
      system: [AGENT_SYSTEM, live.snapshot.instructions, view && describeView(view)].filter(Boolean).join('\n\n'),
      // An editor proposal left unanswered before the next message is dropped rather than failing the turn.
      messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
      tools: withFittedResults(agentTools(db, session.projectId, { profileId: session.profileId, model: route.model })),
      stopWhen: stepCountIs(30),
      maxOutputTokens: live.snapshot.maxOutputTokens,
      temperature: live.snapshot.temperature ?? undefined,
      providerOptions: ai.openaiProviderOptions(route),
      abortSignal: turn.signal,
    });
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      // Why the turn ended, so the panel can say "hit the output limit" instead of going quiet.
      messageMetadata: ({ part }) => (part.type === 'finish' ? { finishReason: part.finishReason } : undefined),
      onFinish: ({ messages: final }) => {
        db.update(s.chatSessions).set({ messages: final }).where(and(eq(s.chatSessions.id, session.id))).run();
        events.changed(session.projectId, 'chat');
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
      ...readToEnd(turn.end),
    });
  })
  .post('/chat/:sessionId/stop', (c) => c.json({ stopped: stopTurn(c.req.param('sessionId')) }));
