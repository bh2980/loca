import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { createGroup, updateGroup, deleteGroup, createUnit, updateUnit, deleteUnits } from './source-mutations.ts';
import { FILLING } from '../engine/run-create.ts';
vi.mock('./layout.ts', () => ({ computeLayouts: vi.fn(async () => {}) }));

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1', project: { name: 'Source editing' },
    groups: [{ key: 'g', title: 'Original', section: 'Chapter 1' }],
    units: [{ key: 'a', group: 'g', source: 'Before', translation: '기존 번역' }, { key: 'b', group: 'g', source: 'Next' }],
  }), null as never);
  const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
  return { db, projectId, group, units };
}

describe('source resource CRUD', () => {
  it.each(['scene', 'document', 'ui'] as const)('creates an empty %s group, appends entries and removes the group with its candidates', (kind) => {
    const { db, projectId } = setup();
    const group = createGroup(db, projectId, { kind, title: 'New source', section: 'Chapter 2' });
    expect(db.select().from(s.units).where(eq(s.units.groupId, group.id)).all()).toHaveLength(0);
    const unit = createUnit(db, projectId, { groupId: group.id, source: 'New entry' });
    expect(unit.kind).toBe(kind === 'scene' ? 'dialogue' : kind);
    expect(unit.seq).toBe(2);
    expect(unit.translation).toBeNull();
    expect(db.select().from(s.graphEdges).all()).toEqual([]);
    expect(db.select().from(s.graphNodes).where(eq(s.graphNodes.groupId, group.id)).get()?.unitIds).toEqual([unit.id]);
    db.insert(s.candidates).values({ unitId: unit.id, text: '후보', origin: 'human' }).run();
    updateGroup(db, projectId, group.id, { title: 'Renamed', section: 'Chapter 3' });
    expect(deleteGroup(db, projectId, group.id)).toEqual({ deleted: 1 });
    expect(db.select().from(s.candidates).where(eq(s.candidates.unitId, unit.id)).all()).toEqual([]);
    expect(db.select().from(s.graphNodes).all().flatMap((node) => node.unitIds)).not.toContain(unit.id);
    expect(db.select().from(s.graphNodes).all().some((node) => node.groupId === group.id)).toBe(false);
  });

  it('moves entries in script order, preserves explicit edges, resets completion on source changes, and renames evidence', () => {
    const { db, projectId, group, units } = setup();
    const first = units[0]!;
    const target = createGroup(db, projectId, { kind: 'scene', title: 'Second' });
    const final = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'final'))).get()!;
    db.update(s.units).set({ statusId: final.id }).where(eq(s.units.id, first.id)).run();
    db.insert(s.characters).values({ projectId, name: 'Person', evidence: [first.key] }).run();
    const n1 = db.insert(s.graphNodes).values({ projectId, key: 'n1', kind: 'line', groupId: group.id, unitIds: [first.id, units[1]!.id] }).returning().get();
    const n2 = db.insert(s.graphNodes).values({ projectId, key: 'n2', kind: 'control', groupId: group.id, unitIds: [] }).returning().get();
    db.insert(s.graphEdges).values({ projectId, fromId: n1.id, toId: n2.id }).run();
    const changed = updateUnit(db, projectId, first.id, { groupId: target.id, source: 'After', key: 'new-key' });
    expect(changed.seq).toBe(1);
    expect(changed.translation).toBe('기존 번역');
    expect(changed.statusId).not.toBe(final.id);
    expect(db.select().from(s.characters).get()?.evidence).toEqual(['new-key']);
    expect(db.select().from(s.graphNodes).where(eq(s.graphNodes.id, n1.id)).get()?.groupId).toBe(target.id);
    deleteUnits(db, projectId, [first.id]);
    expect(db.select().from(s.graphNodes).where(eq(s.graphNodes.id, n1.id)).get()?.unitIds).toEqual([units[1]!.id]);
    expect(db.select().from(s.graphNodes).where(eq(s.graphNodes.id, n1.id)).get()?.groupId).toBe(group.id);
    expect(db.select().from(s.graphEdges).all()).toHaveLength(1);
    expect(db.select().from(s.characters).get()?.evidence).toEqual([]);
    expect(db.select().from(s.units).get()?.seq).toBe(0);
  });

  it('rejects cross-project references, duplicate keys, and cross-kind moves without partial changes', () => {
    const { db, projectId, group, units } = setup();
    const other = db.insert(s.projects).values({ name: 'Other', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
    expect(() => createUnit(db, other.id, { groupId: group.id, source: 'Wrong' })).toThrow();
    expect(() => deleteUnits(db, other.id, [units[0]!.id])).toThrow();
    expect(() => createUnit(db, projectId, { groupId: group.id, source: 'Duplicate', key: 'a' })).toThrow('이미 사용');
    const document = createGroup(db, projectId, { kind: 'document', title: 'Document' });
    expect(() => updateUnit(db, projectId, units[0]!.id, { groupId: document.id })).toThrow('같은 종류');
    expect(() => createUnit(db, projectId, { groupId: document.id, source: 'Doc', listener: 'Person' })).toThrow('화자·청자');
    expect(db.select().from(s.units).all()).toHaveLength(2);
  });

  it('does not rewrite existing source rows when appending at the end', () => {
    const { db, projectId } = setup();
    const group = createGroup(db, projectId, { kind: 'document', title: 'Append only' });
    // Every UPDATE runs the FTS maintenance trigger, even if seq stays the same.
    db.$client.exec('create temp table source_writes (id text); create temp trigger record_source_writes after update on units begin insert into source_writes values (new.id); end;');
    const unit = createUnit(db, projectId, { groupId: group.id, source: 'Appended' });
    expect(db.$client.prepare('select distinct id from source_writes').all()).toEqual([{ id: unit.id }]);
  });

  it('refuses mutations while a run is still filling its source scope', () => {
    const { db, projectId, group, units } = setup();
    db.insert(s.runs).values({ projectId, workflowName: 'Preparing', workflowVersion: 1, total: 2, definition: { nodes: [], edges: [] } as never, scope: {} as never, status: 'paused', notice: FILLING }).run();
    expect(() => updateUnit(db, projectId, units[0]!.id, { source: 'Race' })).toThrow('실행 중');
    expect(() => deleteGroup(db, projectId, group.id)).toThrow('실행 중');
    expect(db.select().from(s.units).all()).toHaveLength(2);
  });
});
