import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { importFileSchema, WORKFLOW_TEMPLATES, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';
import { issueTagIds } from '../services/issue-tags.ts';

/** Every request times out. */
const alwaysTimesOut = () => {
  const calls: string[] = [];
  const port: ModelPort = {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      calls.push(request.system.slice(0, 20));
      throw new ai.ModelError('timeout', '제한 시간을 초과했습니다.', false);
    },
  };
  return { port, calls };
};

function setup(templateKey: string) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: 4 }, (_, index) => ({ key: `u${index}`, group: `g${index}`, source: `Hello ${index}`, translation: templateKey === 'translation' ? undefined : `안녕 ${index}` }));
  const groups = units.map((unit) => ({ key: unit.group, title: unit.group }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups, units }), choice);
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const review = db.insert(s.statuses).values({ projectId, name: '사람 확인 필요', color: '#b26f00', kind: 'normal', inReview: true, sort: 10 }).returning().get();
  const issueTags = issueTagIds(db, projectId);
  const aiFailed = db.select().from(s.tags).where(eq(s.tags.id, issueTags.aiFailed!)).get()!;
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.key === templateKey)!;
  const built = template.build({
    model: choice,
    untranslated: statuses.find((status) => status.kind === 'initial')!.id,
    translated: statuses.find((status) => status.kind === 'normal')!.id,
    needsReview: review.id,
    confirmed: statuses.find((status) => status.kind === 'final')!.id,
    issueTags,
  });
  const definition = workflowDefinitionSchema.parse({ ...built, settings: { ...built.settings, maxConsecutiveFailures: 50 } });
  const workflow = db.insert(s.workflows).values({ projectId, name: template.name, description: '', definition }).returning().get();
  const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} }).runId;
  return { db, runId, review, aiFailed };
}

describe('every AI node of a template fails the same way', () => {
  it.each(['listener', 'people', 'events', 'terms'])('%s: an AI that keeps timing out is sent again twice by the default retry rule, then the lines end failed in the run, untagged', async (key) => {
    const { db, runId, aiFailed } = setup(key);
    const fake = alwaysTimesOut();
    await new Runner(db, memoryStore(), fake.port).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items).toHaveLength(4);
    // Each item leaves the AI node's 오류 exit, which has nothing after it: it ends failed, so '실패한 줄 다시' offers it.
    expect(items.every((item) => item.state === 'failed' && item.data.path.at(-1)?.port === 'error')).toBe(true);
    expect(items.every((item) => item.data.retry?.times[`${items[0]!.data.path.find((step) => step.port === 'retry')!.nodeId}:0`] === 2)).toBe(true);
    // Not a translation failure: the lines get no 'AI 실패' tag (the run says what failed).
    expect(db.select().from(s.unitTags).where(eq(s.unitTags.tagId, aiFailed.id)).all()).toHaveLength(0);
    // One request per line batch and two resends each: nothing else was asked.
    expect(fake.calls.length % 3).toBe(0);
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('translation: an AI 번역 that keeps timing out sends the lines to 검토 필요', async () => {
    const { db, runId, review } = setup('translation');
    const fake = alwaysTimesOut();
    await new Runner(db, memoryStore(), fake.port).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done' && item.data.path.at(-1)?.nodeId === 'translate' && item.data.path.at(-1)?.port === 'error')).toBe(true);
    expect(db.select().from(s.units).all().every((unit) => unit.statusId === review.id)).toBe(true);
    // Nothing past the failed AI 번역 ran.
    expect(items.every((item) => !item.data.path.some((step) => step.nodeId === 'review' || step.nodeId === 'save'))).toBe(true);
  });
});
