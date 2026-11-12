import { describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { importFileSchema } from '@loca/shared';
import { openDatabase } from './index.ts';
import * as s from './schema.ts';
import { importProject } from '../services/importer.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Harbor' }], units: [{ key: 'a1', group: 'g1', source: 'Halt!' }] }), { connectionId: connection.id, model: 'm' });
  const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const tag = db.insert(s.tags).values({ projectId, name: '말투 어긋남', color: '#ff0000', scope: ['lines'] }).returning().get();
  const events = () => db.select().from(s.lineEvents).where(eq(s.lineEvents.unitId, unit.id)).orderBy(asc(s.lineEvents.id)).all().map(({ kind, before, after, runId }) => ({ kind, before, after, runId }));
  return { db, projectId, unit, statuses, tag, events };
}

describe('line events (a line\'s history besides its texts)', () => {
  it('keep a status change with who set it: a person, or the run that did', () => {
    const { db, unit, statuses, events } = setup();
    const [first, second] = statuses.map((status) => status.id).filter((id) => id !== unit.statusId);
    db.update(s.units).set({ statusId: first!, statusBy: 'human' }).where(eq(s.units.id, unit.id)).run();
    db.update(s.units).set({ statusId: second!, statusBy: 'ai', statusRunId: 'run-1' }).where(eq(s.units.id, unit.id)).run();
    // Nothing changed: no event.
    db.update(s.units).set({ statusId: second! }).where(eq(s.units.id, unit.id)).run();
    expect(events()).toEqual([
      { kind: 'status', before: unit.statusId, after: first, runId: null },
      { kind: 'status', before: first, after: second, runId: 'run-1' },
    ]);
  });

  it('keep tags put on and taken off, a run\'s marked by the run (event_actor), and a note', () => {
    const { db, unit, tag, events } = setup();
    db.insert(s.unitTags).values({ unitId: unit.id, tagId: tag.id }).run();
    db.insert(s.eventActor).values({ one: 1, runId: 'run-2' }).run();
    db.delete(s.unitTags).where(eq(s.unitTags.unitId, unit.id)).run();
    db.delete(s.eventActor).run();
    db.update(s.units).set({ note: '다시 보기' }).where(eq(s.units.id, unit.id)).run();
    expect(events()).toEqual([
      { kind: 'tag', before: null, after: tag.id, runId: null },
      { kind: 'tag', before: tag.id, after: null, runId: 'run-2' },
      { kind: 'note', before: '', after: '다시 보기', runId: null },
    ]);
  });

  it('keep the text the line shows changing (a 되돌리기 picks an older one) and a suggestion turned down', () => {
    const { db, unit, events } = setup();
    const one = db.insert(s.candidates).values({ unitId: unit.id, text: '멈춰!', origin: 'human' }).returning().get();
    db.update(s.units).set({ candidateId: one.id, translation: one.text }).where(eq(s.units.id, unit.id)).run();
    const two = db.insert(s.candidates).values({ unitId: unit.id, text: '거기 서!', origin: 'ai', runId: 'run-3' }).returning().get();
    db.update(s.units).set({ candidateId: two.id, translation: two.text }).where(eq(s.units.id, unit.id)).run();
    db.update(s.units).set({ candidateId: one.id, translation: one.text }).where(eq(s.units.id, unit.id)).run();
    const offer = db.insert(s.candidates).values({ unitId: unit.id, text: '정지!', origin: 'ai', state: 'pending' }).returning().get();
    db.update(s.candidates).set({ state: 'declined' }).where(eq(s.candidates.id, offer.id)).run();
    // The first text is not a change (it is the first entry of the texts already).
    expect(events()).toEqual([
      { kind: 'text', before: one.id, after: two.id, runId: 'run-3' },
      { kind: 'text', before: two.id, after: one.id, runId: null },
      { kind: 'decline', before: null, after: offer.id, runId: null },
    ]);
  });

  it('keep nothing when the tag or the line goes away (their deletion is not something that happened to the line)', () => {
    const { db, unit, tag, events } = setup();
    db.insert(s.unitTags).values({ unitId: unit.id, tagId: tag.id }).run();
    db.delete(s.tags).where(eq(s.tags.id, tag.id)).run();
    expect(events().filter((event) => event.kind === 'tag')).toHaveLength(1);
    db.delete(s.units).where(eq(s.units.id, unit.id)).run();
    expect(events()).toEqual([]);
  });
});
