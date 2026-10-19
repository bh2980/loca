import { describe, expect, it } from 'vitest';
import { analysisTemplate, listenerTemplate, workflowDefinitionSchema, type WorkflowDefinition } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { isLegacyDefinition, replaceLegacyBuiltins } from './workflow-migrations.ts';

const model = { connectionId: 'c', model: 'm' };
/** A work analysis as it was saved before the general AI outputs: one AI node with an "analysis" output and sections. */
const oldAnalysis = () =>
  ({
    settings: { maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 },
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } },
      { id: 'analyze', type: 'ai', position: { x: 0, y: 120 }, label: '대본 읽기', config: { model, extraModels: [], instructions: '', output: 'analysis', fields: [], sections: ['characters'] } },
    ],
    edges: [{ id: 'e1', source: 'entry', sourceHandle: 'out', target: 'analyze' }],
  }) as unknown as WorkflowDefinition;

describe('replacing the old built-in workflows', () => {
  it('replaces a built-in of the old shape (keeping its model), leaves other workflows alone, and runs once', () => {
    const db = openDatabase(':memory:');
    const projectId = crypto.randomUUID();
    db.insert(s.projects).values({ id: projectId, name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).run();
    db.insert(s.workflows).values({ projectId, name: '작품 분석', definition: oldAnalysis() }).run();
    db.insert(s.workflows).values({ projectId, name: '내 분석', definition: oldAnalysis() }).run();
    const current = analysisTemplate({ model });
    db.insert(s.workflows).values({ projectId, name: '용어 추출', definition: current }).run();

    expect(replaceLegacyBuiltins(db)).toBe(1);
    const rows = new Map(db.select().from(s.workflows).all().map((row) => [row.name, row]));
    expect(workflowDefinitionSchema.parse(rows.get('작품 분석')!.definition).nodes.map((node) => node.id)).toContain('save-characters');
    expect(rows.get('작품 분석')!.definition.nodes.find((node) => node.type === 'ai')).toMatchObject({ config: { model, output: 'json' } });
    expect(rows.get('작품 분석')!.version).toBe(2);
    expect(isLegacyDefinition(rows.get('내 분석')!.definition)).toBe(true);
    expect(rows.get('용어 추출')!.definition).toEqual(current);
    expect(replaceLegacyBuiltins(db)).toBe(0);
  });
  it('replaces a 청자 추정 that reads listenerKnown or answers as a choice with the current template', () => {
    const db = openDatabase(':memory:');
    const projectId = crypto.randomUUID();
    db.insert(s.projects).values({ id: projectId, name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).run();
    const current = listenerTemplate({ model });
    const old = structuredClone(current);
    const needs = old.nodes.find((node) => node.id === 'needs')!;
    if (needs.type === 'condition') needs.config.expression = { var: 'listenerKnown' };
    db.insert(s.workflows).values({ projectId, name: '청자 추정', definition: old }).run();
    expect(isLegacyDefinition(old)).toBe(true);
    expect(isLegacyDefinition(current)).toBe(false);
    expect(replaceLegacyBuiltins(db)).toBe(1);
    expect(db.select().from(s.workflows).get()!.definition).toEqual(current);
  });
});
