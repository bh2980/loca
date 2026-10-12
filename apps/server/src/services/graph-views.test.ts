import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { pickNodes, readView, saveView } from './graph-views.ts';

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

  it('stores the same set of nodes under the same id', () => {
    const { db, projectId } = setup();
    const id = saveView(db, projectId, ['b', 'a'], 'first');
    expect(saveView(db, projectId, ['a', 'b', 'a'], 'second')).toBe(id);
    expect(readView(db, projectId, id)).toMatchObject({ label: 'second', nodeIds: ['a', 'b'] });
  });
});
