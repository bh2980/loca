import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { deleteView, listViews, missingNodes, pickNodes, readView, saveView, updateView } from './graph-views.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  return { db, projectId };
}

describe('graph views', () => {
  it('picks the nodes holding the named lines, then their neighbours, and reports what it could not find', () => {
    const { db, projectId } = setup();
    const node = db.select().from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().find((row) => row.unitIds.length)!;
    const key = db.select({ key: s.units.key }).from(s.units).where(eq(s.units.id, node.unitIds[0])).get()!.key;
    const picked = pickNodes(db, projectId, { lines: [key, 'missing.9'] });
    expect(picked.nodeIds).toEqual([node.id]);
    expect(picked.unknown).toEqual(['missing.9']);
    const wider = pickNodes(db, projectId, { lines: [key], around: 1 });
    expect(wider.nodeIds.length).toBeGreaterThan(1);
    expect(pickNodes(db, projectId, { scenes: ['no such scene'] })).toMatchObject({ nodeIds: [], unknown: ['no such scene'] });
  });

  it('picks every node between two lines, then leaves out excluded ones', () => {
    const { db, projectId } = setup();
    const nodes = db.select().from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
    const edges = db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    // A line node → line-less node → line node run in the sample.
    const hop = edges.flatMap((a) => {
      const mid = byId.get(a.toId)!;
      if (!byId.get(a.fromId)!.unitIds.length || mid.unitIds.length || mid.kind === 'choice') return [];
      return edges.filter((b) => b.fromId === mid.id && byId.get(b.toId)!.unitIds.length).map((b) => ({ start: a.fromId, mid: mid.id, end: b.toId }));
    })[0]!;
    const keyOf = (nodeId: string) => db.select({ key: s.units.key }).from(s.units).where(eq(s.units.id, byId.get(nodeId)!.unitIds[0]!)).get()!.key;
    const between = pickNodes(db, projectId, { between: { start: keyOf(hop.start), end: keyOf(hop.end) } });
    expect(between.nodeIds).toEqual(expect.arrayContaining([hop.start, hop.mid, hop.end]));
    expect(pickNodes(db, projectId, { between: { start: keyOf(hop.start), end: keyOf(hop.end) }, exclude: [keyOf(hop.end)] }).nodeIds).not.toContain(hop.end);
    expect(pickNodes(db, projectId, { between: { start: 'nope', end: keyOf(hop.end) } })).toMatchObject({ nodeIds: [], unknown: ['nope'] });
  });

  it('keeps a view as a definition: rename, add and leave out nodes, list, delete', () => {
    const { db, projectId } = setup();
    const id = saveView(db, projectId, ['b', 'a', 'a'], '첫 보기', { origin: 'ai', request: '분기만', reasons: { a: '시작', zzz: '없는 노드' } });
    expect(readView(db, projectId, id)).toMatchObject({ label: '첫 보기', nodeIds: ['a', 'b'], origin: 'ai', request: '분기만', reasons: { a: '시작' } });
    expect(updateView(db, projectId, id, { label: '바꾼 이름', add: ['c'], remove: ['a'] })).toMatchObject({ label: '바꾼 이름', nodeIds: ['b', 'c'], reasons: {} });
    expect(listViews(db, projectId)).toMatchObject([{ id, label: '바꾼 이름', nodes: 2, origin: 'ai' }]);
    expect(missingNodes(db, projectId, ['b', 'c'])).toEqual(['b', 'c']);
    deleteView(db, projectId, id);
    expect(readView(db, projectId, id)).toBeUndefined();
  });
});

it('resolves many keep references with one script scan', () => {
  const { db, projectId } = setup();
  const keys = db.select({ key: s.units.key }).from(s.units).all().map((row) => row.key);
  const prepare = vi.spyOn(db.$client, 'prepare');
  try {
    const picked = pickNodes(db, projectId, { keep: Array.from({ length: 2000 }, (_, i) => ({ ref: keys[i % keys.length] })) });
    expect(picked.nodeIds.length).toBeGreaterThan(0);
    expect(picked.unknown).toEqual([]);
    expect(prepare.mock.calls.filter(([sql]) => /from "units"/.test(sql))).toHaveLength(1);
  } finally { prepare.mockRestore(); db.$client.close(); }
});
