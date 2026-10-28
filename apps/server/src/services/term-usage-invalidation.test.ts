import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { fillTermUsage } from './term-usage.ts';

it('invalidates counts and example keys on source changes, insertions and deletions, but not translation edits', () => {
  const db = openDatabase(':memory:');
  try {
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Relay' }] }));
    const unit = db.select().from(s.units).get()!;
    const term = db.insert(s.terms).values({ projectId, source: 'Relay', target: '중계' }).returning().get();
    const current = () => db.select().from(s.terms).where(eq(s.terms.id, term.id)).get()!;
    fillTermUsage(db, projectId); expect(current()).toMatchObject({ lines: 1, examples: ['u'] });
    db.update(s.units).set({ translation: '중계' }).where(eq(s.units.id, unit.id)).run();
    expect(current().lines).toBe(1);
    db.update(s.units).set({ source: 'Other' }).where(eq(s.units.id, unit.id)).run();
    expect(current()).toMatchObject({ lines: null, examples: [] });
    fillTermUsage(db, projectId); expect(current().lines).toBe(0);
    db.update(s.units).set({ speaker: 'Relay', key: 'renamed' }).where(eq(s.units.id, unit.id)).run();
    fillTermUsage(db, projectId); expect(current()).toMatchObject({ lines: 1, examples: ['renamed'] });
    db.insert(s.units).values({ ...unit, id: 'second', key: 'u2', seq: 2 }).run();
    fillTermUsage(db, projectId); expect(current()).toMatchObject({ lines: 2, examples: ['renamed', 'u2'] });
    db.delete(s.units).where(eq(s.units.id, unit.id)).run();
    fillTermUsage(db, projectId); expect(current()).toMatchObject({ lines: 1, examples: ['u2'] });
  } finally { db.$client.close(); }
});
