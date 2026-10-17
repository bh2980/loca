import { describe, expect, it } from 'vitest';
import { translationTemplate, workflowDefinitionSchema, type WorkflowDefinition } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { migrateApplyCandidate, stripApplyCandidate } from './workflow-migrations.ts';

/** The default templates as they were before #42: confirm applied the candidate, speechFix had an apply node. */
function oldDefinitions(): { translation: WorkflowDefinition; speech: WorkflowDefinition } {
  const ids = { model: { connectionId: '', model: '' }, untranslated: 's-un', draft: 's-draft', needsReview: 's-nr', confirmed: 's-conf' };
  const translation = translationTemplate(ids);
  // The old confirm node applied the candidate; the current one no longer has the parameter.
  const withOldConfirm = {
    ...translation,
    nodes: translation.nodes.map((node) => (node.id === 'confirm' ? { ...node, label: '확정', config: { fn: 'setStatus', params: { statusId: ids.confirmed, addTagIds: [], removeTagIds: [], applyCandidate: true } } } : node)),
  } as WorkflowDefinition;
  const speech = workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } },
      { id: 'fit', type: 'ai', position: { x: 300, y: 0 }, config: { model: ids.model, output: 'candidate', instructions: 'x' } },
      { id: 'apply', type: 'function', position: { x: 600, y: 0 }, label: '번역에 적용', config: { fn: 'setStatus', params: { applyCandidate: true } } },
      { id: 'end', type: 'end', position: { x: 900, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'entry', sourceHandle: 'out', target: 'fit' },
      { id: 'e2', source: 'fit', sourceHandle: 'out', target: 'apply' },
      { id: 'e3', source: 'apply', sourceHandle: 'out', target: 'end' },
    ],
  });
  return { translation: withOldConfirm, speech };
}

describe('workflow migration for #42', () => {
  it('drops applyCandidate, relabels confirm, removes the no-op apply node, and stays idempotent', () => {
    const { translation, speech } = oldDefinitions();
    const db = openDatabase(':memory:');
    const projectId = crypto.randomUUID();
    db.insert(s.projects).values({ id: projectId, name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).run();
    db.insert(s.workflows).values({ projectId, name: '기본 번역', definition: translation }).run();
    db.insert(s.workflows).values({ projectId, name: '말투만 고치기', definition: speech }).run();

    expect(migrateApplyCandidate(db)).toBe(2);
    const rows = new Map(db.select().from(s.workflows).all().map((row) => [row.name, row]));

    const basic = rows.get('기본 번역')!.definition;
    const confirm = basic.nodes.find((node) => node.id === 'confirm')!;
    expect(confirm.label).toBe('확정으로');
    expect(confirm.type).toBe('function');
    expect('applyCandidate' in (confirm as { config: { params: Record<string, unknown> } }).config.params).toBe(false);
    expect((confirm as { config: { params: { statusId?: string } } }).config.params.statusId).toBe('s-conf');

    const fixed = rows.get('말투만 고치기')!.definition;
    expect(fixed.nodes.some((node) => node.id === 'apply')).toBe(false);
    expect(fixed.edges.some((edge) => edge.source === 'fit' && edge.sourceHandle === 'out' && edge.target === 'end')).toBe(true);
    // Every remaining edge still points at a node that exists.
    const ids = new Set(fixed.nodes.map((node) => node.id));
    expect(fixed.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);

    // A second run changes nothing.
    expect(migrateApplyCandidate(db)).toBe(0);
  });

  it('returns null when a definition already satisfies #42', () => {
    const definition = translationTemplate({ model: { connectionId: '', model: '' }, untranslated: 'a', draft: 'b', needsReview: 'c', confirmed: 'd' });
    expect(stripApplyCandidate(definition)).toBeNull();
  });

  it('keeps an empty status node that never applied a candidate (it is the person\'s own)', () => {
    const { speech } = oldDefinitions();
    const own = { ...speech, nodes: speech.nodes.map((node) => (node.id === 'apply' ? { ...node, label: '자리', config: { fn: 'setStatus', params: { addTagIds: [], removeTagIds: [], applyCandidate: false } } } : node)) } as WorkflowDefinition;
    const next = stripApplyCandidate(own)!;
    expect(next.nodes.map((node) => node.id)).toEqual(['entry', 'fit', 'apply', 'end']);
    expect(next.edges).toEqual(own.edges);
    expect(stripApplyCandidate(next)).toBeNull();
  });
});
