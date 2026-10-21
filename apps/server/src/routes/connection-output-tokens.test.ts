import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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
  const send = (method: string, path: string, body: unknown) => app.request(`/connections${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const outputOf = (id: string) => db.select({ outputTokens: s.connections.outputTokens }).from(s.connections).where(eq(s.connections.id, id)).get()?.outputTokens;
  return { send, outputOf };
}

describe('connection output tokens', () => {
  it('keeps the cap for an API connection, which sends it with each call', async () => {
    const { send, outputOf } = setup();
    const { id } = await (await send('POST', '', { kind: 'openai', name: 'API', outputTokens: 4000 })).json();
    expect(outputOf(id)).toBe(4000);
    expect((await send('PATCH', `/${id}`, { outputTokens: 8000 })).status).toBe(200);
    expect(outputOf(id)).toBe(8000);
  });

  it('stores no cap for a CLI connection, which picks its own output length', async () => {
    const { send, outputOf } = setup();
    const { id } = await (await send('POST', '', { kind: 'codex', name: 'Codex', outputTokens: 4000 })).json();
    expect(outputOf(id)).toBeNull();
    expect((await send('PATCH', `/${id}`, { outputTokens: 8000 })).status).toBe(200);
    expect(outputOf(id)).toBeNull();
  });
});
