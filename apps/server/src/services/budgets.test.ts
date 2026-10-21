import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { autoBudgets, DEFAULT_BUDGETS, lineCost, limitsFor, UNKNOWN_MAX_OUTPUT, importFileSchema, presetConfig, workflowDefinitionSchema, type AiNode } from '@tw/shared';
import { limitsOf } from '@tw/ai';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { budgetHistory, resolveBudgets } from './budgets.ts';
import { autoBudgetDefaults } from './workflow-migrations.ts';

describe('auto budgets', () => {
  it('keep the defaults when the limits are unknown', () => {
    expect(autoBudgets(undefined, 'text', 'group')).toMatchObject({ lines: DEFAULT_BUDGETS.lines, context: DEFAULT_BUDGETS.context, cap: null });
    expect(autoBudgets({}, 'json', 'whole').lines).toBe(DEFAULT_BUDGETS.whole);
  });

  it('size a translation by the output limit and an extraction by the window', () => {
    const big = { contextWindow: 1_000_000, maxOutput: 65_536 };
    expect(autoBudgets(big, 'text', 'group')).toMatchObject({ lines: 19_500, context: 60_000 });
    expect(autoBudgets(big, 'json', 'whole').lines).toBe(104_500);
    expect(autoBudgets({ contextWindow: 32_000 }, 'text', 'group')).toMatchObject({ lines: 4_500, context: 4_000 });
  });

  it('assume UNKNOWN_MAX_OUTPUT when only the window is known, and keep the defaults when neither is', () => {
    expect(UNKNOWN_MAX_OUTPUT).toBe(16_000);
    expect(autoBudgets({ contextWindow: 1_000_000 }, 'text', 'group')).toMatchObject({ lines: 4_500, context: 60_000 });
    expect(autoBudgets({ contextWindow: 1_000_000 }, 'verdict', 'group').lines).toBe(48_000);
    expect(autoBudgets({ contextWindow: 1_000_000, maxOutput: 65_536 }, 'text', 'group').lines).toBe(19_500);
    expect(autoBudgets({ maxOutput: undefined, contextWindow: undefined }, 'text', 'whole')).toMatchObject({ lines: DEFAULT_BUDGETS.whole, context: DEFAULT_BUDGETS.context });
  });

  it('read the limits providers put in their model lists', () => {
    expect(limitsOf({ id: 'a', context_length: 200000, top_provider: { max_completion_tokens: 8192 } })).toEqual({ contextWindow: 200_000, maxOutput: 8_192 });
    expect(limitsOf({ id: 'b', context_window: 131072, max_completion_tokens: 32768 })).toEqual({ contextWindow: 131_072, maxOutput: 32_768 });
    expect(limitsOf({ id: 'c', max_model_len: 32768 })).toEqual({ contextWindow: 32_768 });
    expect(limitsOf({ id: 'd' })).toBeUndefined();
  });
});

describe('resolving and migrating budgets', () => {
  const setup = () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'c', baseUrl: 'http://x/v1', modelLimits: { m: { contextWindow: 1_000_000, maxOutput: 65_536, by: 'api' } } }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] }));
    return { db, projectId, connection };
  };
  const definitionWith = (config: AiNode['config']) => workflowDefinitionSchema.parse({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, config }], edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'ai' }] });

  it('take the connection\'s 입력·출력 토큰 over what the model list said, and the list when they are empty', () => {
    const listed = { m: { contextWindow: 200_000, maxOutput: 8_000, by: 'api' as const } };
    expect(limitsFor({ inputTokens: null, outputTokens: null, modelLimits: listed }, 'm')).toMatchObject({ contextWindow: 200_000, maxOutput: 8_000 });
    expect(limitsFor({ inputTokens: 1_000_000, outputTokens: null, modelLimits: listed }, 'm')).toMatchObject({ contextWindow: 1_000_000, maxOutput: 8_000 });
    expect(limitsFor({ inputTokens: null, outputTokens: null, modelLimits: {} }, 'cli-model')).toBeUndefined();
  });

  it('fills auto from the node model and keeps a person\'s numbers', () => {
    const { db, connection } = setup();
    const auto = resolveBudgets(db, null, definitionWith(presetConfig('translate', { connectionId: connection.id, model: 'm' })));
    expect((auto.nodes[1] as AiNode).config).toMatchObject({ batch: { maxTokens: 19_500 }, context: { maxTokens: 60_000 } });
    const fixed = resolveBudgets(db, null, definitionWith({ ...presetConfig('translate', { connectionId: connection.id, model: 'm' }), batch: { mode: 'group', size: 60, maxTokens: 9_000 } }));
    expect((fixed.nodes[1] as AiNode).config.batch).toMatchObject({ maxTokens: 9_000 });
  });

  it('turns the old fixed defaults of saved workflows into auto', () => {
    const { db, projectId, connection } = setup();
    const config = { ...presetConfig('translate', { connectionId: connection.id, model: 'm' }), batch: { mode: 'group' as const, size: 60, maxTokens: 6_000 }, context: { ...presetConfig('translate', null).context, maxTokens: 12_000 } };
    const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition: definitionWith(config) }).returning().get();
    expect(autoBudgetDefaults(db)).toBeGreaterThanOrEqual(1);
    const node = db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!.definition.nodes[1] as AiNode;
    expect(node.config.batch?.maxTokens).toBeNull();
    expect(node.config.context?.maxTokens).toBeNull();
  });
});

describe('sizing from the node\'s own past requests', () => {
  const big = { contextWindow: 1_000_000, maxOutput: 65_536 };
  const history = (patch: Partial<Parameters<typeof autoBudgets>[3] & object> = {}) => ({ ratios: [], largestOk: null, smallestCutOff: null, ...patch });

  it('keeps a default margin per output kind', () => {
    // maxOutput × margin / ratio: text 0.75 / 2.5, json 0.8 / 0.5, verdict and choice 0.9 / 0.3.
    expect(autoBudgets(big, 'text', 'group').lines).toBe(19_500);
    expect(autoBudgets(big, 'json', 'group').lines).toBe(104_500);
    expect(autoBudgets(big, 'verdict', 'group').lines).toBe(196_500);
    expect(autoBudgets(big, 'choice', 'group').lines).toBe(196_500);
    expect(autoBudgets(big, 'text', 'group').ratio).toEqual({ value: 2.5, by: 'default', samples: 0 });
  });

  it('uses the 90th percentile of past answer ratios with a 0.95 margin from three samples', () => {
    const ratios = [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 3];
    const sized = autoBudgets(big, 'text', 'group', history({ ratios }));
    expect(sized.ratio).toEqual({ value: 2.6, by: 'history', samples: 10 });
    expect(sized.lines).toBe(23_500);
    expect(sized.cap).toBeNull();
  });

  it('falls back to the defaults below three samples', () => {
    const sized = autoBudgets(big, 'text', 'group', history({ ratios: [0.5, 0.6] }));
    expect(sized.ratio).toEqual({ value: 2.5, by: 'default', samples: 0 });
    expect(sized.lines).toBe(19_500);
  });

  it('does not grow past 1.5 times the largest request that worked', () => {
    const sized = autoBudgets(big, 'text', 'group', history({ ratios: [1, 1, 1], largestOk: 6_000 }));
    expect(sized).toMatchObject({ lines: 9_000, cap: { by: 'grown', tokens: 9_000 } });
    // A cap above the limits-based size changes nothing.
    expect(autoBudgets(big, 'text', 'group', history({ largestOk: 40_000 })).cap).toBeNull();
  });

  it('stays under 0.8 times the smallest cut-off request, whichever cap is lower', () => {
    expect(autoBudgets(big, 'text', 'group', history({ smallestCutOff: 10_000 }))).toMatchObject({ lines: 8_000, cap: { by: 'cut-off', tokens: 8_000 } });
    expect(autoBudgets(big, 'text', 'group', history({ largestOk: 4_000, smallestCutOff: 10_000 }))).toMatchObject({ lines: 6_000, cap: { by: 'grown', tokens: 6_000 } });
    // Caps apply when the limits are unknown too.
    expect(autoBudgets(undefined, 'text', 'group', history({ smallestCutOff: 3_000 }))).toMatchObject({ lines: 2_000, cap: { by: 'cut-off' } });
  });

  it('leaves a number set on the node as it is', () => {
    const { db, connection } = (() => {
      const db = openDatabase(':memory:');
      return { db, connection: db.insert(s.connections).values({ kind: 'openai', name: 'c', baseUrl: 'http://x/v1', modelLimits: { m: { ...big, by: 'api' } } }).returning().get() };
    })();
    const definition = workflowDefinitionSchema.parse({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, config: { ...presetConfig('translate', { connectionId: connection.id, model: 'm' }), batch: { mode: 'group', size: 60, maxTokens: 9_000 } } }], edges: [] });
    expect((resolveBudgets(db, 'none', definition).nodes[1] as AiNode).config.batch.maxTokens).toBe(9_000);
  });
});

describe('budgetHistory', () => {
  const setup = () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'c', baseUrl: 'http://x/v1' }).returning().get();
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: Array.from({ length: 4 }, (_, index) => ({ key: `u${index}`, group: 'g', source: 'x'.repeat(400) })) }));
    const ids = db.select({ id: s.units.id }).from(s.units).all().map((row) => row.id);
    const node = { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, config: presetConfig('translate', { connectionId: connection.id, model: 'm' }) } as AiNode;
    const definition = workflowDefinitionSchema.parse({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, node], edges: [] });
    const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition }).returning().get();
    const other = db.insert(s.workflows).values({ projectId, name: 'other', definition }).returning().get();
    const run = (workflowId: string) => db.insert(s.runs).values({ projectId, workflowId, workflowName: 'w', workflowVersion: 1, definition, scope: {}, status: 'completed', total: 4 }).returning().get().id;
    let clock = 1;
    const step = (runId: string, patch: Partial<typeof s.runSteps.$inferInsert>) =>
      db.insert(s.runSteps).values({ runId, nodeId: 'ai', model: 'm', subjectIds: ids.slice(0, 2), ok: true, outputTokens: 400, returnedItems: 2, startedAt: new Date(clock++), finishedAt: new Date(clock), ...patch }).run();
    return { db, node, ids, workflow, other, run, step };
  };
  // A line is 100 tokens of text and LINE_OVERHEAD more.
  const two = lineCost({ tokens: 100 }) * 2;

  it('measures the answer ratio of answered requests, a partial one by the lines it answered', () => {
    const { db, node, workflow, run, step } = setup();
    const runId = run(workflow.id);
    step(runId, {});
    step(runId, { returnedItems: 1, outputTokens: 120 });
    const history = budgetHistory(db, workflow.id, node)!;
    expect(history.ratios).toEqual([expect.closeTo(120 / (two / 2)), expect.closeTo(400 / two)]);
    // Only the request answered in full counts as one that worked.
    expect(history.largestOk).toBe(two);
    expect(history.smallestCutOff).toBeNull();
  });

  it('knows a cut-off answer by its stored error and ignores other failures and rows without tokens', () => {
    const { db, node, ids, workflow, run, step } = setup();
    const runId = run(workflow.id);
    step(runId, { ok: false, outputTokens: 900, error: '응답이 길이 제한에 걸려 잘렸습니다. finishReason: length', subjectIds: ids });
    step(runId, { ok: false, error: '모델 요청 한도에 걸렸습니다.', subjectIds: ids.slice(0, 1) });
    step(runId, { ok: false, error: 'timeout', subjectIds: ids.slice(0, 1) });
    step(runId, { outputTokens: null });
    const history = budgetHistory(db, workflow.id, node)!;
    expect(history).toEqual({ ratios: [], largestOk: null, smallestCutOff: lineCost({ tokens: 100 }) * 4 });
  });

  it('keeps to this workflow, node and model, and to the latest 50 requests', () => {
    const { db, node, workflow, other, run, step } = setup();
    const runId = run(workflow.id);
    step(run(other.id), {});
    step(runId, { nodeId: 'elsewhere' });
    step(runId, { model: 'other-model' });
    // The oldest of 51 answered requests (a cut-off one) falls out of the window.
    step(runId, { ok: false, error: 'finishReason: length' });
    for (let index = 0; index < 50; index++) step(runId, {});
    const history = budgetHistory(db, workflow.id, node)!;
    expect(history.ratios).toHaveLength(50);
    expect(history.smallestCutOff).toBeNull();
    expect(budgetHistory(db, null, node)).toBeUndefined();
  });
});
