import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, REVIEW_TAG } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { knowledgeRoutes } from './knowledge.ts';
import { projectRoutes } from './projects.ts';
import { sourceRoutes } from './source.ts';

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

describe('tag scope (붙는 곳)', () => {
  it('defaults to everywhere, refuses out-of-scope attaching and narrowing while attached', async () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Line' }] });
    const { projectId } = importProject(db, file, null as never);
    const unit = db.select().from(s.units).get()!;
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/projects/:projectId', knowledgeRoutes)
      .route('/', sourceRoutes)
      .route('/projects', projectRoutes);
    const send = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

    const created = (await (await send('POST', `/projects/${projectId}/tags`, { name: '내 태그' })).json()) as { id: string; scope: string[] };
    expect(created.scope).toEqual(['lines', 'terms', 'people', 'documents', 'events']);
    expect((await send('POST', `/projects/${projectId}/tags`, { name: '빈 곳', scope: [] })).status).toBe(400);

    // Attached on a line: 대사 can't be taken away, 자료 can.
    expect((await send('PATCH', `/projects/${projectId}/units`, { unitIds: [unit.id], addTagIds: [created.id] })).status).toBe(200);
    expect((await send('PATCH', `/projects/${projectId}/tags/${created.id}`, { scope: ['knowledge', 'terms'] })).status).toBe(400);
    expect((await send('PATCH', `/projects/${projectId}/tags/${created.id}`, { scope: ['lines', 'terms'] })).status).toBe(200);

    // Out of scope: 자료 is no longer a place.
    expect((await send('POST', `/projects/${projectId}/knowledge-tags`, { kind: 'documents', ids: ['d1'], tagId: created.id, add: true })).status).toBe(400);
    expect((await send('POST', `/projects/${projectId}/knowledge-tags`, { kind: 'terms', ids: ['t1'], tagId: created.id, add: true })).status).toBe(200);
    expect((await send('PATCH', `/projects/${projectId}/tags/${created.id}`, { scope: ['lines'] })).status).toBe(400);

    const glossaryOnly = (await (await send('POST', `/projects/${projectId}/tags`, { name: '용어만', scope: ['terms'] })).json()) as { id: string };
    expect((await send('PATCH', `/projects/${projectId}/units`, { unitIds: [unit.id], addTagIds: [glossaryOnly.id] })).status).toBe(400);
    expect((await send('PATCH', `/units/${unit.id}`, { tagIds: [glossaryOnly.id] })).status).toBe(400);
    expect(db.select().from(s.unitTags).all().map((row) => row.tagId)).toEqual([created.id]);

    // The app's tags have a fixed place.
    const review = db.insert(s.tags).values({ projectId, name: REVIEW_TAG.name, color: REVIEW_TAG.color, role: REVIEW_TAG.role }).returning().get();
    expect((await send('PATCH', `/projects/${projectId}/tags/${review.id}`, { scope: ['lines'] })).status).toBe(400);
    const listed = (await (await send('GET', `/projects/${projectId}/statuses`)).json()) as { tags: { id: string; scope: string[] }[] };
    expect(listed.tags.find((tag) => tag.id === review.id)?.scope).toEqual(['people', 'documents', 'events']);
  });
});
