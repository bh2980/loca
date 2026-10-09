import { Hono } from 'hono';
import { asc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { CONNECTION_KIND_INFO, connectionInputSchema, patchOf, profileInputSchema } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { connectionRoute, liveProfileRoutes } from '../services/routes.ts';

type CliKind = 'codex' | 'claude' | 'grok' | 'antigravity' | 'opencode';
const isCli = (kind: string): kind is CliKind => CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.transport === 'cli';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const connectionRoutes = new Hono<Env>()
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
    events.changed(undefined, 'connections', 'profiles');
    return c.json({ ok: true });
  })
  .delete('/:id', (c) => {
    const { db, secrets } = c.var.deps;
    const id = c.req.param('id');
    const users = db
      .select({ name: s.profiles.name })
      .from(s.profiles)
      .where(or(eq(s.profiles.connectionId, id), sql`exists (select 1 from json_each(${s.profiles.fallbacks}) where json_extract(value, '$.connectionId') = ${id})`))
      .all();
    if (users.length) badRequest(`이 연결을 쓰는 프로필이 있습니다: ${users.map((user) => user.name).join(', ')}`);
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

export const profileRoutes = new Hono<Env>()
  .get('/', (c) => c.json(c.var.deps.db.select().from(s.profiles).orderBy(asc(s.profiles.name)).all()))
  .post('/', validate('json', profileInputSchema), (c) => {
    const { db } = c.var.deps;
    const input = c.req.valid('json');
    found(db.select().from(s.connections).where(eq(s.connections.id, input.connectionId)).get(), '연결');
    const row = db.insert(s.profiles).values(input).returning().get();
    events.changed(undefined, 'profiles');
    return c.json(row, 201);
  })
  .put('/:id', validate('json', profileInputSchema), (c) => {
    const { db } = c.var.deps;
    found(db.update(s.profiles).set(c.req.valid('json')).where(eq(s.profiles.id, c.req.param('id'))).returning().get(), '프로필');
    events.changed(undefined, 'profiles', 'workflows');
    return c.json({ ok: true });
  })
  .delete('/:id', (c) => {
    const { db } = c.var.deps;
    db.delete(s.profiles).where(eq(s.profiles.id, c.req.param('id'))).run();
    events.changed(undefined, 'profiles', 'workflows');
    return c.json({ ok: true });
  })
  /** One-off translation with the saved profile. Nothing is written to any project. */
  .post('/:id/test', validate('json', z.object({ source: z.string().min(1), targetLanguage: z.string().default('ko') })), async (c) => {
    const { db, secrets } = c.var.deps;
    const live = found(liveProfileRoutes(db, c.req.param('id'), secrets), '프로필');
    const { source, targetLanguage } = c.req.valid('json');
    const started = Date.now();
    try {
      const { result, route, attempts } = await ai.withFallback(live.routes, live.snapshot.maxAttempts, (route) =>
        route.kind === 'systemone'
          ? ai.judge(route, { state: { source }, instructions: 'Is this text well-formed?', timeoutMs: live.snapshot.timeoutSeconds * 1000 }).then((judged) => ({ text: judged.passed ? 'pass' : 'fail', usage: judged.usage }))
          : ai
              .generate(route, {
                system: `Translate the text into ${targetLanguage}. ${live.snapshot.instructions}`,
                prompt: source,
                schema: z.object({ text: z.string() }),
                maxOutputTokens: live.snapshot.maxOutputTokens,
                temperature: live.snapshot.temperature ?? undefined,
                timeoutMs: live.snapshot.timeoutSeconds * 1000,
              })
              .then((generated) => ({ text: generated.object.text, usage: generated.usage })),
      );
      return c.json({ ok: true as const, text: result.text, model: route.model, attempts, ms: Date.now() - started });
    } catch (error) {
      return c.json({ ok: false as const, detail: message(error), ms: Date.now() - started });
    }
  });
