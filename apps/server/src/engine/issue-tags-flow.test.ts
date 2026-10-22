import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, translationTemplate, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { withoutTerms } from './test-workflows.ts';
import { createRun } from './run-create.ts';

/** The tags of a line that are problem types, by name. */
const issueTagsOf = (db: ReturnType<typeof openDatabase>, key: string) => {
  const unit = db.select().from(s.units).where(eq(s.units.key, key)).get()!;
  const tags = db.select().from(s.tags).all();
  return db.select().from(s.unitTags).where(eq(s.unitTags.unitId, unit.id)).all().flatMap((row) => tags.filter((tag) => tag.id === row.tagId && tag.role).map((tag) => tag.name)).sort();
};

describe('the default 번역 workflow tags through its 태그 붙이기 nodes', () => {
  it('tags a failing line with the review\'s categories and untags it after a passing re-review', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
    const model = { connectionId: connection.id, model: 'm' };
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Scene' }], units: [{ key: 'u0', group: 'g1', source: 'Line 0' }, { key: 'u1', group: 'g1', source: 'Line 1' }] }), model);
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const status = (kind: string) => statuses.find((item) => item.kind === kind)!.id;
    expect(db.select().from(s.tags).all().map((tag) => tag.role)).toEqual(['aiFailed']);

    let reviews = 0;
    const duringSecondReview: string[][] = [];
    const port: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        const lines = promptEntries(request.prompt) as { id: string; source: string }[];
        if (request.system.includes('Review each')) {
          reviews++;
          if (reviews === 2) duringSecondReview.push(issueTagsOf(db, 'u1'), issueTagsOf(db, 'u0'));
          // u1 fails its first review (speech and term); everything else passes.
          return { object: { results: lines.map((line) => ({ id: line.id, passed: !(reviews === 1 && line.source === 'Line 1'), issues: reviews === 1 && line.source === 'Line 1' ? ['말투'] : [], categories: reviews === 1 && line.source === 'Line 1' ? ['speech', 'term'] : [] })) }, usage: {} } as never;
        }
        // The revision comes back as the same text, so the line is not rewritten and its tags are the review's to take off.
        return { object: { results: lines.map((line) => ({ id: line.id, text: `번역 ${line.source}` })) }, usage: {} } as never;
      },
    };
    const definition = workflowDefinitionSchema.parse(withoutTerms(translationTemplate({ model, untranslated: status('initial'), translated: status('normal'), needsReview: status('normal'), confirmed: status('final') })));
    const workflow = db.insert(s.workflows).values({ projectId, name: '번역', definition }).returning().get();
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await new Runner(db, memoryStore(), port).drain();

    // At the second review the failed line carries the two kinds the review named; the other has none.
    expect(duringSecondReview).toEqual([['말투', '용어'], []]);
    // The kinds came into the project when they were first put on, and a pass took them off again.
    expect(db.select().from(s.tags).all().map((tag) => tag.role).sort()).toEqual(['aiFailed', 'speech', 'term']);
    expect(issueTagsOf(db, 'u1')).toEqual([]);
    expect(db.select().from(s.units).where(eq(s.units.key, 'u1')).get()!.statusId).toBe(status('final'));
  });
});
