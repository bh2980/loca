import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { autoBudgets, DEFAULT_BUDGETS, importFileSchema, presetConfig, workflowDefinitionSchema, type AiNode } from '@tw/shared';
import { limitsOf } from '@tw/ai';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { resolveBudgets } from './budgets.ts';
import { autoBudgetDefaults } from './workflow-migrations.ts';

describe('auto budgets', () => {
  it('keep the defaults when the limits are unknown', () => {
    expect(autoBudgets(undefined, 'text', 'group')).toEqual({ lines: DEFAULT_BUDGETS.lines, context: DEFAULT_BUDGETS.context });
    expect(autoBudgets({}, 'json', 'whole').lines).toBe(DEFAULT_BUDGETS.whole);
  });

  it('size a translation by the output limit and an extraction by the window', () => {
    const big = { contextWindow: 1_000_000, maxOutput: 65_536 };
    expect(autoBudgets(big, 'text', 'group')).toEqual({ lines: 23_500, context: 60_000 });
    expect(autoBudgets(big, 'json', 'whole').lines).toBe(117_500);
    expect(autoBudgets({ contextWindow: 32_000 }, 'text', 'group')).toEqual({ lines: 7_000, context: 4_000 });
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

  it('fills auto from the node model and keeps a person\'s numbers', () => {
    const { db, connection } = setup();
    const auto = resolveBudgets(db, definitionWith(presetConfig('translate', { connectionId: connection.id, model: 'm' })));
    expect((auto.nodes[1] as AiNode).config).toMatchObject({ batch: { maxTokens: 23_500 }, context: { maxTokens: 60_000 } });
    const fixed = resolveBudgets(db, definitionWith({ ...presetConfig('translate', { connectionId: connection.id, model: 'm' }), batch: { mode: 'group', size: 60, maxTokens: 9_000 } }));
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
