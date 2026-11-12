import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { createRun } from './run-create.ts';
import { RunGuards, withCaps } from './run-guards.ts';
import { record, retryRule, route, takenBack } from './run-state.ts';

/*
 * The parts of the runner on their own: no scheduler, no model. The line state machine (run-state.ts)
 * is driven by calling it; the guards (run-guards.ts) by the steps on record.
 */

const at = { x: 0, y: 0 };

/** Four lines at entry → AI 번역 → (out) 검사, with one retry rule: a cut-off goes back at half size, twice. */
function setup(limits?: s.RunLimits) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: 4 }, (_, index) => ({ key: `l${index}`, group: 'g', source: `Line ${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units }), choice);
  const definition = workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: {} },
      { id: 'translate', type: 'ai', position: at, config: { model: choice, instructions: 'Translate.', output: 'text' } },
      { id: 'check', type: 'condition', position: at, config: { expression: true, description: '' } },
    ],
    edges: [
      { id: '1', source: 'entry', sourceHandle: 'out', target: 'translate' },
      { id: '2', source: 'translate', sourceHandle: 'out', target: 'check' },
    ],
    settings: { retries: [{ kinds: ['cut-off'], scale: 0.5, wait: 0, maxTimes: 2 }], maxConsecutiveFailures: 3, maxVisitsPerNode: 2 },
  });
  const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition }).returning().get();
  const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {}, limits });
  // The lines as they wait at the AI node.
  db.update(s.runItems).set({ nodeId: 'translate', visits: { entry: 1, translate: 1 } }).where(eq(s.runItems.runId, runId)).run();
  const run = () => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;
  const items = () => db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
  const step = (ok: boolean, retried = false, inputTokens = 0) => db.insert(s.runSteps).values({ runId, nodeId: 'translate', subjectIds: [], ok, retried, inputTokens, startedAt: new Date(), finishedAt: new Date() }).run();
  return { db, runId, run, items, step };
}

describe('the line state machine (run-state.ts)', () => {
  it('records a node\'s answer on the line and moves it to the next node', () => {
    const { db, run, items } = setup();
    const [item] = items();
    db.transaction((tx) => record(tx, run(), item!, { port: 'out', candidate: '번역', output: { text: '번역' } }));
    const moved = items().find((row) => row.id === item!.id)!;
    expect(moved).toMatchObject({ state: 'queued', nodeId: 'check', visits: { entry: 1, translate: 1, check: 1 } });
    expect(moved.data).toMatchObject({ candidateText: '번역', outputs: { translate: { text: '번역' } }, issues: [] });
    expect(moved.data.path.at(-1)).toMatchObject({ nodeId: 'translate', port: 'out' });
  });

  it('a failure a retry rule takes sends the line back to the same node, smaller, until the rule is used up; then it fails', () => {
    const { db, run, items } = setup();
    const id = items()[0]!.id;
    const fail = () => db.transaction((tx) => route(tx, run(), items().find((row) => row.id === id)!, 'error', 'cut', 'cut-off'));
    const now = () => items().find((row) => row.id === id)!;
    expect(retryRule(run(), run().definition.nodes[1], now(), 'cut-off')).toMatchObject({ key: 'translate:0' });
    expect(retryRule(run(), run().definition.nodes[1], now(), 'timeout')).toBeUndefined();
    fail();
    expect(now()).toMatchObject({ state: 'queued', nodeId: 'translate', error: null, visits: { translate: 1 } });
    expect(now().data).toMatchObject({ retry: { times: { 'translate:0': 1 }, factor: 0.5, last: { kind: 'cut-off', rule: 0 } }, lastError: { kind: 'cut-off' } });
    expect(now().data.path.at(-1)!.port).toBe('retry');
    fail();
    expect(now().data.retry).toMatchObject({ times: { 'translate:0': 2 }, factor: 0.25 });
    // The rule has sent it back twice: the next cut-off leaves through 오류, which leads nowhere here.
    expect(takenBack(run(), 'translate', [now()], 'cut-off')).toBe(false);
    fail();
    expect(now()).toMatchObject({ state: 'failed', nodeId: 'translate', error: 'cut' });
    expect(now().data.error).toMatchObject({ kind: 'cut-off', message: 'cut', nodeId: 'translate' });
  });

  it('ends a line that comes to a node more often than the workflow allows', () => {
    const { db, run, items } = setup();
    const item = { ...items()[0]!, visits: { entry: 1, translate: 1, check: 2 } };
    db.transaction((tx) => route(tx, run(), item, 'out'));
    expect(items().find((row) => row.id === item.id)).toMatchObject({ state: 'failed', error: expect.stringContaining('방문 상한(2회)') });
  });
});

describe('the guards (run-guards.ts)', () => {
  it('caps: a number sets one, null removes it, one not named stays; the mark of the cap that stopped the run goes', () => {
    expect(withCaps(null, { maxCalls: 5 })).toEqual({ maxCalls: 5 });
    expect(withCaps({ maxCalls: 4, maxInputTokens: 100, hit: 'calls' }, undefined)).toEqual({ maxCalls: 4, maxInputTokens: 100 });
    expect(withCaps({ maxCalls: 4, maxInputTokens: 100, hit: 'calls' }, { maxCalls: 40 })).toEqual({ maxCalls: 40, maxInputTokens: 100 });
    expect(withCaps({ maxCalls: 4, maxInputTokens: 100 }, { maxCalls: null })).toEqual({ maxInputTokens: 100 });
    expect(withCaps({ maxCalls: 4 }, { maxCalls: null })).toBeNull();
    expect(withCaps(null, undefined)).toBeNull();
  });

  it('pauses at three failed requests in a row, not counting the ones a retry rule took back', () => {
    const { db, runId, run, step } = setup();
    const guards = new RunGuards(db);
    step(false, true);
    step(false, true);
    step(false, true);
    guards.afterCall(runId, { message: 'cut' });
    expect(run().status).toBe('running');
    step(false);
    step(true);
    step(false);
    step(false);
    guards.afterCall(runId, { message: 'boom' });
    expect(run().status).toBe('running');
    step(false);
    guards.afterCall(runId, { message: 'boom' });
    expect(run()).toMatchObject({ status: 'paused', notice: expect.stringContaining('3번 연달아') });
  });

  it('pauses at once on a failure the next request would meet too', () => {
    const { db, runId, run } = setup();
    new RunGuards(db).afterCall(runId, { code: 'auth', message: '키가 틀립니다.' });
    expect(run()).toMatchObject({ status: 'paused', notice: '인증 오류로 멈췄습니다: 키가 틀립니다.' });
  });

  it('holds the input cap before a request goes out, counting what is still in flight', () => {
    const { db, runId, step } = setup({ maxInputTokens: 1_000 });
    const guards = new RunGuards(db);
    step(true, false, 450);
    // About 300 tokens each: the first fits (450 + 300), the second would not while the first is out (450 + 300 + 300).
    const prompt = 'x'.repeat(1_200);
    const first = guards.reserve(runId, null, prompt);
    expect('release' in first).toBe(true);
    expect(guards.reserve(runId, null, prompt)).toMatchObject({ over: expect.stringContaining('진행 중 약 300') });
    if ('release' in first) first.release();
    // Once the first has answered and its real tokens are on record, there is room or not by what it used.
    step(true, false, 250);
    expect('release' in guards.reserve(runId, null, prompt)).toBe(true);
  });
});
