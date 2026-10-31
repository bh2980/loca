import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { realistic } from '../../../../scripts/realistic-sample.ts';
import { openDatabase } from '../db/index.ts';
import { translateOnlyWorkflow } from './test-workflows.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { translatableSql } from '../services/line-marks.ts';
import { selectRunUnits } from './run-create.ts';

/** The project's lines for translation (not 번역 제외). */
const translatable = (db: ReturnType<typeof openDatabase>, projectId: string) =>
  db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), translatableSql(projectId))).all().map((row) => row.id);

describe('run scope by marks', () => {
  it('keeps the lines that have every picked mark, and combines with tags and the entry status', () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse(realistic(300).file), { connectionId: connection.id, model: 'm' });
    const workflow = translateOnlyWorkflow(db, projectId);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    const [noted, notedByAi, plain] = units;
    db.update(s.units).set({ note: '확인 필요' }).where(eq(s.units.id, noted.id)).run();
    db.update(s.units).set({ note: '확인 필요', statusBy: 'ai' }).where(eq(s.units.id, notedByAi.id)).run();
    const tag = db.insert(s.tags).values({ projectId, name: '시험', color: '#888888' }).returning().get();
    db.insert(s.unitTags).values([{ unitId: noted.id, tagId: tag.id }, { unitId: plain.id, tagId: tag.id }]).run();

    const pick = (scope: s.RunScope) => selectRunUnits(db, projectId, { ...scope }).sort();
    expect(pick({ noted: true })).toEqual([noted.id, notedByAi.id].sort());
    // The row facts are ANDed with each other.
    expect(pick({ noted: true, decidedBy: 'ai' })).toEqual([notedByAi.id]);
    // A tag narrows them (tags themselves are "any of"); a tag alone ignores them.
    expect(pick({ noted: true, tagIds: [tag.id] })).toEqual([noted.id]);
    expect(pick({ tagIds: [tag.id] })).toEqual([noted.id, plain.id].sort());
    // No marks: the scope is unchanged (every line for translation; 번역 제외 lines never run).
    expect(pick({ marks: [] })).toEqual(translatable(db, projectId).sort());
  });

  it('a status filter picks exactly the lines in those statuses, including ones a person already translated', () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse(realistic(200).file), { connectionId: connection.id, model: 'm' });
    const workflow = translateOnlyWorkflow(db, projectId);
    const initial = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'initial'))).get()!;
    const [written, blank] = db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.statusId, initial.id))).all();
    db.update(s.units).set({ translation: '사람 번역', statusBy: 'human' }).where(eq(s.units.id, written.id)).run();
    db.update(s.units).set({ translation: null, statusBy: 'human' }).where(eq(s.units.id, blank.id)).run();

    const picked = selectRunUnits(db, projectId, { statusIds: [initial.id] });
    expect(picked).toContain(written.id);
    expect(picked).toContain(blank.id);
    const inInitial = db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.statusId, initial.id), translatableSql(projectId))).all().map((row) => row.id);
    expect(picked.sort()).toEqual(inInitial.sort());
    expect(selectRunUnits(db, projectId, { unitIds: [written.id] })).toEqual([written.id]);
  });

  it('runs exactly the named lines, however many, and never another project\'s', () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const first = importProject(db, importFileSchema.parse(realistic(1200).file), { connectionId: connection.id, model: 'm' });
    const other = importProject(db, importFileSchema.parse(realistic(50).file), { connectionId: connection.id, model: 'm' });
    const workflow = translateOnlyWorkflow(db, first.projectId);
    const units = db.select().from(s.units).where(eq(s.units.projectId, first.projectId)).all();
    const foreign = db.select().from(s.units).where(eq(s.units.projectId, other.projectId)).all()[0];
    // A route's untranslated lines: more than the 500 ids an IN list binds one by one.
    const route = units.slice(100, 900).map((unit) => unit.id);
    const picked = selectRunUnits(db, first.projectId, { unitIds: [...route, foreign.id] });
    const forTranslation = new Set(translatable(db, first.projectId));
    expect(picked.sort()).toEqual(route.filter((id) => forTranslation.has(id)).sort());
  });

  it('filters by statusIds specified in scope', () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse(realistic(100).file), { connectionId: connection.id, model: 'm' });
    const workflow = translateOnlyWorkflow(db, projectId);
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const untranslated = statuses.find((s) => s.kind === 'initial')!;
    const draft = statuses.find((s) => s.kind === 'normal')!;

    const untranslatedUnits = selectRunUnits(db, projectId, { statusIds: [untranslated.id] });
    const draftUnits = selectRunUnits(db, projectId, { statusIds: [draft.id] });
    const bothUnits = selectRunUnits(db, projectId, { statusIds: [untranslated.id, draft.id] });
    expect(untranslatedUnits.length).toBeGreaterThan(0);
    expect(draftUnits.length).toBeGreaterThan(0);
    expect(bothUnits.length).toBe(untranslatedUnits.length + draftUnits.length);
  });
});
