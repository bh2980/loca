import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { FEED_UNITS_LIMIT, importFileSchema, type FeedSnapshot } from '@tw/shared';
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
import { unitRowsByIds } from './services/unit-rows.ts';

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

  it('sends knowledge, statuses and tags as their lists show them, and a deleted tag as the items it was on', () => {
    const { db, projectId } = setup();
    const mira = db.insert(s.characters).values({ projectId, name: 'Mira' }).returning().get();
    const jonas = db.insert(s.characters).values({ projectId, name: 'Jonas' }).returning().get();
    const rel = db.insert(s.relationships).values({ projectId, fromId: mira.id, toId: jonas.id, kind: '동료' }).returning().get();
    const rule = db.insert(s.speechRules).values({ projectId, fromName: 'Mira', toName: 'Jonas', level: 'haeyo' }).returning().get();
    const doc = db.insert(s.documents).values({ projectId, title: '세계관', kind: 'world', body: '' }).returning().get();
    const tag = db.insert(s.tags).values({ projectId, name: '확인', color: '#888888', scope: ['people'] }).returning().get();
    db.transaction((tx) => setKnowledgeTag(tx, projectId, 'characters', [mira.id], tag.id, true));
    const status = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all()[0]!;
    db.update(s.statuses).set({ name: '처음' }).where(eq(s.statuses.id, status.id)).run();
    const sent = feedRows(db, projectId)!.rows;
    expect(sent.characters?.upsert).toEqual([expect.objectContaining({ id: jonas.id, tags: [] }), expect.objectContaining({ id: mira.id, tags: [{ id: tag.id, note: null }] })]);
    expect(sent.relationships?.upsert).toEqual([expect.objectContaining({ id: rel.id, kind: '동료' })]);
    expect(sent.speechRules?.upsert).toEqual([expect.objectContaining({ id: rule.id, level: 'haeyo' })]);
    expect(sent.documents?.upsert).toEqual([expect.objectContaining({ id: doc.id, title: '세계관' })]);
    expect(sent.tags?.upsert).toEqual([{ id: tag.id, name: '확인', color: '#888888', description: '', scope: ['people'], sort: 0 }]);
    expect(sent.statuses?.upsert).toEqual([expect.objectContaining({ id: status.id, name: '처음' })]);
    expect(sent.statuses?.upsert[0]).not.toHaveProperty('units');
    // The tag's rows on items go with it, and the items it was on come again without it.
    db.delete(s.tags).where(eq(s.tags.id, tag.id)).run();
    const after = feedRows(db, projectId)!.rows;
    expect(after.tags).toEqual({ upsert: [], delete: [tag.id] });
    expect(after.characters?.upsert).toEqual([expect.objectContaining({ id: mira.id, tags: [] })]);
    db.update(s.characters).set({ status: 'rejected' }).where(eq(s.characters.id, jonas.id)).run();
    expect(feedRows(db, projectId)!.rows.characters).toEqual({ upsert: [], delete: [jonas.id] });
    expect(feedSnapshot(db, projectId, 'characters').rows).toEqual([expect.objectContaining({ id: mira.id })]);
  });
});

describe('lines in the row feed', () => {
  it('names a line when it, its tags or its AI 제안 change', () => {
    const { db, projectId } = setup();
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    db.update(s.units).set({ translation: '관문이 열린다' }).where(eq(s.units.id, unit.id)).run();
    const tag = db.insert(s.tags).values({ projectId, name: '확인', color: '#888888', scope: ['lines'] }).returning().get();
    db.insert(s.unitTags).values({ unitId: unit.id, tagId: tag.id }).run();
    // Lines go out as ids; the browser reads the ones it holds (units/by-ids, unitRowsByIds).
    expect(feedRows(db, projectId)!.rows.units).toEqual({ upsert: [], delete: [], changed: [unit.id] });
    expect(unitRowsByIds(db, projectId, [unit.id, 'nope'])).toEqual([expect.objectContaining({ id: unit.id, translation: '관문이 열린다', tagIds: [tag.id], groupTitle: 'G', suggested: false, lastRun: null })]);
    db.insert(s.candidates).values({ unitId: unit.id, text: '문이 열린다', origin: 'ai', state: 'pending' }).run();
    expect(feedRows(db, projectId)!.rows.units?.changed).toEqual([unit.id]);
    expect(unitRowsByIds(db, projectId, [unit.id])[0]?.suggested).toBe(true);
    db.delete(s.unitTags).where(eq(s.unitTags.unitId, unit.id)).run();
    expect(feedRows(db, projectId)!.rows.units?.changed).toEqual([unit.id]);
    db.delete(s.units).where(eq(s.units.id, unit.id)).run();
    expect(feedRows(db, projectId)!.rows.units).toEqual({ upsert: [], delete: [unit.id], changed: [] });
  });

  it('asks to read the held lines again instead of sending a bulk change', () => {
    const units = Array.from({ length: FEED_UNITS_LIMIT + 1 }, (_, index) => ({ key: `u${index}`, group: 'g', source: `Line ${index}` }));
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Bulk' }, groups: [{ key: 'g', title: 'G' }], units }));
    expect(feedRows(db, projectId)!.rows.units).toEqual({ upsert: [], delete: [], reload: true });
    db.update(s.units).set({ note: '메모' }).where(eq(s.units.key, 'u1')).run();
    expect(feedRows(db, projectId)!.rows.units?.changed).toHaveLength(1);
  });

  it('has no snapshot of lines: the browser holds the ones it shows', async () => {
    const { db, projectId } = setup();
    const app = new Hono<Env>().use(async (c, next) => (c.set('deps', { db } as never), next())).route('/projects/:projectId', knowledgeRoutes);
    expect((await app.request(`/projects/${projectId}/sync/units`)).status).toBe(400);
  });
});

describe('scenes in the row feed', () => {
  it('sends a scene with its progress when its lines or the project rules they count by change', () => {
    const { db, projectId } = setup();
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    db.update(s.units).set({ statusId: statuses[1]!.id }).where(eq(s.units.id, unit.id)).run();
    expect(feedRows(db, projectId)!.rows.groups?.upsert).toEqual([expect.objectContaining({ id: group.id, total: 1, statuses: { [statuses[1]!.id]: 1 }, excluded: 0 })]);
    // A translation alone does not move the counts.
    db.update(s.units).set({ translation: '관문이 열린다' }).where(eq(s.units.id, unit.id)).run();
    expect(feedRows(db, projectId)!.rows.groups).toBeUndefined();
    // 번역 제외 by hand, then the project's rules: the counts are read again.
    db.update(s.units).set({ translate: 'exclude' }).where(eq(s.units.id, unit.id)).run();
    expect(feedRows(db, projectId)!.rows.groups?.upsert).toEqual([expect.objectContaining({ id: group.id, total: 0, excluded: 1 })]);
    db.update(s.projects).set({ exclusionRules: {} }).where(eq(s.projects.id, projectId)).run();
    expect(feedRows(db, projectId)!.rows.groups?.upsert).toEqual([expect.objectContaining({ id: group.id })]);
    expect(feedSnapshot(db, projectId, 'groups').rows).toEqual([expect.objectContaining({ id: group.id, title: 'G' })]);
  });
});

describe('runs in the row feed', () => {
  it('sends a run with its line states when the run or one of its items changes', () => {
    const { db, projectId } = setup();
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    const run = db.insert(s.runs).values({ projectId, workflowName: '번역', workflowVersion: 1, definition: { nodes: [], edges: [] } as never, scope: {} as never, status: 'running', total: 1 }).returning().get();
    const item = db.insert(s.runItems).values({ runId: run.id, subjectId: unit.id, nodeId: 'n', state: 'running', visits: {}, data: {} as never }).returning().get();
    expect(feedRows(db, projectId)!.rows.runs?.upsert).toEqual([expect.objectContaining({ id: run.id, status: 'running', states: { running: 1 } })]);
    db.update(s.runItems).set({ state: 'done' }).where(eq(s.runItems.id, item.id)).run();
    db.update(s.runs).set({ status: 'completed' }).where(eq(s.runs.id, run.id)).run();
    expect(feedRows(db, projectId)!.rows.runs?.upsert).toEqual([expect.objectContaining({ id: run.id, status: 'completed', states: { done: 1 } })]);
    db.delete(s.runs).where(eq(s.runs.id, run.id)).run();
    expect(feedRows(db, projectId)!.rows.runs).toEqual({ upsert: [], delete: [run.id] });
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
