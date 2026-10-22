import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { editorAiSchema, importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { memoryStore } from '../services/secrets.ts';
import { projectRoutes } from './projects.ts';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@tw/ai', async (original) => ({ ...(await original<typeof import('@tw/ai')>()), generate }));

function setup(withModel = true) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'P' },
    groups: [{ key: 'g', title: 'G' }],
    units: Array.from({ length: 12 }, (_, n) => ({ key: `u${n}`, group: 'g', source: `Line ${n} [[ID_${n}]]` })),
  });
  const { projectId } = importProject(db, file, null as never);
  if (withModel) db.update(s.projects).set({ editorAi: editorAiSchema.parse({ model: { connectionId: connection.id, model: 'm' } }) }).where(eq(s.projects.id, projectId)).run();
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db, secrets: memoryStore() } as never);
      await next();
    })
    .route('/projects', projectRoutes)
    .onError((error, c) => (error instanceof HTTPException ? c.json({ error: error.message }, error.status) : c.json({ error: String(error) }, 500)));
  const post = (body: unknown, id = projectId) => app.request(`/projects/${id}/generate-regex`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { post, projectId };
}

const answer = (object: unknown) => generate.mockResolvedValueOnce({ object, usage: { inputTokens: 1, outputTokens: 1 } });

describe('POST /projects/:projectId/generate-regex', () => {
  beforeEach(() => generate.mockReset());

  it('returns one rule and sends at most 10 source lines with the request', async () => {
    const { post } = setup();
    answer({ label: '이중 대괄호 변수', kind: 'placeholder', pattern: String.raw`\[\[[A-Z_0-9]+\]\]`, example: '[[ID_1]]' });
    const response = await post({ prompt: '대괄호 두 개로 감싼 변수', target: 'token' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ label: '이중 대괄호 변수', kind: 'placeholder', pattern: String.raw`\[\[[A-Z_0-9]+\]\]`, example: '[[ID_1]]' });
    const { prompt } = generate.mock.calls[0]![1] as { prompt: string };
    expect(prompt).toContain('대괄호 두 개로 감싼 변수');
    expect(prompt.match(/^- Line /gm)).toHaveLength(10);
  });

  it('answers 400 for a pattern that does not compile or matches nothing-length, and for a kind of the other target', async () => {
    const { post } = setup();
    answer({ label: 'x', kind: 'tag', pattern: '[unclosed', example: '' });
    const bad = await post({ prompt: 'x', target: 'token' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('정규식');
    answer({ label: 'x', kind: 'tag', pattern: 'a*', example: '' });
    expect((await post({ prompt: 'x', target: 'token' })).status).toBe(400);
    answer({ label: 'x', kind: 'forbidden', pattern: 'a', example: 'a' });
    expect((await post({ prompt: 'x', target: 'token' })).status).toBeGreaterThanOrEqual(400);
  });

  it('accepts check kinds for the check target', async () => {
    const { post } = setup();
    answer({ label: '금지', kind: 'forbidden', pattern: 'TODO', example: 'TODO' });
    expect(await (await post({ prompt: 'TODO 금지', target: 'check' })).json()).toMatchObject({ kind: 'forbidden' });
  });

  it('refuses without an editor AI model, an empty prompt and an unknown project', async () => {
    const none = setup(false);
    const response = await none.post({ prompt: 'x', target: 'token' });
    expect(response.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
    const { post } = setup();
    expect((await post({ prompt: '  ', target: 'token' })).status).toBe(400);
    expect((await post({ prompt: 'x', target: 'token' }, 'missing')).status).toBe(404);
  });
});
