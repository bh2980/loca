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

/** Every request times out. */
const alwaysTimesOut = () => {
  const calls: string[] = [];
  const port: ModelPort = {
    judge: async () => {
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
  db.update(s.connections).set({ outputTokens: 1000, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: 4 }, (_, index) => ({ key: `u${index}`, group: `g${index}`, source: `Hello ${index}`, translation: templateKey === 'translation' ? undefined : `안녕 ${index}` }));
  const groups = units.map((unit) => ({ key: unit.group, title: unit.group }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups, units }), choice);
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const review = db.insert(s.statuses).values({ projectId, name: '사람 확인 필요', color: '#b26f00', kind: 'normal', inReview: true, sort: 10 }).returning().get();
  const aiFailed = db.select().from(s.tags).where(eq(s.tags.role, 'aiFailed')).get()!;
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.key === templateKey)!;
  const built = template.build({
    model: choice,
    untranslated: statuses.find((status) => status.kind === 'initial')!.id,
    translated: statuses.find((status) => status.kind === 'normal')!.id,
    needsReview: review.id,
    confirmed: statuses.find((status) => status.kind === 'final')!.id,
    aiFailedTag: aiFailed.id,
  });
  const definition = workflowDefinitionSchema.parse({ ...built, settings: { ...built.settings, maxConsecutiveFailures: 50 } });
  const workflow = db.insert(s.workflows).values({ projectId, name: template.name, description: '', definition }).returning().get();
  const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} }).runId;
  return { db, runId, review, aiFailed };
}

describe('every AI node of a template fails the same way', () => {
  it.each(['listener', 'people', 'events', 'terms'])('%s: an AI that keeps timing out is sent again twice, then the lines end with the AI 실패 tag', async (key) => {
    const { db, runId, aiFailed } = setup(key);
    const fake = alwaysTimesOut();
    await new Runner(db, memoryStore(), fake.port).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items).toHaveLength(4);
    // Each item is handed on to the tag node and ends done; the failure is on the line, not in the run.
    expect(items.every((item) => item.state === 'done' && item.data.path.some((step) => step.nodeId.endsWith('-failed')))).toBe(true);
    expect(items.every((item) => item.data.retry?.times[`${items[0]!.data.path.find((step) => step.nodeId.endsWith('-resend'))!.nodeId}`] === 2)).toBe(true);
    const tagged = db.select().from(s.unitTags).where(eq(s.unitTags.tagId, aiFailed.id)).all();
    expect(tagged).toHaveLength(4);
    // One request per line batch and two resends each: nothing else was asked.
    expect(fake.calls.length % 3).toBe(0);
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('translation: an AI 번역 that keeps timing out sends the lines to 검토 필요', async () => {
    const { db, runId, review } = setup('translation');
    const fake = alwaysTimesOut();
    await new Runner(db, memoryStore(), fake.port).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done' && item.data.path.some((step) => step.nodeId === 'translate-failed'))).toBe(true);
    expect(db.select().from(s.units).all().every((unit) => unit.statusId === review.id)).toBe(true);
    // Nothing past the failed AI 번역 ran.
    expect(items.every((item) => !item.data.path.some((step) => step.nodeId === 'review' || step.nodeId === 'save'))).toBe(true);
  });
});
