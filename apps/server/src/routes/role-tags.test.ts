import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { knowledgeRoutes } from './knowledge.ts';
import { projectRoutes } from './projects.ts';
import { sourceRoutes } from './source.ts';

describe('tags and automatic tags', () => {
  it('every tag is a person\'s to rename, recolour and delete; an automatic tag\'s name and colour are a project setting', async () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Line' }] });
    const { projectId } = importProject(db, file, null as never);
    const tag = db.select().from(s.tags).where(eq(s.tags.name, 'AI 실패')).get()!;
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/projects', projectRoutes);
    const send = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

    expect((await send('PATCH', `/projects/${projectId}/tags/${tag.id}`, { name: '모델 실패', color: '#22c55e' })).status).toBe(200);
    expect(db.select().from(s.tags).where(eq(s.tags.id, tag.id)).get()).toMatchObject({ name: '모델 실패', color: '#22c55e' });
    expect((await send('POST', `/projects/${projectId}/tags/delete`, { ids: [tag.id] })).status).toBe(200);
    expect(db.select().from(s.tags).where(eq(s.tags.id, tag.id)).get()).toBeUndefined();

    // An automatic tag's own name and colour are a project setting; a bad colour is refused.
    expect((await send('PATCH', `/projects/${projectId}`, { markStyles: { review: { name: '봐 주세요', color: '#22c55e' } } })).status).toBe(200);
    const project = (await (await send('GET', `/projects/${projectId}`)).json()) as { markStyles: Record<string, unknown> };
    expect(project.markStyles).toEqual({ review: { name: '봐 주세요', color: '#22c55e' } });
    expect((await send('PATCH', `/projects/${projectId}`, { markStyles: { review: { color: 'red' } } })).status).toBe(400);
    // What a row already shows is a filter, not an automatic tag.
    expect((await send('PATCH', `/projects/${projectId}`, { markStyles: { remaining: { name: '미완료' } } })).status).toBe(400);
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

    // 확인 권장 is read off the item: the analysis's note puts it on, a person's 확인함 takes it off.
    const person = db.insert(s.characters).values({ projectId, name: 'Ann', status: 'candidate', statusBy: 'ai', reviewNote: '사람이 아닐 수 있음' }).returning().get();
    const listMarks = async () => ((await (await send('GET', `/projects/${projectId}/characters`)).json()) as { characters: { id: string; reviewNote: string }[] }).characters.find((row) => row.id === person.id);
    expect(await listMarks()).toMatchObject({ reviewNote: '사람이 아닐 수 있음' });
    expect((await send('POST', `/projects/${projectId}/drafts`, { kind: 'characters', ids: [person.id], action: 'confirm' })).status).toBe(200);
    expect(db.select().from(s.characters).where(eq(s.characters.id, person.id)).get()).toMatchObject({ reviewNote: '', status: 'confirmed' });
  });
});
