import { Hono } from 'hono';
import { UI_MESSAGE_STREAM_HEADERS, type UIMessage } from 'ai';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { agentSettingsSchema, modelChoiceSchema, PERMISSION_MODES, type ModelChoice } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { attachTurn, steerable, turnStartedAt } from '../services/chat-turns.ts';
import { enqueueSteer, stopWithQueued } from '../services/chat-interject.ts';
import { closePiChat } from '../services/pi-chat.ts';
import { runChatTurn } from '../services/chat-run.ts';
import { defaultModelChoice } from '../services/routes.ts';

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
    // A new conversation talks to the project's chat model, else the AI the latest one picked, unless told otherwise.
    const settings = agentSettingsSchema.parse(db.select({ settings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.settings ?? {});
    const latest = db.select({ connectionId: s.chatSessions.connectionId, model: s.chatSessions.model, effort: s.chatSessions.effort }).from(s.chatSessions).where(and(eq(s.chatSessions.projectId, projectId), sql`${s.chatSessions.model} is not null`)).orderBy(desc(s.chatSessions.updatedAt)).get();
    const fallback = defaultModelChoice(db, 'chat');
    const choice = c.req.valid('json').model ?? settings.chatModel ?? latest ?? (fallback.connectionId && fallback.model ? fallback : undefined);
    // …and starts in the project's default permission mode (#45).
    const permissionMode = settings.defaultPermissionMode;
    const row = db.insert(s.chatSessions).values({ projectId, title: '새 대화', ...choiceColumns(choice), permissionMode }).returning().get();
    events.changed(projectId, 'chat');
    return c.json(row, 201);
  })
  .get('/projects/:projectId/chat/search', validate('query', z.object({ q: z.string().optional() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const q = c.req.valid('query').q ?? '';
    const needle = q.trim().toLowerCase();
    type Hit = {
      id: string;
      sessionId: string;
      title: string;
      role: 'user' | 'assistant' | 'title';
      snippet: string;
      updatedAt: number;
    };
    if (!needle) return c.json<Hit[]>([]);

    const sessions = db
      .select({
        id: s.chatSessions.id,
        title: s.chatSessions.title,
        messages: s.chatSessions.messages,
        updatedAt: s.chatSessions.updatedAt,
      })
      .from(s.chatSessions)
      .where(eq(s.chatSessions.projectId, projectId))
      .orderBy(desc(s.chatSessions.updatedAt))
      .all();

    const hits: Hit[] = [];

    const extractMessageText = (msg: Record<string, unknown>): string => {
      const parts: string[] = [];
      if (Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (part && typeof part === 'object') {
            const p = part as Record<string, unknown>;
            if (p.type === 'text' && typeof p.text === 'string') {
              parts.push(p.text);
            }
          }
        }
      }
      if (typeof msg.content === 'string') {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (typeof part === 'string') {
            parts.push(part);
          } else if (part && typeof part === 'object') {
            const p = part as Record<string, unknown>;
            if (p.type === 'text' && typeof p.text === 'string') {
              parts.push(p.text);
            }
          }
        }
      }
      return parts.join('\n');
    };

    const makeSnippet = (text: string, queryNeedle: string, maxLength = 80): string => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      const lower = normalized.toLowerCase();
      const idx = lower.indexOf(queryNeedle);
      if (idx === -1) {
        return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
      }
      const beforeLen = 25;
      const start = Math.max(0, idx - beforeLen);
      const end = Math.min(normalized.length, idx + queryNeedle.length + (maxLength - beforeLen - queryNeedle.length));
      let snippet = normalized.slice(start, end).trim();
      if (start > 0) snippet = `…${snippet}`;
      if (end < normalized.length) snippet = `${snippet}…`;
      return snippet;
    };

    for (const session of sessions) {
      if (hits.length >= 30) break;
      const sessionUpdatedAt = session.updatedAt instanceof Date ? session.updatedAt.getTime() : Number(session.updatedAt);
      let rawMessages: unknown[] = [];
      if (Array.isArray(session.messages)) {
        rawMessages = session.messages;
      } else if (typeof session.messages === 'string') {
        try {
          rawMessages = JSON.parse(session.messages);
        } catch {
          rawMessages = [];
        }
      }

      let sessionMatched = false;
      for (let i = 0; i < rawMessages.length; i++) {
        if (hits.length >= 30) break;
        const msg = rawMessages[i];
        if (!msg || typeof msg !== 'object') continue;
        const msgObj = msg as Record<string, unknown>;
        const text = extractMessageText(msgObj);
        if (!text) continue;

        if (text.toLowerCase().includes(needle)) {
          sessionMatched = true;
          const role: 'user' | 'assistant' = msgObj.role === 'user' ? 'user' : 'assistant';
          const msgId = typeof msgObj.id === 'string' && msgObj.id ? msgObj.id : `${session.id}-msg-${i}`;
          hits.push({
            id: msgId,
            sessionId: session.id,
            title: session.title,
            role,
            snippet: makeSnippet(text, needle),
            updatedAt: sessionUpdatedAt,
          });
        }
      }

      if (!sessionMatched && (session.title ?? '').toLowerCase().includes(needle)) {
        if (hits.length < 30) {
          hits.push({
            id: `${session.id}-title`,
            sessionId: session.id,
            title: session.title,
            role: 'title',
            snippet: session.title,
            updatedAt: sessionUpdatedAt,
          });
        }
      }
    }

    return c.json(hits);
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
    enqueueSteer(c.var.deps.db, sessionId, c.req.valid('json').text);
    return c.json({ queued: true });
  })
  .post('/chat/:sessionId/stop', (c) => c.json(stopWithQueued(c.var.deps.db, c.req.param('sessionId'))));
