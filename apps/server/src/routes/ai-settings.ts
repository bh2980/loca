import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { CALL_TIMEOUT_MS, CONNECTION_KIND_INFO, connectionInputSchema, patchOf } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { logged } from '../services/ai-calls.ts';
import type { Db } from '../db/index.ts';
import { choiceLabel, connectionRoute, liveChoice } from '../services/routes.ts';

type CliKind = 'codex' | 'claude' | 'grok' | 'antigravity' | 'opencode';
const isCli = (kind: string): kind is CliKind => CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.transport === 'cli';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Where a connection is picked: AI nodes and 재요청 nodes (by workflow) and conversations. */
function usesOf(db: Db, id: string) {
  const workflows = db
    .select({ name: s.workflows.name, project: s.projects.name, definition: s.workflows.definition })
    .from(s.workflows)
    .innerJoin(s.projects, eq(s.projects.id, s.workflows.projectId))
    .all()
    .filter((row) => row.definition.nodes.some((node) => (node.type === 'ai' && node.config.model.connectionId === id) || (node.type === 'retry' && node.config.model?.connectionId === id)))
    .map((row) => `워크플로 '${row.name}'(${row.project})`);
  const chats = db.select({ id: s.chatSessions.id }).from(s.chatSessions).where(eq(s.chatSessions.connectionId, id)).all().length;
  return [...workflows, ...(chats ? [`대화 ${chats}개`] : [])];
}

export const connectionRoutes = new Hono<Env>()
  // Where a CLI connection's executable resolves (for the form: found path and version, or not found).
  .post('/locate', validate('json', z.object({ kind: z.string(), executable: z.string().optional() })), async (c) => {
    const { kind, executable } = c.req.valid('json');
    if (CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.transport !== 'cli') badRequest('CLI 연결이 아닙니다.');
    return c.json(await ai.locateCli(kind as Parameters<typeof ai.locateCli>[0], executable));
  })
  .get('/', (c) => {
    const { db, secrets } = c.var.deps;
    const rows = db.select().from(s.connections).orderBy(asc(s.connections.name)).all();
    return c.json(rows.map((row) => ({ ...row, hasKey: secrets.get(row.id) !== null })));
  })
  .post('/', validate('json', connectionInputSchema.extend({ apiKey: z.string().optional() })), (c) => {
    const { db, secrets } = c.var.deps;
    const { apiKey, ...input } = c.req.valid('json');
    const info = CONNECTION_KIND_INFO[input.kind];
    const row = db
      .insert(s.connections)
      .values({ ...input, baseUrl: info.transport === 'http' ? (input.baseUrl ?? info.defaultBaseUrl) : null, executable: input.executable || null })
      .returning()
      .get();
    if (apiKey) secrets.set(row.id, apiKey);
    events.changed(undefined, 'connections');
    return c.json(row, 201);
  })
  .patch('/:id', validate('json', patchOf(connectionInputSchema.omit({ kind: true }))), (c) => {
    const { db } = c.var.deps;
    const input = c.req.valid('json');
    found(db.update(s.connections).set({ ...input, executable: input.executable === '' ? null : input.executable }).where(eq(s.connections.id, c.req.param('id'))).returning().get(), '연결');
    events.changed(undefined, 'connections');
    return c.json({ ok: true });
  })
  .delete('/:id', (c) => {
    const { db, secrets } = c.var.deps;
    const id = c.req.param('id');
    const uses = usesOf(db, id);
    if (uses.length) badRequest(`이 연결을 쓰는 곳이 있습니다: ${uses.slice(0, 5).join(', ')}${uses.length > 5 ? ` 외 ${uses.length - 5}곳` : ''}. 그곳에서 다른 연결을 고른 뒤 지우세요.`);
    db.delete(s.connections).where(eq(s.connections.id, id)).run();
    secrets.delete(id);
    events.changed(undefined, 'connections');
    return c.json({ ok: true });
  })
  .put('/:id/key', validate('json', z.object({ apiKey: z.string().trim().min(1) })), (c) => {
    const { db, secrets } = c.var.deps;
    found(db.select().from(s.connections).where(eq(s.connections.id, c.req.param('id'))).get(), '연결');
    secrets.set(c.req.param('id'), c.req.valid('json').apiKey);
    events.changed(undefined, 'connections');
    return c.json({ ok: true });
  })
  .delete('/:id/key', (c) => {
    c.var.deps.secrets.delete(c.req.param('id'));
    events.changed(undefined, 'connections');
    return c.json({ ok: true });
  })
  .post('/:id/probe', async (c) => {
    const { db, secrets } = c.var.deps;
    const route = found(connectionRoute(db, c.req.param('id'), secrets), '연결');
    try {
      return c.json({ ok: true as const, detail: await ai.probe(route) });
    } catch (error) {
      return c.json({ ok: false as const, detail: message(error) });
    }
  })
  .get('/:id/models', async (c) => {
    const { db, secrets } = c.var.deps;
    const id = c.req.param('id');
    const route = found(connectionRoute(db, id, secrets), '연결');
    try {
      const { models, limits: listed } = await ai.listModelCatalog(route);
      // What the list says about each model's limits is kept for "auto" budgets; a person's numbers stay.
      if (Object.keys(listed).length) {
        const current = db.select({ limits: s.connections.modelLimits }).from(s.connections).where(eq(s.connections.id, id)).get()?.limits ?? {};
        const next = { ...current };
        for (const [model, limits] of Object.entries(listed)) if (current[model]?.by !== 'human') next[model] = { ...limits, by: 'api' as const };
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          db.update(s.connections).set({ modelLimits: next }).where(eq(s.connections.id, id)).run();
          events.changed(undefined, 'connections');
        }
      }
      return c.json({ ok: true as const, models });
    } catch (error) {
      return c.json({ ok: false as const, models: null, detail: message(error) });
    }
  })
  .get('/:id/login', async (c) => {
    const { db, secrets } = c.var.deps;
    const route = found(connectionRoute(db, c.req.param('id'), secrets), '연결');
    if (!isCli(route.kind)) return c.json({ status: 'not-applicable' as const });
    // The chat's own path: start the agent and open a session (no prompt, no model call), then stop it.
    try {
      return c.json({ status: await ai.checkCliLogin(route.kind as ai.AcpKind, route.executable) });
    } catch (error) {
      return c.json({ status: 'error' as const, detail: message(error) });
    }
  })
  .post('/:id/login', async (c) => {
    const { db, secrets } = c.var.deps;
    const route = found(connectionRoute(db, c.req.param('id'), secrets), '연결');
    if (!isCli(route.kind)) badRequest('CLI 연결만 로그인 창을 열 수 있습니다.');
    try {
      await ai.openLoginTerminal(route.kind as CliKind, route.executable);
      return c.json({ ok: true as const, command: [route.executable || route.kind, ...ai.LOGIN_COMMANDS[route.kind as CliKind]].join(' ') });
    } catch (error) {
      return c.json({ ok: false as const, detail: message(error) });
    }
  });

/** Model tests: a one-off translation through a connection, written to no project. */
export const modelTestRoutes = new Hono<Env>()
  /** Recent tests of one connection, from the AI log (they belong to no project, so 실행 기록 does not list them). */
  .get('/connections/:id/tests', (c) =>
    c.json(c.var.deps.db.select().from(s.aiCalls).where(and(eq(s.aiCalls.kind, 'test'), eq(s.aiCalls.refId, c.req.param('id')))).orderBy(desc(s.aiCalls.startedAt)).limit(5).all()),
  )
  .post('/connections/:id/test', validate('json', z.object({ model: z.string().trim().min(1), effort: z.string().optional(), source: z.string().min(1), targetLanguage: z.string().default('ko') })), async (c) => {
    const { db, secrets } = c.var.deps;
    const { model, effort, source, targetLanguage } = c.req.valid('json');
    const choice = { connectionId: c.req.param('id'), model, ...(effort && { effort }) };
    const connection = found(db.select().from(s.connections).where(eq(s.connections.id, choice.connectionId)).get(), '연결');
    const started = Date.now();
    try {
      const judge = connection.kind === 'systemone';
      const live = liveChoice(db, choice, secrets, judge ? 'judge' : 'generate');
      const call = { projectId: null, kind: 'test' as const, refId: connection.id, label: `모델 시험 · ${choiceLabel(connection.name, choice)}` };
      const { result, route } = await ai.callOnce(live.route, (route) =>
        logged(db, call, route, () => route.kind === 'systemone'
          ? ai.judge(route, { state: { source }, instructions: 'Is this text well-formed?', timeoutMs: CALL_TIMEOUT_MS.connectionTest }).then((judged) => ({ text: judged.passed ? 'pass' : 'fail', usage: judged.usage }))
          : ai
              .generate(route, {
                system: `Translate the text into ${targetLanguage}.`,
                prompt: source,
                schema: z.object({ text: z.string() }),
                maxOutputTokens: live.snapshot.maxOutputTokens,
                timeoutMs: CALL_TIMEOUT_MS.connectionTest,
              })
              .then((generated) => ({ text: generated.object.text, usage: generated.usage })),
        ),
      );
      return c.json({ ok: true as const, text: result.text, model: route.model, ms: Date.now() - started });
    } catch (error) {
      return c.json({ ok: false as const, detail: message(error), ms: Date.now() - started });
    }
  });
