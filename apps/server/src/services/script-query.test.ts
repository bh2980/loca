import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { batchChangeSchema, importFileSchema, lineFilterSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { applyBatch, checkScript, findLines, normalizeBatch, scenesWith, validateBatch } from './script-query.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [
      { key: 'g1', title: 'Call', section: 'Chapter 1' },
      { key: 'g2', title: 'Chat', section: 'Chapter 2' },
    ],
    units: [
      { key: 'a', group: 'g1', speaker: 'CHAR_ALICE', source: 'Bob, over here.' },
      { key: 'b', group: 'g1', speaker: 'CHAR_BOB', source: 'Ask {CHAR_ALICE} about it.' },
      { key: 'c', group: 'g2', speaker: 'CHAR_BOB', source: 'Bob, over here.' },
    ],
    characters: [
      { name: 'Alice Grey', aliases: ['CHAR_ALICE'] },
      { name: 'Bob Stone', aliases: ['CHAR_BOB'] },
    ],
  });
  const { projectId } = importProject(db, file, null as never);
  return { db, projectId };
}
const filter = (input: Parameters<typeof lineFilterSchema.parse>[0]) => lineFilterSchema.parse(input);

describe('script queries', () => {
  it('resolves speakers and mentions by name, alias or part of a name', () => {
    const { db, projectId } = setup();
    expect(findLines(db, projectId, filter({ speakers: ['Alice'] })).rows.map((row) => row.key)).toEqual(['a']);
    expect(findLines(db, projectId, filter({ mentions: ['Alice Grey'] })).rows.map((row) => row.key)).toEqual(['b']);
    expect(findLines(db, projectId, filter({ sections: ['Chapter 2'] })).total).toBe(1);
    expect(scenesWith(db, projectId, ['Alice', 'Bob']).map((scene) => scene.key)).toEqual(['g1']);
  });

  it('applies a batch atomically, skipping lines changed since they were read', () => {
    const { db, projectId } = setup();
    const [a, b] = findLines(db, projectId, filter({ keys: ['a', 'b'] })).rows;
    const batch = batchChangeSchema.parse({
      changes: [
        { key: 'a', rev: a.rev, translation: '카렌, 내 사랑.' },
        { key: 'b', rev: b.rev, translation: '그건 물어봐.' },
      ],
    });
    const report = validateBatch(db, projectId, batch);
    expect(report.changes).toBe(2);
    // The dropped placeholder is a warning, not an error.
    expect(report.warnings.map((warning) => warning.key)).toEqual(['b']);

    // Someone edits b after the batch was proposed: b is skipped, not overwritten.
    db.update(s.units).set({ translation: '사람이 고침', updatedAt: new Date(b.rev + 1000) }).where(eq(s.units.id, b.id)).run();
    const result = applyBatch(db, projectId, batch);
    expect(result.applied).toBe(1);
    expect(result.skipped.map((entry) => entry.key)).toEqual(['b']);
    expect(db.select().from(s.units).where(eq(s.units.id, b.id)).get()!.translation).toBe('사람이 고침');

    // Re-sending what is already there changes nothing.
    expect(normalizeBatch(db, projectId, batchChangeSchema.parse({ changes: [{ key: 'a', translation: '카렌, 내 사랑.' }] })).unchanged).toEqual(['a']);
  });

  it('finds the same source translated two ways', () => {
    const { db, projectId } = setup();
    applyBatch(db, projectId, batchChangeSchema.parse({ changes: [{ key: 'a', translation: '카렌, 내 사랑.' }, { key: 'c', translation: '카렌, 자기야.' }] }));
    const found = checkScript(db, projectId, 'consistency', filter({})) as { variants: unknown[] }[];
    expect(found).toHaveLength(1);
    expect(found[0].variants).toHaveLength(2);
  });

  it('filters by listener, checks translations against speech rules, and takes listener changes from a batch', () => {
    const { db, projectId } = setup();
    db.update(s.units).set({ listener: 'Bob Stone', listenerOrigin: 'import', translation: '밥, 여기야.' }).where(eq(s.units.key, 'a')).run();
    db.update(s.units).set({ listener: 'CHAR_ALICE', listenerOrigin: 'ai', listenerConfidence: 0.5, translation: '앨리스한테 물어봐요.' }).where(eq(s.units.key, 'b')).run();
    db.insert(s.speechRules).values({ projectId, fromName: 'Alice Grey', toName: 'Bob Stone', level: 'haeyo' }).run();

    // Names resolve through aliases; an unsure AI listener counts as unknown.
    expect(findLines(db, projectId, filter({ listeners: ['Bob'] })).rows.map((row) => [row.key, row.listener])).toEqual([['a', 'Bob Stone']]);
    expect(findLines(db, projectId, filter({ listeners: ['-'] })).rows.map((row) => row.key)).toEqual(['b', 'c']);
    expect(checkScript(db, projectId, 'speech', filter({}))).toEqual([expect.objectContaining({ key: 'a', rule: '해요체', listener: 'Bob Stone' })]);

    const batch = batchChangeSchema.parse({ changes: [{ key: 'b', listener: 'Alice Grey' }, { key: 'a', listener: 'Bob Stone' }] });
    const { batch: normalized, unchanged } = normalizeBatch(db, projectId, batch);
    expect(unchanged).toEqual(['a']);
    applyBatch(db, projectId, normalized);
    const b = db.select().from(s.units).where(eq(s.units.key, 'b')).get()!;
    expect([b.listener, b.listenerOrigin]).toEqual(['Alice Grey', 'human']);
  });
});
