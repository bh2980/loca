import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { applyIssueTags } from './issue-tags.ts';

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
    db.select({ name: s.tags.name, role: s.tags.role }).from(s.unitTags).innerJoin(s.tags, eq(s.tags.id, s.unitTags.tagId)).where(eq(s.unitTags.unitId, unit(key).id)).all().map((tag) => tag.name).sort();
  return { db, projectId, unit, tagsOf };
}

describe('tags', () => {
  it('come with the file, one project tag per name', () => {
    const { db, projectId, tagsOf } = setup();
    expect(db.select({ name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => tag.name).sort()).toEqual(['AI 실패', 'UI', '음성']);
    expect(tagsOf('a1')).toEqual(['UI', '음성']);
  });

  it('mark problem types: a failing check adds its kind, the same check passing or a new text clears it', () => {
    const { db, projectId, unit, tagsOf } = setup();
    applyIssueTags(db, projectId, unit('a1').id, { add: ['format', 'speech'] });
    expect(tagsOf('a1')).toEqual(['UI', '말투', '음성', '형식']);
    // Created once per project, with their role.
    expect(db.select({ role: s.tags.role }).from(s.tags).where(eq(s.tags.name, '형식')).all()).toEqual([{ role: 'format' }]);
    applyIssueTags(db, projectId, unit('a1').id, { clear: ['format'] });
    expect(tagsOf('a1')).toEqual(['UI', '말투', '음성']);
    applyIssueTags(db, projectId, unit('a1').id, { clear: 'all' });
    // A person's or the file's tags are never touched.
    expect(tagsOf('a1')).toEqual(['UI', '음성']);
  });
});
