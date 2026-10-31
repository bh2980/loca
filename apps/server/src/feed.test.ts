import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { importFileSchema, type FeedSnapshot } from '@tw/shared';
import type { Env } from './context.ts';
import { openDatabase } from './db/index.ts';
import { rowChangesOf } from './db/row-changes.ts';
import * as s from './db/schema.ts';
import { Events, trackChanges, type ChangeEvent } from './events.ts';
import { feedRows, feedSnapshot } from './feed.ts';
import { knowledgeRoutes } from './routes/knowledge.ts';
import { deleteItems } from './services/item-delete.ts';
import { setKnowledgeTag } from './services/knowledge-tags.ts';
import { importProject } from './services/importer.ts';
import { saveTerm } from './services/terms.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Feed' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'The Gate opens' }] }));
  // What setup itself wrote is not what these tests look at.
  feedRows(db, projectId);
  const term = (source: string, target = '') => db.transaction((tx) => saveTerm(tx, projectId, { source, target }, {})) as { ok: true; row: typeof s.terms.$inferSelect };
  return { db, projectId, term };
}

describe('the row feed', () => {
  it('sends a changed term once, as it is when sent, with its tags', () => {
    const { db, projectId, term } = setup();
    const gate = term('Gate', '관문').row;
    db.update(s.terms).set({ note: '지명' }).where(eq(s.terms.id, gate.id)).run();
    const tag = db.insert(s.tags).values({ projectId, name: '지명', color: '#888888', scope: ['terms'] }).returning().get();
    const tagged = db.transaction((tx) => setKnowledgeTag(tx, projectId, 'terms', [gate.id], tag.id, true));
    expect(tagged).toBeNull();
    const sent = feedRows(db, projectId)!;
    expect(sent.rows.terms?.delete).toEqual([]);
    expect(sent.rows.terms?.upsert).toEqual([expect.objectContaining({ id: gate.id, target: '관문', note: '지명', tags: [{ id: tag.id, note: null }] })]);
    expect(sent.seq).toBe(rowChangesOf(db.$client).seq);
    // Sent once: nothing is left until the next change.
    expect(feedRows(db, projectId)).toBeNull();
  });

  it('sends a deleted or rejected term as a delete, and a tag taken off as the item changed', () => {
    const { db, projectId, term } = setup();
    const gate = term('Gate').row;
    const hesk = term('Hesk').row;
    const tag = db.insert(s.tags).values({ projectId, name: '지명', color: '#888888', scope: ['terms'] }).returning().get();
    db.transaction((tx) => setKnowledgeTag(tx, projectId, 'terms', [hesk.id], tag.id, true));
    feedRows(db, projectId);
    db.transaction((tx) => setKnowledgeTag(tx, projectId, 'terms', [hesk.id], tag.id, false));
    db.update(s.terms).set({ status: 'rejected' }).where(eq(s.terms.id, gate.id)).run();
    const sent = feedRows(db, projectId)!;
    expect(sent.rows.terms?.delete).toEqual([gate.id]);
    expect(sent.rows.terms?.upsert).toEqual([expect.objectContaining({ id: hesk.id, tags: [] })]);
    deleteItems(db, projectId, 'terms', [hesk.id]);
    expect(feedRows(db, projectId)!.rows.terms).toEqual({ upsert: [], delete: [hesk.id] });
  });

  it('keeps projects apart', () => {
    const { db, projectId, term } = setup();
    const other = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Other' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'x' }] })).projectId;
    feedRows(db, other);
    term('Gate');
    expect(feedRows(db, other)).toBeNull();
    expect(feedRows(db, projectId)!.rows.terms?.upsert).toHaveLength(1);
  });

  it('the snapshot counts usage first and carries the count an older event is dropped by', async () => {
    const { db, projectId, term } = setup();
    term('Gate');
    const snapshot = feedSnapshot(db, projectId, 'terms');
    expect(snapshot.rows).toEqual([expect.objectContaining({ source: 'Gate', lines: 1 })]);
    // The usage count it filled is a change like any other, at or below the snapshot's count.
    const after = feedRows(db, projectId)!;
    expect(after.seq).toBeLessThanOrEqual(snapshot.seq);
    const app = new Hono<Env>().use(async (c, next) => (c.set('deps', { db } as never), next())).route('/projects/:projectId', knowledgeRoutes);
    const res = await app.request(`/projects/${projectId}/sync/terms`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as FeedSnapshot).rows).toHaveLength(1);
    expect((await app.request(`/projects/${projectId}/sync/nope`)).status).toBe(400);
  });
});

describe('change events with rows', () => {
  it('carry the rows and the count, and a request knows its last change (x-seq)', async () => {
    const { db, projectId, term } = setup();
    const bus = new Events(0, 0);
    bus.rowSource = (id) => feedRows(db, id);
    rowChangesOf(db.$client).listener = (id, seq) => bus.rowsChanged(id, seq);
    const seen: ChangeEvent[] = [];
    bus.on('change', (event) => seen.push(event));
    const { seq } = await trackChanges(async () => void term('Gate', '관문'), 'tab-1');
    bus.flush();
    expect(seq).toBe(rowChangesOf(db.$client).seq);
    expect(seen).toEqual([expect.objectContaining({ projectId, topics: [], seq, origin: 'tab-1', rows: { terms: { upsert: [expect.objectContaining({ source: 'Gate' })], delete: [] } } })]);
    rowChangesOf(db.$client).listener = undefined;
  });
});
