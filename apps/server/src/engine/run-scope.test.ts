import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { realistic } from '../../../../scripts/realistic-sample.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { selectRunUnits } from './runner.ts';

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
});
