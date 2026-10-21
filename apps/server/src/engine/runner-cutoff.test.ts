import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { importFileSchema, nodeName, translationTemplate, type BatchConfig } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';

const CUT_OFF = () => new ai.ModelError('cli', 'Your previous response was cut off because it exceeded the output token limit', false);

/** One scene of `lines` lines run through the translate/review template, its translate node batching as `batch`. */
function setup(lines: number, batch: Partial<BatchConfig>, concurrency = 1) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ outputTokens: 1000, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: lines }, (_, index) => ({ key: `g1-${index}`, group: 'g1', source: `S0 L${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Scene' }], units }), choice);
  const review = db.insert(s.statuses).values({ projectId, name: '사람 확인 필요', color: '#b26f00', kind: 'normal', inReview: true, sort: 10 }).returning().get();
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const definition = translationTemplate({
    model: choice,
    untranslated: statuses.find((status) => status.kind === 'initial')!.id,
    draft: statuses.find((status) => status.kind === 'normal' && status.id !== review.id)!.id,
    needsReview: review.id,
    confirmed: statuses.find((status) => status.kind === 'final')!.id,
  });
  const nodes = definition.nodes.map((node) => (node.type === 'ai' && node.id === 'translate' ? { ...node, config: { ...node.config, concurrency, batch: { mode: 'group' as const, size: 60, maxTokens: null, ...batch } } } : node));
  const workflow = db.insert(s.workflows).values({ projectId, name: '번역', description: '', definition: { ...definition, nodes } }).returning().get();
  const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} }).runId;
  const translateName = nodeName(workflow.definition.nodes.find((node) => node.id === 'translate')!);
  return { db, runId, translateName };
}

/** Answers every request; `fail(n)` throws for the nth translate request (1-based). Records each translate request's line count. */
function model(fail: (n: number) => boolean) {
  const sizes: number[] = [];
  const port: ModelPort = {
    judge: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      const lines = promptEntries(request.prompt) as { id: string; source: string }[];
      if (request.system.includes('Review each')) return { object: { results: lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage: {} } as never;
      sizes.push(lines.length);
      if (fail(sizes.length)) throw CUT_OFF();
      return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
    },
  };
  return { port, sizes };
}

const runOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;

describe('cut-off answers', () => {
  it('re-splits the requests not yet sent to 0.8 of the cut-off one, leaves one in flight alone, and says so', async () => {
    // maxTokens 1000: 45 lines of 22 tokens a request; the first of two in flight is cut off.
    const { db, runId, translateName } = setup(200, { maxTokens: 1000 }, 2);
    const fake = model((n) => n === 1);
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes.slice(0, 2)).toEqual([45, 45]);
    // 0.8 × 990 tokens = 792 → 36 lines; the request in flight (45) was not touched, none after it is larger.
    expect(fake.sizes.slice(2).every((size) => size <= 36)).toBe(true);
    const run = runOf(db, runId);
    expect(run.notice).toMatch(new RegExp(`^출력 잘림으로 '${translateName}'의 남은 요청을 \\d+개에서 \\d+개로 다시 나눴습니다\\.$`));
    const [, before, after] = /(\d+)개에서 (\d+)개/.exec(run.notice!)!;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it('halves the lines per request in count mode', async () => {
    const { db, runId, translateName } = setup(40, { mode: 'count', size: 8 });
    const fake = model((n) => n === 1);
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes[0]).toBe(8);
    expect(fake.sizes.slice(1).every((size) => size <= 4)).toBe(true);
    expect(runOf(db, runId).notice).toBe(`출력 잘림으로 '${translateName}'의 요청당 대사 수를 8에서 4로 줄였습니다.`);
  });

  it('pauses at the third cut-off in a row and leaves the lines not sent', async () => {
    const { db, runId } = setup(40, { mode: 'count', size: 4 });
    const fake = model(() => true);
    await new Runner(db, memoryStore(), fake.port).drain();
    const run = runOf(db, runId);
    expect(run.status).toBe('paused');
    expect(run.notice).toBe('출력 잘림이 3번 연속 나서 멈췄습니다. 노드의 요청당 대사 양을 줄이거나 연결의 출력 토큰을 확인하세요.');
    expect(fake.sizes).toHaveLength(3);
    const unsent = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all().filter((item) => item.nodeId === 'translate' && item.state === 'queued');
    expect(unsent.length).toBeGreaterThan(0);
  });

  it('counts only cut-offs in a row: an answered request starts the count again', async () => {
    const { db, runId } = setup(60, { mode: 'count', size: 8 });
    const fake = model((n) => n % 3 !== 0);
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes.length).toBeGreaterThan(6);
    expect(runOf(db, runId).notice ?? '').not.toContain('3번 연속');
    expect(runOf(db, runId).status).toBe('completed');
  });

  it('keeps the lowered size in the run, so a new runner (a restart) and a resume plan with it', async () => {
    const { db, runId } = setup(40, { mode: 'count', size: 8 });
    await new Runner(db, memoryStore(), model(() => true).port).drain();
    expect(runOf(db, runId).status).toBe('paused');
    // 8 → 4 → 2 → 1, one halving per cut-off request (each carried 8, 4 and 2 lines).
    const batchOf = () => (runOf(db, runId).definition.nodes.find((node) => node.id === 'translate') as { config: { batch: BatchConfig } }).config.batch;
    expect(batchOf().size).toBeLessThan(8);
    const stored = batchOf().size;
    const fresh = new Runner(db, memoryStore(), model(() => false).port);
    fresh.resume(runId);
    const fake = model(() => false);
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes.length).toBeGreaterThan(0);
    expect(fake.sizes.every((size) => size <= stored)).toBe(true);
  });
});
