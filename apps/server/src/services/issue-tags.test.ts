import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { issueTagIds, seedIssueTags } from './issue-tags.ts';
import { attachUnitTags } from './tag-scope.ts';
import { saveLine } from './line-save.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Alice', source: 'Hello {name}.', tags: ['음성', 'UI'] },
      { key: 'a2', group: 'g1', speaker: 'Bob', source: 'Bye.', tags: ['음성'] },
    ],
  });
  const { projectId } = importProject(db, file);
  const unit = (key: string) => db.select().from(s.units).where(eq(s.units.key, key)).get()!;
  const tagsOf = (key: string) =>
    db.select({ name: s.tags.name }).from(s.unitTags).innerJoin(s.tags, eq(s.tags.id, s.unitTags.tagId)).where(eq(s.unitTags.unitId, unit(key).id)).all().map((tag) => tag.name).sort();
  return { db, projectId, unit, tagsOf };
}

const STARTERS = ['AI 실패', '기타 지적', '말투 어긋남', '문체 어색', '용어 위반', '의미 오류', '형식 오류'];

describe('tags', () => {
  it('come with the file, one project tag per name, beside the tags every project starts with', () => {
    const { db, projectId, tagsOf } = setup();
    expect(db.select({ name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => tag.name).sort()).toEqual([...STARTERS, 'UI', '음성'].sort());
    expect(tagsOf('a1')).toEqual(['UI', '음성']);
  });

  it('the starting tags for findings are ordinary tags on lines, with their 설명; a name the project has is not made twice', () => {
    const { db, projectId } = setup();
    const rows = db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all().filter((tag) => STARTERS.includes(tag.name));
    expect(rows.every((tag) => JSON.stringify(tag.scope) === '["lines"]' && tag.description !== '')).toBe(true);
    seedIssueTags(db, projectId);
    expect(db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all()).toHaveLength(STARTERS.length + 2);
    // Templates find them by name, so a renamed one is no longer wired.
    expect(Object.keys(issueTagIds(db, projectId)).sort()).toEqual(['aiFailed', 'format', 'meaning', 'other', 'speech', 'style', 'term']);
    db.update(s.tags).set({ name: '말투 문제' }).where(eq(s.tags.id, issueTagIds(db, projectId).speech!)).run();
    expect(issueTagIds(db, projectId).speech).toBeUndefined();
  });

  it('stay when a person saves a new text: taking findings off is a workflow\'s 태그 떼기 step', () => {
    const { db, projectId, unit, tagsOf } = setup();
    attachUnitTags(db, projectId, [unit('a1').id], { add: [issueTagIds(db, projectId).speech!] }, { onMisplaced: 'refuse' });
    db.transaction((tx) => saveLine(tx, unit('a1'), { text: '안녕하세요, {name}.' }));
    expect(tagsOf('a1')).toEqual(['UI', '말투 어긋남', '음성']);
  });
});
