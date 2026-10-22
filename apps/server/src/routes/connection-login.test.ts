import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it } from 'vitest';
import { setAgentStarter } from '@tw/ai';
import { inProcessStarter } from '@tw/ai/fake-acp';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
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
  const create = async (kind: string) => ((await (await send('POST', '', { kind, name: kind })).json()) as { id: string }).id;
  return { send, create };
}

afterEach(() => setAgentStarter(null));

const AUTH = JSON.stringify([{ id: 'oauth-personal', name: 'Log in with Google' }]);

describe('GET /connections/:id/login (상태 보기)', () => {
  it('is signed in when the chat path opens a session', async () => {
    const { send, create } = setup();
    setAgentStarter(inProcessStarter({ FAKE_ACP_AUTH: AUTH }));
    expect(await (await send('GET', `/${await create('antigravity')}/login`)).json()).toEqual({ status: 'signed-in' });
  });

  it('is signed out when the CLI refuses the login', async () => {
    const { send, create } = setup();
    setAgentStarter(inProcessStarter({ FAKE_ACP_AUTH: AUTH, FAKE_ACP_AUTH_FAIL: 'no browser' }));
    expect(await (await send('GET', `/${await create('codex')}/login`)).json()).toEqual({ status: 'signed-out' });
  });

  it('returns the real message when the agent cannot start', async () => {
    const { send, create } = setup();
    setAgentStarter(async () => {
      throw new Error('spawn exploded');
    });
    expect(await (await send('GET', `/${await create('claude')}/login`)).json()).toMatchObject({ status: 'error', detail: expect.stringContaining('spawn exploded') });
  });

  it('does not apply to a connection that is not a CLI', async () => {
    const { send, create } = setup();
    expect(await (await send('GET', `/${await create('openai')}/login`)).json()).toEqual({ status: 'not-applicable' });
  });

  it('no longer has an auth-methods endpoint or column', async () => {
    const { send, create } = setup();
    const id = await create('antigravity');
    expect((await send('GET', `/${id}/auth-methods`)).status).toBe(404);
    const body = (await (await send('GET', '')).json()) as Record<string, unknown>[];
    expect(body[0]).not.toHaveProperty('authMethod');
  });
});
