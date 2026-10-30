import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { batchChangeSchema, importFileSchema, lineFilterSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { applyBatch, checkScript, exportLines, findLines, normalizeBatch, scenesWith, validateBatch } from './script-query.ts';

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

  it('finds the same source translated two ways', async () => {
    const { db, projectId } = setup();
    applyBatch(db, projectId, batchChangeSchema.parse({ changes: [{ key: 'a', translation: '카렌, 내 사랑.' }, { key: 'c', translation: '카렌, 자기야.' }] }));
    const found = (await checkScript(db, projectId, 'consistency', filter({}))) as { variants: unknown[] }[];
    expect(found).toHaveLength(1);
    expect(found[0].variants).toHaveLength(2);
  });

  it('filters by listener and takes listener changes from a batch', async () => {
    const { db, projectId } = setup();
    db.update(s.units).set({ listener: 'Bob Stone', listenerOrigin: 'import', translation: '밥, 여기야.' }).where(eq(s.units.key, 'a')).run();
    db.update(s.units).set({ listener: 'CHAR_ALICE', listenerOrigin: 'ai', listenerConfidence: 0.5, translation: '앨리스한테 물어봐요.' }).where(eq(s.units.key, 'b')).run();
    db.insert(s.speechRules).values({ projectId, fromName: 'Alice Grey', toName: 'Bob Stone', level: 'haeyo' }).run();

    // Names resolve through aliases; an unsure AI listener counts as unknown.
    expect(findLines(db, projectId, filter({ listeners: ['Bob'] })).rows.map((row) => [row.key, row.listener])).toEqual([['a', 'Bob Stone']]);
    expect(findLines(db, projectId, filter({ listeners: ['-'] })).rows.map((row) => row.key)).toEqual(['b', 'c']);

    const batch = batchChangeSchema.parse({ changes: [{ key: 'b', listener: 'Alice Grey' }, { key: 'a', listener: 'Bob Stone' }] });
    const { batch: normalized, unchanged } = normalizeBatch(db, projectId, batch);
    expect(unchanged).toEqual(['a']);
    applyBatch(db, projectId, normalized);
    const b = db.select().from(s.units).where(eq(s.units.key, 'b')).get()!;
    expect([b.listener, b.listenerOrigin]).toEqual(['Alice Grey', 'human']);
  });
});

describe('projects with tens of thousands of lines', () => {
  /** Bulk-insert `count` lines into the first scene of a project, 400 rows per statement. */
  function fill(count: number) {
    const { db, projectId } = setup();
    const group = db.select().from(s.groups).limit(1).get()!;
    const status = db.select().from(s.units).limit(1).get()!.statusId;
    for (let start = 0; start < count; start += 400) {
      db.insert(s.units)
        .values(Array.from({ length: Math.min(400, count - start) }, (_, offset) => ({ projectId, groupId: group.id, key: `bulk${start + offset}`, sort: 1000 + start + offset, kind: 'dialogue' as const, speaker: 'CHAR_BOB', source: `Line ${start + offset}`, statusId: status })))
        .run();
    }
    return { db, projectId };
  }

  it('exports 40,000 lines without hitting the bound-variable limit', () => {
    const { db, projectId } = fill(40_000);
    const started = performance.now();
    const rows = exportLines(db, projectId, filter({ limit: 100 }), { before: 0, terms: false, all: true });
    console.log(`exportLines(40k): ${Math.round(performance.now() - started)} ms`);
    expect(rows).toHaveLength(40_003);
  }, 60_000);

  it('normalizes and validates 6,000 keys', () => {
    const { db, projectId } = fill(6_000);
    // Built directly: the schema caps one request at 5,000, but callers may merge several.
    const batch = { origin: 'human' as const, changes: Array.from({ length: 6_000 }, (_, index) => ({ key: `bulk${index}`, translation: `번역 ${index}`, addTags: [], removeTags: [], note: '' })) };
    const normalized = normalizeBatch(db, projectId, batch);
    expect(normalized.batch.changes).toHaveLength(6_000);
    const report = validateBatch(db, projectId, batch);
    expect(report.errors).toEqual([]);
    expect(report.changes).toBe(6_000);
  }, 60_000);

  it('filters by thousands of keys', () => {
    const { db, projectId } = fill(3_000);
    const keys = Array.from({ length: 3_000 }, (_, index) => `bulk${index}`);
    expect(findLines(db, projectId, filter({ keys, limit: 10 })).total).toBe(3_000);
  });
});
