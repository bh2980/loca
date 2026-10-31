import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { deleteNodes, duplicateNodes, insertLineAfter, linkInOrder, linkNodes, sceneByRef, undoGraphEdit, unlinkEdges } from './graph-edit.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(
    db,
    importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'P' },
      groups: [{ key: 'g', title: 'Harbor' }],
      units: [
        { key: 'a', group: 'g', speaker: 'Mira', source: 'One.' },
        { key: 'b', group: 'g', speaker: 'Kai', source: 'Two.' },
        { key: 'c', group: 'g', speaker: 'Mira', source: 'Three.' },
      ],
      graph: { nodes: [{ key: 'na', units: ['a'] }, { key: 'nb', units: ['b'] }, { key: 'nc', units: ['c'] }], edges: [{ from: 'na', to: 'nb', label: 'Ask' }, { from: 'nb', to: 'nc' }] },
    }),
  );
  const node = (key: string) => db.select().from(s.graphNodes).where(eq(s.graphNodes.key, key)).get()!;
  const ways = () =>
    db
      .select()
      .from(s.graphEdges)
      .all()
      .map((edge) => {
        const name = (id: string) => db.select().from(s.graphNodes).where(eq(s.graphNodes.id, id)).get()!.key;
        return `${name(edge.fromId)}>${name(edge.toId)}${edge.label ? `:${edge.label}` : ''}`;
      })
      .sort();
  const order = () => db.select().from(s.units).all().sort((x, y) => x.seq - y.seq).map((unit) => unit.source);
  return { db, projectId, node, ways, order };
}

describe('editing the dialogue graph', () => {
  it('puts a line between a node and its one way on, in script order, and undo takes it out', () => {
    const { db, projectId, node, ways, order } = setup();
    const { token, nodeId } = insertLineAfter(db, projectId, node('na').id, { source: 'Between.', speaker: 'Kai', origin: 'human' });
    const added = db.select().from(s.graphNodes).where(eq(s.graphNodes.id, nodeId)).get()!;
    expect(added.origin).toBe('human');
    expect(ways()).toEqual([`${added.key}>nb`, `na>${added.key}:Ask`, 'nb>nc'].sort());
    expect(order()).toEqual(['One.', 'Between.', 'Two.', 'Three.']);
    expect(undoGraphEdit(db, projectId, token)).toBe(true);
    expect(ways()).toEqual(['na>nb:Ask', 'nb>nc']);
    expect(order()).toEqual(['One.', 'Two.', 'Three.']);
    expect(undoGraphEdit(db, projectId, token)).toBe(false);
  });

  it('deletes a node keeping the way through it, and undo brings the node and its line back', () => {
    const { db, projectId, node, ways, order } = setup();
    const { token } = deleteNodes(db, projectId, [node('nb').id]);
    expect(ways()).toEqual(['na>nc:Ask']);
    expect(order()).toEqual(['One.', 'Three.']);
    undoGraphEdit(db, projectId, token);
    expect(ways()).toEqual(['na>nb:Ask', 'nb>nc']);
    expect(order()).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('draws and deletes lines, marked as drawn in the app', () => {
    const { db, projectId, node, ways } = setup();
    const { edge, token } = linkNodes(db, projectId, { fromId: node('nc').id, toId: node('na').id, origin: 'human' });
    expect(edge.origin).toBe('human');
    expect(ways()).toContain('nc>na');
    undoGraphEdit(db, projectId, token);
    expect(ways()).not.toContain('nc>na');
    const imported = db.select().from(s.graphEdges).where(eq(s.graphEdges.fromId, node('nb').id)).get()!;
    const removed = unlinkEdges(db, projectId, [imported.id]);
    expect(ways()).toEqual(['na>nb:Ask']);
    undoGraphEdit(db, projectId, removed.token);
    expect(ways()).toEqual(['na>nb:Ask', 'nb>nc']);
  });

  it('copies nodes with their lines and the ways between them only', () => {
    const { db, projectId, node, ways, order } = setup();
    const { made } = duplicateNodes(db, projectId, [node('na').id, node('nb').id]);
    const copyA = db.select().from(s.graphNodes).where(eq(s.graphNodes.id, made[node('na').id]!)).get()!;
    const copyB = db.select().from(s.graphNodes).where(eq(s.graphNodes.id, made[node('nb').id]!)).get()!;
    expect(ways()).toContain(`${copyA.key}>${copyB.key}:Ask`);
    expect(ways().filter((way) => way.includes(copyB.key) && way.includes('nc'))).toEqual([]);
    expect(order()).toEqual(['One.', 'Two.', 'Three.', 'One.', 'Two.']);
  });
});


describe('linking in script order', () => {
  function scenes() {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(
      db,
      importFileSchema.parse({
        format: 'loca/v1',
        project: { name: 'P' },
        groups: [{ key: 'A', title: 'Alpha' }, { key: 'B', title: 'Beta' }],
        units: [
          { key: 'a1', group: 'A', source: '1' }, { key: 'a2', group: 'A', source: '2' }, { key: 'a3', group: 'A', source: '3' },
          { key: 'b1', group: 'B', source: '4' }, { key: 'b2', group: 'B', source: '5' },
        ],
      }),
    );
    const id = (key: string) => db.select().from(s.groups).where(eq(s.groups.key, key)).get()!.id;
    const ways = () => {
      const name = (nodeId: string) => db.select().from(s.graphNodes).where(eq(s.graphNodes.id, nodeId)).get()!.key;
      return db.select().from(s.graphEdges).all().map((edge) => `${name(edge.fromId)}>${name(edge.toId)}`).sort();
    };
    return { db, projectId, id, ways };
  }

  it('links nodes in script order but never changes a node that already has a way in or out', () => {
    const { db, projectId, id, ways } = scenes();
    const node = (key: string) => db.select().from(s.graphNodes).where(eq(s.graphNodes.key, key)).get()!.id;
    linkNodes(db, projectId, { fromId: node('a2'), toId: node('b2'), origin: 'human' });
    const result = linkInOrder(db, projectId, { groupIds: [id('A'), id('B')], origin: 'human' });
    // a1>a2 is made; a2>a3 is skipped (a2 has a way out); b1>b2 is skipped (b2 has a way in).
    expect(result).toMatchObject({ linked: 1, skipped: 2 });
    expect(ways()).toEqual(['a1>a2', 'a2>b2']);
    expect(undoGraphEdit(db, projectId, result.token!)).toBe(true);
    expect(ways()).toEqual(['a2>b2']);
    const picked = linkInOrder(db, projectId, { nodeIds: [node('b1'), node('a3'), node('a1')], origin: 'ai' });
    expect(picked.linked).toBe(1);
    expect(ways()).toEqual(['a1>a3', 'a2>b2']);
    expect(db.select().from(s.graphEdges).all().find((edge) => edge.fromId === node('a1'))!.origin).toBe('ai');
  });

  it('finds scenes by id, key or title', () => {
    const { db, projectId, id } = scenes();
    expect([sceneByRef(db, projectId, 'A'), sceneByRef(db, projectId, 'beta'), sceneByRef(db, projectId, id('B'))]).toEqual([id('A'), id('B'), id('B')]);
    expect(() => sceneByRef(db, projectId, 'nope')).toThrow();
  });
});
