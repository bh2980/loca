import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { autoBudgets, DEFAULT_BUDGETS, limitsFor, limitsWithSource, UNKNOWN_MAX_OUTPUT, importFileSchema, presetConfig, workflowDefinitionSchema, type AiNode } from '@tw/shared';
import { limitsOf } from '@tw/ai';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { resolveBudgets } from './budgets.ts';

describe('auto budgets', () => {
  it('keep the defaults when the limits are unknown', () => {
    expect(autoBudgets(undefined, 'text', 'group')).toMatchObject({ lines: DEFAULT_BUDGETS.lines, context: DEFAULT_BUDGETS.context });
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

  it('read the limits the model list (or a learned call) gave, and nothing else', () => {
    const listed = { m: { contextWindow: 200_000, maxOutput: 8_000, by: 'api' as const } };
    expect(limitsFor({ modelLimits: listed }, 'm')).toMatchObject({ contextWindow: 200_000, maxOutput: 8_000 });
    expect(limitsFor({ modelLimits: listed }, 'other')).toBeUndefined();
    expect(limitsFor({ modelLimits: {} }, 'cli-model')).toBeUndefined();
    expect(limitsFor(undefined, 'm')).toBeUndefined();
    expect(limitsWithSource({ modelLimits: listed }, 'm')).toEqual({ input: { tokens: 200_000, by: 'api' }, output: { tokens: 8_000, by: 'api' } });
    expect(limitsWithSource({ modelLimits: { m: { contextWindow: 100_000, by: 'api' } } }, 'm').output).toEqual({ tokens: UNKNOWN_MAX_OUTPUT, by: 'assumed' });
    expect(limitsWithSource({ modelLimits: {} }, 'm')).toEqual({ input: { tokens: null, by: null }, output: { tokens: null, by: null } });
  });

  it('fills auto from the node model and keeps a person\'s numbers', () => {
    const { db, connection } = setup();
    const auto = resolveBudgets(db, definitionWith(presetConfig('translate', { connectionId: connection.id, model: 'm' })));
    expect((auto.nodes[1] as AiNode).config).toMatchObject({ batch: { maxTokens: 19_500 }, context: { maxTokens: 60_000 } });
    const fixed = resolveBudgets(db, definitionWith({ ...presetConfig('translate', { connectionId: connection.id, model: 'm' }), batch: { mode: 'group', size: 60, maxTokens: 9_000 } }));
    expect((fixed.nodes[1] as AiNode).config.batch).toMatchObject({ maxTokens: 9_000 });
  });

});

describe('sizing by output kind', () => {
  const big = { contextWindow: 1_000_000, maxOutput: 65_536 };

  it('keeps a margin per output kind', () => {
    // maxOutput × margin / ratio: text 0.75 / 2.5, json 0.8 / 0.5, verdict and choice 0.9 / 0.3.
    expect(autoBudgets(big, 'text', 'group').lines).toBe(19_500);
    expect(autoBudgets(big, 'json', 'group').lines).toBe(104_500);
    expect(autoBudgets(big, 'verdict', 'group').lines).toBe(196_500);
    expect(autoBudgets(big, 'choice', 'group').lines).toBe(196_500);
  });

  it('leaves a number set on the node as it is', () => {
    const { db, connection } = (() => {
      const db = openDatabase(':memory:');
      return { db, connection: db.insert(s.connections).values({ kind: 'openai', name: 'c', baseUrl: 'http://x/v1', modelLimits: { m: { ...big, by: 'api' } } }).returning().get() };
    })();
    const definition = workflowDefinitionSchema.parse({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, config: { ...presetConfig('translate', { connectionId: connection.id, model: 'm' }), batch: { mode: 'group', size: 60, maxTokens: 9_000 } } }], edges: [] });
    expect((resolveBudgets(db, definition).nodes[1] as AiNode).config.batch.maxTokens).toBe(9_000);
  });
});
