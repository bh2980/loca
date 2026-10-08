import { describe, expect, it } from 'vitest';
import { checkFormat } from './format-check.ts';
import { importFileSchema } from './import-format.ts';
import { translationTemplate } from './defaults.ts';
import { validateWorkflow, workflowDefinitionSchema, type WorkflowDefinition } from './workflow.ts';

const ids = { profileId: 'p', untranslated: 's0', draft: 's1', needsReview: 's2', confirmed: 's3' };
const refs = { profileIds: new Set(['p']), statusIds: new Set(['s0', 's1', 's2', 's3']), tagIds: new Set<string>() };

describe('workflow validation', () => {
  it('accepts the default template', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    expect(validateWorkflow(template, refs).filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('reports a missing profile and an unconnected exit on the node', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const broken: WorkflowDefinition = { ...template, edges: template.edges.filter((edge) => edge.id !== 'e4') };
    const issues = validateWorkflow(broken, { ...refs, profileIds: new Set() });
    expect(issues).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'translate' }));
    expect(issues).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'check', message: expect.stringContaining('통과') }));
  });

  it('warns about a loop that nothing can leave', () => {
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'a', type: 'update', position: { x: 0, y: 0 }, config: {} },
        { id: 'b', type: 'update', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'a' },
        { id: '2', source: 'a', sourceHandle: 'out', target: 'b' },
        { id: '3', source: 'b', sourceHandle: 'out', target: 'a' },
      ],
    });
    expect(validateWorkflow(definition, refs)).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('순환') }));
  });
});

describe('import format', () => {
  const base = {
    format: 'translation-workbench/v1',
    project: { name: 'Demo' },
    groups: [{ key: 'g1', title: 'Scene 1' }],
    units: [{ key: 'u1', group: 'g1', source: 'Hello' }],
  };

  it('fills defaults', () => {
    const file = importFileSchema.parse(base);
    expect(file.units[0].kind).toBe('dialogue');
    expect(file.project.targetLanguage).toBe('ko');
  });

  it('rejects dangling references with a path', () => {
    const result = importFileSchema.safeParse({
      ...base,
      units: [{ key: 'u1', group: 'missing', source: 'x' }],
      graph: { nodes: [{ key: 'n1', units: ['u9'] }], edges: [{ from: 'n1', to: 'n2' }] },
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['units.0.group', 'graph.nodes.0.units', 'graph.edges.0.to']));
  });
});

describe('format check', () => {
  const all = { placeholders: true, tags: true, newlines: true, emptyText: true };
  it('passes when tokens are preserved in another order', () => {
    expect(checkFormat('<b>{name}</b> has %d items', '%d개를 가진 <b>{name}</b>', all)).toEqual([]);
  });
  it('flags missing placeholder, tag and newline', () => {
    const codes = checkFormat('Hi {name}\n<color=red>x</color>', '안녕', all).map((issue) => issue.code);
    expect(codes).toEqual(['placeholder', 'tag', 'newline']);
  });
  it('does not treat comparisons as tags', () => {
    expect(checkFormat('x < 3 and y > 2', 'x는 3 미만, y는 2 초과', { ...all, newlines: false })).toEqual([]);
  });
});
