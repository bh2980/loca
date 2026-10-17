import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { realistic } from '../../../../scripts/realistic-sample.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { selectRunUnits } from './run-create.ts';

describe('run scope by marks', () => {
  it('keeps the lines that have every picked mark, and combines with tags and the entry status', () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse(realistic(300).file), { connectionId: connection.id, model: 'm' });
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => row.name === '기본 번역')!;
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    const [noted, notedByAi, plain] = units;
    db.update(s.units).set({ note: '확인 필요' }).where(eq(s.units.id, noted.id)).run();
    db.update(s.units).set({ note: '확인 필요', statusBy: 'ai' }).where(eq(s.units.id, notedByAi.id)).run();
    const tag = db.insert(s.tags).values({ projectId, name: '시험', color: '#888888' }).returning().get();
    db.insert(s.unitTags).values([{ unitId: noted.id, tagId: tag.id }, { unitId: plain.id, tagId: tag.id }]).run();

    const pick = (scope: s.RunScope) => selectRunUnits(db, projectId, workflow.definition, { ignoreStatus: true, ...scope }).sort();
    expect(pick({ marks: ['noted'] })).toEqual([noted.id, notedByAi.id].sort());
    // Marks are ANDed with each other.
    expect(pick({ marks: ['noted', 'ai'] })).toEqual([notedByAi.id]);
    // A tag narrows a mark (tags themselves are "any of"); a tag alone ignores marks.
    expect(pick({ marks: ['noted'], tagIds: [tag.id] })).toEqual([noted.id]);
    expect(pick({ tagIds: [tag.id] })).toEqual([noted.id, plain.id].sort());
    // No marks: the scope is unchanged.
    expect(pick({ marks: [] })).toHaveLength(units.length);
  });

  it('skips a 미번역 line a person translated, unless the scope ignores the status filter', () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse(realistic(200).file), { connectionId: connection.id, model: 'm' });
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => row.name === '기본 번역')!;
    const initial = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'initial'))).get()!;
    const [written, blank] = db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.statusId, initial.id))).all();
    db.update(s.units).set({ translation: '사람 번역', statusBy: 'human' }).where(eq(s.units.id, written.id)).run();
    db.update(s.units).set({ translation: null, statusBy: 'human' }).where(eq(s.units.id, blank.id)).run();

    const picked = selectRunUnits(db, projectId, workflow.definition, {});
    expect(picked).not.toContain(written.id);
    // A person's line with nothing written yet is still untranslated.
    expect(picked).toContain(blank.id);
    // A scope that names lines on purpose is unaffected.
    expect(selectRunUnits(db, projectId, workflow.definition, { unitIds: [written.id], ignoreStatus: true })).toEqual([written.id]);
  });

  it('runs exactly the named lines, however many, and never another project\'s', () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const first = importProject(db, importFileSchema.parse(realistic(1200).file), { connectionId: connection.id, model: 'm' });
    const other = importProject(db, importFileSchema.parse(realistic(50).file), { connectionId: connection.id, model: 'm' });
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, first.projectId)).all().find((row) => row.name === '기본 번역')!;
    const units = db.select().from(s.units).where(eq(s.units.projectId, first.projectId)).all();
    const foreign = db.select().from(s.units).where(eq(s.units.projectId, other.projectId)).all()[0];
    // A route's untranslated lines: more than the 500 ids an IN list binds one by one.
    const route = units.slice(100, 900).map((unit) => unit.id);
    const picked = selectRunUnits(db, first.projectId, workflow.definition, { unitIds: [...route, foreign.id], ignoreStatus: true });
    expect(picked.sort()).toEqual([...route].sort());
  });
});
