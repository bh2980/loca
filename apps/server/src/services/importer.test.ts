import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';

describe('default workflows of a new project', () => {
  it('has 작품 분석 but no "자료 갱신" (that template stays available from "새 워크플로")', () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] });
    const { projectId } = importProject(db, file);
    const names = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().map((workflow) => workflow.name);
    expect(names).not.toContain('자료 갱신');
    expect(names).toEqual(['번역', '청자 추정', '인물·관계 추출', '사건 추출']);
    // 번역 sends lines it could not get past review to 검토 필요, a status listed in the review inbox.
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().map((status) => [status.name, status.inReview]);
    expect(statuses).toEqual([['미번역', false], ['번역됨', false], ['검토 필요', true], ['완료', false]]);
    expect(db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.name, tag.role])).toEqual([['AI 실패', 'aiFailed']]);
  });

  it('puts imported lines that already have a translation in 번역됨', () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi', translation: '안녕' }, { key: 'b', group: 'g', source: 'Yo' }] });
    const { projectId } = importProject(db, file);
    const names = new Map(db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().map((status) => [status.id, status.name]));
    const byKey = new Map(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.key, names.get(unit.statusId)]));
    expect([byKey.get('a'), byKey.get('b')]).toEqual(['번역됨', '미번역']);
  });
});


describe('character roles in imports', () => {
  it('keeps supplied roles and defaults older files to unknown', () => {
    const supplied = importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }], characters: [{ name: 'Lead', role: 'main' }, { name: 'Extra' }] });
    expect(supplied.characters.map((character) => character.role)).toEqual(['main', 'unknown']);
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, supplied);
    expect(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((character) => character.role)).toEqual(['main', 'unknown']);
  });
});
