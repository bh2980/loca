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
    expect(names).toEqual(['기본 번역', '작품 분석', '용어 추출', '청자 추정', '말투만 고치기']);
  });
});
