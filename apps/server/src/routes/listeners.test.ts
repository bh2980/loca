import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { groupRows } from '../services/group-rows.ts';
import { listenerRows } from '../services/project-rows.ts';

describe('listener filter choices', () => {
  it('counts known listeners and uses the shared unknown mark rules', () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'P' },
      groups: [{ key: 'g', title: 'G' }],
      units: Array.from({ length: 6 }, (_, n) => ({ key: `u${n}`, group: 'g', source: `Line ${n}` })),
    });
    const { projectId } = importProject(db, file, null as never);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
    db.update(s.units).set({ kind: 'dialogue', speaker: 'Ann' }).where(eq(s.units.projectId, projectId)).run();
    db.update(s.units).set({ listener: 'Bob', listenerOrigin: 'human' }).where(eq(s.units.id, units[0]!.id)).run();
    db.update(s.units).set({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.95 }).where(eq(s.units.id, units[1]!.id)).run();
    db.update(s.units).set({ listener: 'group', listenerOrigin: 'human' }).where(eq(s.units.id, units[2]!.id)).run();
    db.update(s.units).set({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.5 }).where(eq(s.units.id, units[3]!.id)).run();
    db.update(s.units).set({ speaker: null }).where(eq(s.units.id, units[5]!.id)).run();

    // The listeners collection's rows, and 청자 모름 summed from the scenes' rows as the browser does.
    expect(listenerRows(db, projectId)).toEqual([{ id: 'Bob', name: 'Bob', lines: 2 }, { id: 'group', name: 'group', lines: 1 }]);
    expect(groupRows(db, projectId).reduce((sum, group) => sum + group.unknownListeners, 0)).toBe(2);
  });
});
