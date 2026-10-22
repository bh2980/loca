import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { setAgentStarter } from '@tw/ai';
import { inProcessStarter } from '@tw/ai/fake-acp';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { memoryStore } from '../services/secrets.ts';
import { connectionRoutes } from './ai-settings.ts';

function setup() {
  const db = openDatabase(':memory:');
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db, secrets: memoryStore() } as never);
      await next();
    })
    .route('/connections', connectionRoutes)
    .onError((error, c) => (error instanceof HTTPException ? c.json({ error: error.message }, error.status) : c.json({ error: String(error) }, 500)));
  const send = (method: string, path: string, body?: unknown) => app.request(`/connections${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const authMethodOf = (id: string) => db.select({ authMethod: s.connections.authMethod }).from(s.connections).where(eq(s.connections.id, id)).get()?.authMethod;
  return { send, authMethodOf };
}

afterEach(() => setAgentStarter(null));

describe('connection login method', () => {
  it('is stored, changed and cleared back to automatic (null)', async () => {
    const { send, authMethodOf } = setup();
    const { id } = (await (await send('POST', '', { kind: 'antigravity', name: 'agy', authMethod: 'oauth-personal' })).json()) as { id: string };
    expect(authMethodOf(id)).toBe('oauth-personal');
    expect((await send('PATCH', `/${id}`, { authMethod: 'gemini-api-key' })).status).toBe(200);
    expect(authMethodOf(id)).toBe('gemini-api-key');
    expect((await send('PATCH', `/${id}`, { authMethod: null })).status).toBe(200);
    expect(authMethodOf(id)).toBeNull();
  });

  it('is offered by the agent: GET /auth-methods starts it, reads initialize and returns the methods', async () => {
    const { send } = setup();
    setAgentStarter(inProcessStarter({ FAKE_ACP_AUTH: JSON.stringify([{ id: 'oauth-personal', name: 'Log in with Google' }]) }));
    const { id } = (await (await send('POST', '', { kind: 'antigravity', name: 'agy' })).json()) as { id: string };
    expect(await (await send('GET', `/${id}/auth-methods`)).json()).toEqual({ ok: true, methods: [{ id: 'oauth-personal', name: 'Log in with Google' }] });
  });

  it('has no methods for a connection that is not an ACP agent', async () => {
    const { send } = setup();
    const { id } = (await (await send('POST', '', { kind: 'openai', name: 'API' })).json()) as { id: string };
    expect(await (await send('GET', `/${id}/auth-methods`)).json()).toEqual({ ok: true, methods: [] });
  });
});
