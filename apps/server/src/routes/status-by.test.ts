import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { knowledgeRoutes } from './knowledge.ts';
import { sourceRoutes } from './source.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [0, 1, 2].map((n) => ({ key: `u${n}`, group: 'g', source: `Line ${n}` })) });
  const { projectId } = importProject(db, file, null as never);
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes)
    .route('/projects/:projectId', knowledgeRoutes);
  const send = (method: string, url: string, body: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { db, projectId, send };
}

describe('who set it', () => {
  it('a run sets a line, a person takes it over by editing, changing the status or 확인함', async () => {
    const { db, projectId, send } = setup();
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
    db.update(s.units).set({ statusBy: 'ai', statusRunId: 'run1' }).where(eq(s.units.projectId, projectId)).run();

    await send('POST', `/units/${units[0].id}/save`, { text: '사람 번역' });
    await send('PATCH', `/units/${units[1].id}`, { listener: 'Bob' });
    const by = () => db.select({ key: s.units.key, statusBy: s.units.statusBy, statusRunId: s.units.statusRunId }).from(s.units).orderBy(s.units.seq).all();
    // A translation edit makes it the person's; a listener choice alone does not touch who set the status.
    expect(by().map((row) => [row.key, row.statusBy, row.statusRunId])).toEqual([['u0', 'human', null], ['u1', 'ai', 'run1'], ['u2', 'ai', 'run1']]);

    await send('PATCH', `/projects/${projectId}/units`, { unitIds: [units[1].id], checked: true });
    expect(by().map((row) => row.statusBy)).toEqual(['human', 'human', 'ai']);
    // 'AI가 정한 것만' lists what is left.
    const listed = (await (await send('GET', `/projects/${projectId}/units?decidedBy=ai`, undefined)).json()) as { rows: { key: string; statusBy: string }[] };
    expect(listed.rows.map((row) => [row.key, row.statusBy])).toEqual([['u2', 'ai']]);
  });

  it('a person confirming an AI item keeps its source; rewriting it makes the content theirs', async () => {
    const { db, projectId, send } = setup();
    const term = db.insert(s.terms).values({ projectId, source: 'Ghost', target: '유령', origin: 'ai', statusBy: 'ai' }).returning().get();
    const other = db.insert(s.terms).values({ projectId, source: 'Vera', target: '베라', origin: 'ai', statusBy: 'ai' }).returning().get();
    await send('POST', `/projects/${projectId}/drafts`, { kind: 'terms', ids: [term.id], action: 'confirm' });
    await send('PATCH', `/projects/${projectId}/terms/${other.id}`, { target: '베라 씨' });
    const rows = db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).orderBy(s.terms.source).all();
    expect(rows.map((row) => [row.source, row.status, row.statusBy, row.origin])).toEqual([
      ['Ghost', 'confirmed', 'human', 'ai'],
      ['Vera', 'confirmed', 'human', 'human'],
    ]);
  });
});

describe('units list filters on what a row shows', () => {
  it('청자 모름 and 메모 must both hold; a named listener stays its own filter', async () => {
    const { db, projectId, send } = setup();
    db.update(s.units).set({ speaker: 'Ann' }).where(eq(s.units.projectId, projectId)).run();
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
    db.update(s.units).set({ kind: 'dialogue', listener: 'Bob', listenerOrigin: 'human' }).where(eq(s.units.id, units[0].id)).run();
    db.update(s.units).set({ kind: 'dialogue', listener: null }).where(eq(s.units.id, units[1].id)).run();
    db.update(s.units).set({ kind: 'dialogue', listener: null }).where(eq(s.units.id, units[2].id)).run();
    db.update(s.units).set({ note: '메모' }).where(eq(s.units.id, units[0].id)).run();
    db.update(s.units).set({ note: '메모' }).where(eq(s.units.id, units[1].id)).run();
    const keys = async (query: string) => ((await (await send('GET', `/projects/${projectId}/units?${query}`, undefined)).json()) as { rows: { key: string }[] }).rows.map((row) => row.key);
    expect(await keys('listener=-')).toEqual(['u1', 'u2']);
    expect(await keys('noted=1')).toEqual(['u0', 'u1']);
    expect(await keys('listener=-&noted=1')).toEqual(['u1']);
    expect(await keys('listener=-&noted=0')).toEqual(['u2']);
    expect(await keys('listener=Bob&noted=1')).toEqual(['u0']);
  });
});
