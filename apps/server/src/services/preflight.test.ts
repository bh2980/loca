import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_BUDGETS, importFileSchema, presetConfig, UNKNOWN_MAX_OUTPUT, workflowDefinitionSchema } from '@tw/shared';
import { realistic } from '../../../../scripts/realistic-sample.ts';
import { openDatabase } from '../db/index.ts';
import { translateOnlyWorkflow } from '../engine/test-workflows.ts';
import * as s from '../db/schema.ts';
import { promptEntries } from '../engine/prompts.ts';
import { Runner, type ModelPort } from '../engine/runner.ts';
import { createRun } from '../engine/run-create.ts';
import { importProject } from './importer.ts';
import { preflight } from './preflight.ts';
import { snapshotWorkflowModels } from './routes.ts';
import { memoryStore } from './secrets.ts';

/** Translates everything; review passes all but every tenth line once. */
function model(): ModelPort {
  const failed = new Set<string>();
  return {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      const lines = promptEntries(request.prompt);
      if (request.system.includes('Review each'))
        return {
          object: {
            results: lines.map((line, index) => {
              const fail = index % 10 === 0 && !failed.has(line.source);
              if (fail) failed.add(line.source);
              return { id: line.id, passed: !fail, issues: fail ? ['어색함'] : [] };
            }),
          },
          usage: { inputTokens: 25_000, outputTokens: 10 },
        } as never;
      return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: { inputTokens: 25_000, outputTokens: 10 } } as never;
    },
  };
}

describe('preflight', () => {
  it('predicts the plan and the calls of the run it describes', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
    const { projectId } = importProject(db, importFileSchema.parse(realistic(3000).file), choice);
    const workflow = translateOnlyWorkflow(db, projectId);
    const scope = {};

    // First run: no history yet, so only nodes every line passes have an expectation.
    const first = await preflight(db, workflow, scope);
    expect(first.lines.total).toBeGreaterThan(2_900);
    expect(first.plan.batches).toBeGreaterThan(10);
    // The batch list covers every planned line, and each later scene says why it joined.
    expect(first.plan.list.total).toBe(first.plan.batches);
    const listed = first.plan.list.batches;
    if (listed.length === first.plan.batches) expect(listed.reduce((sum, batch) => sum + batch.lines, 0)).toBe(first.lines.total);
    expect(listed.flatMap((batch) => batch.scenes.slice(1)).every((scene) => scene.joined !== null)).toBe(true);
    const translate = first.nodes.find((node) => node.everyLine)!;
    expect(translate.requests.min).toBe(translate.requests.max);
    expect(first.totals.calls.expected).toBe(translate.requests.expected);

    const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope }).runId;
    await new Runner(db, memoryStore(), model()).drain();
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    const actual = (nodeId: string) => steps.filter((step) => step.nodeId === nodeId).length;
    // The first AI node is exact: it follows the same plan.
    expect(actual(translate.nodeId)).toBe(translate.requests.expected);

    // Second preflight learns from the run: every node has an expectation within 20% of what the next run sends, and the connection's fixed overhead is now measured.
    const second = await preflight(db, workflow, scope);
    const secondRun = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope }).runId;
    await new Runner(db, memoryStore(), model()).drain();
    const again = db.select().from(s.runSteps).where(eq(s.runSteps.runId, secondRun)).all();
    for (const node of second.nodes) {
      expect(node.requests.expected).not.toBeNull();
      const ran = again.filter((step) => step.nodeId === node.nodeId).length;
      if (ran) expect(Math.abs(node.requests.expected! - ran) / ran).toBeLessThanOrEqual(0.2);
    }
    expect(second.nodes[0].overheadTokens).toBeGreaterThan(10_000);
    expect(second.totals.calls.expected).toBeGreaterThan(0);
  }, 60_000);
});

describe('preflight split', () => {
  const setup = (connection: Partial<typeof s.connections.$inferInsert>, batch: { maxTokens?: number } = {}) => {
    const db = openDatabase(':memory:');
    const row = db.insert(s.connections).values({ kind: 'openai', name: '연결', baseUrl: 'http://x/v1', ...connection }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }, { key: 'b', group: 'g', source: 'Bye' }] }));
    const config = presetConfig('translate', { connectionId: row.id, model: 'm' });
    const nodes = [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, config: { ...config, batch: { ...config.batch, ...batch } } }];
    const definition = workflowDefinitionSchema.parse({ nodes, edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'ai' }] });
    return preflight(db, { id: null, projectId, definition }, {}).then((result) => result.nodes[0].split);
  };

  it('explains an API connection\'s split by its listed limits', async () => {
    const split = await setup({ modelLimits: { m: { contextWindow: 1_000_000, maxOutput: 65_536, by: 'api' } } });
    expect(split).toMatchObject({ nodeId: 'ai', requests: 1, mode: 'group', linesTokens: 19_500, budgetBy: 'auto', input: { tokens: 1_000_000, by: 'api' }, output: { tokens: 65_536, by: 'api' }, connectionName: '연결', model: 'm' });
  });

  it('explains a CLI connection by the numbers a person gave the model, and the assumed output when only the window is known', async () => {
    const split = await setup({ kind: 'codex', baseUrl: null, modelLimits: { m: { contextWindow: 1_000_000, maxOutput: 30_000, by: 'human' } } });
    expect(split).toMatchObject({ linesTokens: 9_000, input: { tokens: 1_000_000, by: 'human' }, output: { tokens: 30_000, by: 'human' } });
    const assumed = await setup({ kind: 'claude', baseUrl: null, modelLimits: { m: { contextWindow: 1_000_000, by: 'api' } } });
    expect(assumed).toMatchObject({ linesTokens: 4_500, input: { tokens: 1_000_000, by: 'api' }, output: { tokens: UNKNOWN_MAX_OUTPUT, by: 'assumed' } });
  });

  it('reports unknown limits with the default budgets', async () => {
    const split = await setup({ kind: 'codex', baseUrl: null });
    expect(split).toMatchObject({ linesTokens: DEFAULT_BUDGETS.lines, budgetBy: 'auto', input: { tokens: null, by: null }, output: { tokens: null, by: null } });
  });

  it('says a number set on the node is the node\'s own', async () => {
    const split = await setup({ modelLimits: { m: { contextWindow: 1_000_000, maxOutput: 65_536, by: 'api' } } }, { maxTokens: 2_000 });
    expect(split).toMatchObject({ linesTokens: 2_000, budgetBy: 'node' });
  });

  it('sizes the same after past requests, short or cut off', async () => {
    const db = openDatabase(':memory:');
    const row = db.insert(s.connections).values({ kind: 'openai', name: '연결', baseUrl: 'http://x/v1', modelLimits: { m: { contextWindow: 1_000_000, maxOutput: 65_536, by: 'api' } } }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'x'.repeat(8_000) }, { key: 'b', group: 'g', source: 'x'.repeat(8_000) }] }));
    const ids = db.select({ id: s.units.id }).from(s.units).all().map((unit) => unit.id);
    const definition = workflowDefinitionSchema.parse({
      nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, config: presetConfig('translate', { connectionId: row.id, model: 'm' }) }],
      edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'ai' }],
    });
    const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition }).returning().get();
    const run = db.insert(s.runs).values({ projectId, workflowId: workflow.id, workflowName: 'w', workflowVersion: 1, definition, scope: {}, status: 'completed', total: 2 }).returning().get();
    const step = (patch: Partial<typeof s.runSteps.$inferInsert>, at: number) => db.insert(s.runSteps).values({ runId: run.id, nodeId: 'ai', model: 'm', subjectIds: ids, ok: true, outputTokens: 240, returnedItems: 2, startedAt: new Date(at), finishedAt: new Date(at), ...patch }).run();
    const plan = async () => (await preflight(db, workflow, {})).nodes[0].split;

    expect(await plan()).toMatchObject({ linesTokens: 19_500 });
    for (const at of [1, 2, 3]) step({ outputTokens: 404 }, at);
    step({ ok: false, outputTokens: 900, error: 'finishReason: length' }, 4);
    expect(await plan()).toMatchObject({ linesTokens: 19_500 });
  });

  it('keeps room in the call cap for a 재요청 node, at its worst', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse(realistic(600).file), { connectionId: connection.id, model: 'm' });
    const workflow = translateOnlyWorkflow(db, projectId);
    const retry = workflow.definition.nodes.find((node) => node.type === 'retry');
    expect(retry?.type === 'retry' && retry.config).toMatchObject({ scale: 0.5, maxTimes: 2 });
    const withRetry = await preflight(db, workflow, {});
    const full = withRetry.nodes[0]!.full;
    // Without the node: only the usual 30% room.
    const retries = new Set(workflow.definition.nodes.filter((node) => node.type === 'retry').map((node) => node.id));
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.filter((node) => node.type !== 'retry'), edges: workflow.definition.edges.filter((edge) => !retries.has(edge.source) && !retries.has(edge.target)) };
    const without = await preflight(db, { ...workflow, definition }, {});
    expect(without.suggestedLimits.maxCalls).toBe(Math.ceil(full * 1.3));
    // The chain's first node: two rounds at half and quarter size (full / 0.5 + full / 0.25 more calls); the second keeps that size for its three rounds.
    expect(withRetry.suggestedLimits.maxCalls).toBe(Math.ceil(full * 1.3 + Math.ceil(full / 0.5) + Math.ceil(full / 0.25) + 3 * Math.ceil(full / 0.25)));
  });
});
