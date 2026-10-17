import { Hono } from 'hono';
import { UI_MESSAGE_STREAM_HEADERS, type UIMessage } from 'ai';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { modelChoiceSchema, PERMISSION_MODES, type ModelChoice } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { attachTurn, enqueueSteer, steerable, stopTurn, turnStartedAt } from '../services/chat-turns.ts';
import { closePiChat } from '../services/pi-chat.ts';
import { runChatTurn } from '../services/chat-run.ts';

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
          permissionMode: s.chatSessions.permissionMode,
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
    // …and starts in the project's default permission mode (#45).
    const permissionMode = db.select({ settings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.settings.defaultPermissionMode ?? 'ask';
    const row = db.insert(s.chatSessions).values({ projectId, title: '새 대화', ...choiceColumns(choice), permissionMode }).returning().get();
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
  .patch('/chat/:sessionId', validate('json', z.object({ title: z.string().trim().min(1).optional(), model: modelChoiceSchema.optional(), permissionMode: z.enum(PERMISSION_MODES).optional() })), (c) => {
    const { db } = c.var.deps;
    const { title, model, permissionMode } = c.req.valid('json');
    // A mode switch applies from the agent's next change, even mid-turn (change-gate reads it then).
    const row = found(db.update(s.chatSessions).set({ title, permissionMode, ...(model && choiceColumns(model)) }).where(eq(s.chatSessions.id, c.req.param('sessionId'))).returning().get(), '대화');
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
    const { db } = c.var.deps;
    const session = found(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, c.req.param('sessionId'))).get(), '대화');
    const body = c.req.valid('json');
    try {
      return await runChatTurn(c.var.deps, session, { incoming: (body.message ?? body.messages?.at(-1)) as UIMessage | undefined, trigger: body.trigger, view: body.view ? describeView(body.view) : null });
    } catch (error) {
      badRequest(error instanceof Error ? error.message : String(error));
    }
  })
  // The running turn's reply from its start, for a window that is not streaming it (a reload, another
  // window, a turn the server started after the last proposal was decided). 204 when none is running.
  .get('/chat/:sessionId/stream', (c) => {
    const stream = attachTurn(c.req.param('sessionId'));
    if (!stream) return c.body(null, 204);
    return new Response(stream.pipeThrough(new TextEncoderStream()), { headers: UI_MESSAGE_STREAM_HEADERS });
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
