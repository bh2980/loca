import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { CONNECTION_KIND_INFO, connectionInputSchema, patchOf, type ModelChoice } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { logged } from '../services/ai-calls.ts';
import type { Db } from '../db/index.ts';
import { choiceLabel, connectionRoute, fillDefaultModels, liveChoice } from '../services/routes.ts';

type CliKind = 'codex' | 'claude' | 'grok' | 'antigravity' | 'opencode';
const isCli = (kind: string): kind is CliKind => CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.transport === 'cli';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A fallback must lead somewhere else: itself would only repeat the same failing calls. */
function checkFallback(db: Db, id: string | null, fallback: ModelChoice | null | undefined) {
  if (!fallback) return;
  if (fallback.connectionId === id) badRequest('막히면 넘길 곳으로 같은 연결을 고를 수 없습니다.');
  const target = found(db.select().from(s.connections).where(eq(s.connections.id, fallback.connectionId)).get(), '막히면 넘길 연결');
  if (target.kind === 'http') badRequest('API 키 연결로는 넘길 수 없습니다.');
}

/** Where a connection is picked: AI nodes (by workflow), conversations and other connections' fallbacks. */
function usesOf(db: Db, id: string) {
  const workflows = db
    .select({ name: s.workflows.name, project: s.projects.name, definition: s.workflows.definition })
    .from(s.workflows)
    .innerJoin(s.projects, eq(s.projects.id, s.workflows.projectId))
    .all()
    .filter((row) => row.definition.nodes.some((node) => node.type === 'ai' && [node.config.model, ...node.config.extraModels].some((choice) => choice.connectionId === id)))
    .map((row) => `워크플로 '${row.name}'(${row.project})`);
  const chats = db.select({ id: s.chatSessions.id }).from(s.chatSessions).where(eq(s.chatSessions.connectionId, id)).all().length;
  const fallbacks = db.select({ name: s.connections.name, fallback: s.connections.fallback }).from(s.connections).all().filter((row) => row.fallback?.connectionId === id).map((row) => `연결 '${row.name}'의 막히면`);
  return [...workflows, ...(chats ? [`대화 ${chats}개`] : []), ...fallbacks];
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
    checkFallback(db, null, input.fallback);
    const row = db
      .insert(s.connections)
      .values({ ...input, baseUrl: info.transport === 'http' ? (input.baseUrl ?? info.defaultBaseUrl) : null, executable: input.executable || null })
      .returning()
      .get();
    if (apiKey) secrets.set(row.id, apiKey);
    // Its default model goes into AI nodes that were saved before any model could be picked.
    const filled = row.defaultModel ? fillDefaultModels(db) : [];
    events.changed(undefined, 'connections', ...(filled.length ? (['workflows'] as const) : []));
    return c.json(row, 201);
  })
  .patch('/:id', validate('json', patchOf(connectionInputSchema.omit({ kind: true }))), (c) => {
    const { db } = c.var.deps;
    const input = c.req.valid('json');
    checkFallback(db, c.req.param('id'), input.fallback);
    found(db.update(s.connections).set({ ...input, executable: input.executable === '' ? null : input.executable, defaultModel: input.defaultModel || (input.defaultModel === undefined ? undefined : null), defaultEffort: input.defaultEffort || (input.defaultEffort === undefined ? undefined : null) }).where(eq(s.connections.id, c.req.param('id'))).returning().get(), '연결');
    if (input.defaultModel) fillDefaultModels(db);
    events.changed(undefined, 'connections', 'workflows');
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
  /** What a pi connection can load (extensions, skills…), for its switches on the settings page. */
  .get('/:id/pi-resources', async (c) => {
    const { db, secrets } = c.var.deps;
    const route = found(connectionRoute(db, c.req.param('id'), secrets), '연결');
    if (route.kind !== 'pi') badRequest('pi 연결이 아닙니다.');
    try {
      return c.json({ ok: true as const, ...(await ai.piResources(route.piOptions)) });
    } catch (error) {
      return c.json({ ok: false as const, detail: message(error) });
    }
  })
  .get('/:id/models', async (c) => {
    const { db, secrets } = c.var.deps;
    const route = found(connectionRoute(db, c.req.param('id'), secrets), '연결');
    try {
      return c.json({ ok: true as const, models: await ai.listModels(route) });
    } catch (error) {
      return c.json({ ok: false as const, models: null, detail: message(error) });
    }
  })
  .get('/:id/login', async (c) => {
    const { db, secrets } = c.var.deps;
    const route = found(connectionRoute(db, c.req.param('id'), secrets), '연결');
    if (!isCli(route.kind)) return c.json({ status: 'not-applicable' as const });
    try {
      return c.json({ status: await ai.cliLoginStatus(route.kind, route.executable) });
    } catch {
      return c.json({ status: 'unknown' as const });
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
      const { result, route, attempts } = await ai.withFallback(live.routes, live.snapshot.maxAttempts, (route) =>
        logged(db, call, route, () => route.kind === 'systemone'
          ? ai.judge(route, { state: { source }, instructions: 'Is this text well-formed?', timeoutMs: live.snapshot.timeoutSeconds * 1000 }).then((judged) => ({ text: judged.passed ? 'pass' : 'fail', usage: judged.usage }))
          : ai
              .generate(route, {
                system: `Translate the text into ${targetLanguage}.`,
                prompt: source,
                schema: z.object({ text: z.string() }),
                maxOutputTokens: live.snapshot.maxOutputTokens,
                timeoutMs: live.snapshot.timeoutSeconds * 1000,
              })
              .then((generated) => ({ text: generated.object.text, usage: generated.usage })),
        ),
      );
      return c.json({ ok: true as const, text: result.text, model: route.model, fellBack: route.connectionId !== choice.connectionId || route.model !== choice.model, attempts, ms: Date.now() - started });
    } catch (error) {
      return c.json({ ok: false as const, detail: message(error), ms: Date.now() - started });
    }
  });
