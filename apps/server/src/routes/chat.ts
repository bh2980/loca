import { Hono } from 'hono';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { AGENT_SYSTEM, agentTools } from '../services/agent-tools.ts';
import { liveProfileRoutes } from '../services/routes.ts';

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
        .select({ id: s.chatSessions.id, title: s.chatSessions.title, profileId: s.chatSessions.profileId, updatedAt: s.chatSessions.updatedAt })
        .from(s.chatSessions)
        .where(eq(s.chatSessions.projectId, c.req.param('projectId')))
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
  .get('/chat/:sessionId', (c) => c.json(found(c.var.deps.db.select().from(s.chatSessions).where(eq(s.chatSessions.id, c.req.param('sessionId'))).get(), '대화')))
  .patch('/chat/:sessionId', validate('json', z.object({ title: z.string().trim().min(1).optional(), profileId: z.string().nullable().optional() })), (c) => {
    const { db } = c.var.deps;
    const row = found(db.update(s.chatSessions).set(c.req.valid('json')).where(eq(s.chatSessions.id, c.req.param('sessionId'))).returning().get(), '대화');
    events.changed(row.projectId, 'chat');
    return c.json({ ok: true });
  })
  .delete('/chat/:sessionId', (c) => {
    const { db } = c.var.deps;
    const row = db.delete(s.chatSessions).where(eq(s.chatSessions.id, c.req.param('sessionId'))).returning().get();
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
    if (!route || route.kind !== 'openai') badRequest('채팅은 도구 호출을 지원하는 OpenAI 호환 API 프로필에서만 쓸 수 있습니다.');
    const messages = c.req.valid('json').messages as UIMessage[];

    const firstUser = messages.find((message) => message.role === 'user');
    const firstText = firstUser?.parts.find((part) => part.type === 'text');
    if (session.title === '새 대화' && firstText && 'text' in firstText) {
      db.update(s.chatSessions).set({ title: firstText.text.slice(0, 40) }).where(eq(s.chatSessions.id, session.id)).run();
      events.changed(session.projectId, 'chat');
    }

    const view = c.req.valid('json').view;
    const result = streamText({
      model: ai.chatModel(route),
      system: [AGENT_SYSTEM, live.snapshot.instructions, view && describeView(view)].filter(Boolean).join('\n\n'),
      // An editor proposal left unanswered before the next message is dropped rather than failing the turn.
      messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
      tools: agentTools(db, session.projectId, { profileId: session.profileId, model: route.model }),
      stopWhen: stepCountIs(30),
      maxOutputTokens: live.snapshot.maxOutputTokens,
      temperature: live.snapshot.temperature ?? undefined,
      providerOptions: ai.openaiProviderOptions(route),
      abortSignal: c.req.raw.signal,
    });
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: ({ messages: final }) => {
        db.update(s.chatSessions).set({ messages: final }).where(and(eq(s.chatSessions.id, session.id))).run();
        events.changed(session.projectId, 'chat');
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });
  });
