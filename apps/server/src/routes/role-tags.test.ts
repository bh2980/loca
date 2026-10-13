import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, REVIEW_TAG } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { projectRoutes } from './projects.ts';

describe('app tags and automatic mark colors', () => {
  it('a tag with a role keeps its name and cannot be deleted; its color can change', async () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Line' }] });
    const { projectId } = importProject(db, file, null as never);
    const tag = db.insert(s.tags).values({ projectId, name: REVIEW_TAG.name, color: REVIEW_TAG.color, role: REVIEW_TAG.role }).returning().get();
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/projects', projectRoutes);
    const send = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

    expect((await send('DELETE', `/projects/${projectId}/tags/${tag.id}`)).status).toBe(400);
    expect((await send('PATCH', `/projects/${projectId}/tags/${tag.id}`, { name: '다른 이름' })).status).toBe(400);
    expect((await send('PATCH', `/projects/${projectId}/tags/${tag.id}`, { color: '#22c55e' })).status).toBe(200);
    expect(db.select().from(s.tags).where(eq(s.tags.id, tag.id)).get()).toMatchObject({ name: REVIEW_TAG.name, color: '#22c55e' });

    expect((await send('PATCH', `/projects/${projectId}`, { markColors: { unknownListener: '#22c55e' } })).status).toBe(200);
    const project = (await (await send('GET', `/projects/${projectId}`)).json()) as { markColors: Record<string, string> };
    expect(project.markColors).toEqual({ unknownListener: '#22c55e' });
  });
});
