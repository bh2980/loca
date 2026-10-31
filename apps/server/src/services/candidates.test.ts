import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { personOwns } from '../engine/apply-candidate.ts';
import { addCandidate, declineSuggestion } from './candidates.ts';
import { importProject } from './importer.ts';
import { saveLine } from './line-save.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hello' }] });
  const { projectId } = importProject(db, file, null as never);
  const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
  return { db, unit, list: () => db.select().from(s.candidates).where(eq(s.candidates.unitId, unit.id)).all() };
}

describe('addCandidate (the one candidate writer, #49)', () => {
  it('keeps who made it: origin, model, note, run and node', () => {
    const { db, unit, list } = setup();
    addCandidate(db, { unitId: unit.id, text: 'A', origin: 'ai', model: 'm1', note: 'AI 번역' });
    addCandidate(db, { unitId: unit.id, text: 'B', origin: 'tool', model: 'm2', runId: 'r1', nodeId: 'n1' });
    const rows = list();
    expect(rows.map(({ text, origin, model, note, runId, nodeId }) => ({ text, origin, model, note, runId, nodeId }))).toEqual([
      { text: 'A', origin: 'ai', model: 'm1', note: 'AI 번역', runId: null, nodeId: null },
      { text: 'B', origin: 'tool', model: 'm2', note: '', runId: 'r1', nodeId: 'n1' },
    ]);
  });

  it('adds the same text again unless asked to reuse it (only a person’s save reuses)', () => {
    const { db, unit, list } = setup();
    const first = addCandidate(db, { unitId: unit.id, text: 'Same', origin: 'ai' });
    expect(addCandidate(db, { unitId: unit.id, text: 'Same', origin: 'ai' })).not.toBe(first);
    expect(addCandidate(db, { unitId: unit.id, text: 'Same', origin: 'human', reuseSame: true })).toBe(first);
    expect(list()).toHaveLength(2);
  });

  it('never touches the line', () => {
    const { db, unit } = setup();
    addCandidate(db, { unitId: unit.id, text: 'X', origin: 'ai' });
    expect(db.select({ translation: s.units.translation }).from(s.units).where(eq(s.units.id, unit.id)).get()?.translation ?? null).toBeNull();
  });

  it('a person saving the same text twice makes one candidate (saveLine reuses)', () => {
    const { db, unit, list } = setup();
    db.transaction((tx) => saveLine(tx, unit, { text: '안녕' }));
    const again = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    db.transaction((tx) => saveLine(tx, { ...again, translation: '다른 글' }, { text: '안녕' }));
    expect(list().filter((row) => row.text === '안녕')).toHaveLength(1);
  });
});

describe('AI 제안 (candidate state)', () => {
  const stateOf = (db: ReturnType<typeof setup>['db'], id: string) => db.select({ state: s.candidates.state }).from(s.candidates).where(eq(s.candidates.id, id)).get()?.state;

  it('a candidate is history unless it is added as a waiting suggestion', () => {
    const { db, unit } = setup();
    expect(stateOf(db, addCandidate(db, { unitId: unit.id, text: 'A', origin: 'ai' }))).toBe('history');
    expect(stateOf(db, addCandidate(db, { unitId: unit.id, text: 'B', origin: 'ai', state: 'pending' }))).toBe('pending');
  });

  it('적용 makes it the line’s text and settles it; the line’s old text stays history', () => {
    const { db, unit } = setup();
    db.transaction((tx) => saveLine(tx, unit, { text: '사람' }));
    const before = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    const suggestion = addCandidate(db, { unitId: unit.id, text: '제안', origin: 'ai', state: 'pending' });
    db.transaction((tx) => saveLine(tx, before, { candidateId: suggestion }));
    expect(db.select({ translation: s.units.translation }).from(s.units).where(eq(s.units.id, unit.id)).get()?.translation).toBe('제안');
    expect(stateOf(db, suggestion)).toBe('history');
    expect(stateOf(db, before.candidateId!)).toBe('history');
  });

  it('거절 keeps it as declined and leaves the line alone; only a waiting one can be declined', () => {
    const { db, unit } = setup();
    const suggestion = addCandidate(db, { unitId: unit.id, text: '제안', origin: 'ai', state: 'pending' });
    expect(declineSuggestion(db, unit.id, suggestion)).toBe(true);
    expect(stateOf(db, suggestion)).toBe('declined');
    expect(declineSuggestion(db, unit.id, suggestion)).toBe(false);
    expect(declineSuggestion(db, unit.id, addCandidate(db, { unitId: unit.id, text: 'old', origin: 'human' }))).toBe(false);
    expect(db.select({ translation: s.units.translation }).from(s.units).where(eq(s.units.id, unit.id)).get()?.translation ?? null).toBeNull();
  });

  it('a person’s save of the same text settles it, whatever kind of line break either has', () => {
    const { db, unit } = setup();
    const suggestion = addCandidate(db, { unitId: unit.id, text: '첫 줄\r\n둘째 줄', origin: 'ai', state: 'pending' });
    db.transaction((tx) => saveLine(tx, unit, { text: '첫 줄\n둘째 줄 ' }));
    expect(stateOf(db, suggestion)).toBe('history');
  });

  it('taking a declined one back (되돌리기) makes it history again', () => {
    const { db, unit } = setup();
    const suggestion = addCandidate(db, { unitId: unit.id, text: '제안', origin: 'ai', state: 'pending' });
    declineSuggestion(db, unit.id, suggestion);
    db.transaction((tx) => saveLine(tx, unit, { candidateId: suggestion }));
    expect(stateOf(db, suggestion)).toBe('history');
  });
});

describe('personOwns (#51)', () => {
  const saved = { translation: '사람 번역', statusBy: 'human' };
  it('a person’s saved text belongs to them while the run picks lines by status', () => {
    expect(personOwns(saved, '실행 번역', true)).toBe(true);
    expect(personOwns(saved, '실행 번역', false)).toBe(false);
    expect(personOwns(saved, '사람 번역', true)).toBe(false);
    expect(personOwns({ translation: '  ', statusBy: 'human' }, 'x', true)).toBe(false);
    expect(personOwns({ translation: 'AI 번역', statusBy: 'ai' }, 'x', true)).toBe(false);
    expect(personOwns(undefined, 'x', true)).toBe(false);
  });
});
