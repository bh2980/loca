import { describe, expect, it } from 'vitest';
import { checkFormat } from './format-check.ts';
import { importFileSchema, importWarnings } from './import-format.ts';
import { politenessOf, speechLevelOf } from './knowledge.ts';
import { termExtractionTemplate, translationTemplate } from './defaults.ts';
import { nodePorts, validateWorkflow, workflowDefinitionSchema, workflowNodeSchema, type WorkflowDefinition } from './workflow.ts';

const ids = { profileId: 'p', untranslated: 's0', draft: 's1', needsReview: 's2', confirmed: 's3' };
const refs = { profileIds: new Set(['p']), statusIds: new Set(['s0', 's1', 's2', 's3']), tagIds: new Set<string>(), toolConnectionIds: new Set<string>() };

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

  it('lets an exit send lines down several branches that end apart, with one changing the line', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const node = (id: string, config: Record<string, unknown>, type = 'function') => workflowNodeSchema.parse({ id, type, position: { x: 0, y: 0 }, config });
    const side = [node('terms', { output: 'terms', profileId: 'p' }, 'ai'), node('add', { fn: 'addTerms', params: { fromNodeId: 'terms' } }), node('end-terms', {}, 'end')];
    const sideEdges = [
      { id: 's1', source: 'review', sourceHandle: 'pass', target: 'terms' },
      { id: 's2', source: 'terms', sourceHandle: 'out', target: 'add' },
      { id: 's3', source: 'add', sourceHandle: 'out', target: 'end-terms' },
    ];
    const ok: WorkflowDefinition = { ...template, nodes: [...template.nodes, ...side], edges: [...template.edges, ...sideEdges] };
    expect(validateWorkflow(ok, refs).filter((issue) => issue.level === 'error')).toEqual([]);
    // Sharing the main branch's end node is fine: each copy just ends there.
    const sharedEnd: WorkflowDefinition = { ...ok, edges: ok.edges.map((edge) => (edge.id === 's3' ? { ...edge, target: 'end' } : edge)) };
    expect(validateWorkflow(sharedEnd, refs).filter((issue) => issue.level === 'error')).toEqual([]);
    // Or no end at all: an unconnected "다음" just ends the copy there.
    const open: WorkflowDefinition = { ...ok, edges: ok.edges.filter((edge) => edge.id !== 's3') };
    const issues = validateWorkflow(open, refs);
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
    expect(issues).toContainEqual(expect.objectContaining({ level: 'warning', nodeId: 'add', message: expect.stringContaining('여기서 끝납니다') }));
    // Meeting at a node that does work: the line would be handled twice.
    const rejoined: WorkflowDefinition = { ...ok, edges: ok.edges.map((edge) => (edge.id === 's3' ? { ...edge, target: 'confirm' } : edge)) };
    expect(validateWorkflow(rejoined, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'review', message: expect.stringContaining('다시 만납니다') }));
    // Both branches setting the status.
    const twice: WorkflowDefinition = { ...ok, nodes: ok.nodes.map((n) => (n.id === 'add' ? node('add', { fn: 'setStatus', params: { statusId: 's1' } }) : n)) };
    expect(validateWorkflow(twice, refs)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('상태를 바꿉니다') }));
  });

  it('reads a workflow saved before profiles could be shared', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const old = JSON.parse(JSON.stringify(template), (key, value) => (key === 'extraProfileIds' ? undefined : value)) as WorkflowDefinition;
    expect(validateWorkflow(old, refs).filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('flags a deleted profile among the ones sharing a node', () => {
    const template = workflowDefinitionSchema.parse(translationTemplate(ids));
    const shared: WorkflowDefinition = { ...template, nodes: template.nodes.map((n) => (n.type === 'ai' && n.id === 'review' ? { ...n, config: { ...n.config, extraProfileIds: ['gone'] } } : n)) };
    expect(validateWorkflow(shared, refs)).toContainEqual(expect.objectContaining({ level: 'error', nodeId: 'review', message: expect.stringContaining('함께 나눌') }));
  });

  it('warns about a loop that nothing can leave', () => {
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'a', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'setStatus' } },
        { id: 'b', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'setStatus' } },
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

describe('node exits', () => {
  it('derive from config', () => {
    const verdict = workflowNodeSchema.parse({ id: 'a', type: 'ai', position: { x: 0, y: 0 }, config: { output: 'verdict' } });
    expect(nodePorts(verdict).map((port) => port.id)).toEqual(['pass', 'fail', 'error']);
    const script = workflowNodeSchema.parse({ id: 's', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'script', params: { ports: ['keep', 'retry'] } } });
    expect(nodePorts(script).map((port) => port.id)).toEqual(['keep', 'retry', 'error']);
  });

  it('flags an http node without a connection and an unknown function', () => {
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'h', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'http' } },
        { id: 'x', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'nope' } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'h' },
        { id: '2', source: 'h', sourceHandle: 'out', target: 'x' },
      ],
    });
    const issues = validateWorkflow(definition, refs);
    expect(issues).toContainEqual(expect.objectContaining({ nodeId: 'h', message: expect.stringContaining('HTTP') }));
    expect(issues).toContainEqual(expect.objectContaining({ nodeId: 'x', message: expect.stringContaining('알 수 없는 함수') }));
  });
});

describe('import format', () => {
  const base = {
    format: 'loca/v1',
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

  it('only takes the current format name', () => {
    expect(importFileSchema.safeParse({ ...base, format: 'translation-workbench/v1' }).success).toBe(false);
  });

  it('checks the line keys that speech rules, relationship changes and events point to', () => {
    const result = importFileSchema.safeParse({
      ...base,
      characters: [{ name: 'A' }, { name: 'B', player: true }],
      relationships: [{ from: 'A', to: 'B', kind: 'friend', changes: [{ at: 'u9', change: 'falls out' }] }],
      speechRules: [{ from: 'A', to: 'B', level: 'haeyo' }, { from: 'A', to: 'B', level: 'hae', start: 'u9' }],
      events: [{ title: 'Fight', evidence: ['u1', 'u8'] }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toEqual(['relationships.0.changes.0.at', 'speechRules.1.start', 'events.0.evidence.1']);
  });

  it('warns about lines outside the graph, unknown speakers and empty source', () => {
    const file = importFileSchema.parse({
      ...base,
      units: [
        { key: 'u1', group: 'g1', speaker: 'Alice', source: 'Hi' },
        { key: 'u2', group: 'g1', speaker: 'Bob', source: ' ' },
      ],
      graph: { nodes: [{ key: 'n1', units: ['u1'] }], edges: [] },
      characters: [{ name: 'Alice' }],
    });
    expect(importWarnings(file).map((warning) => warning.examples)).toEqual([['u2'], ['Bob'], ['u2']]);
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

describe('templates', () => {
  it('term extraction template is valid and only adds candidates', () => {
    const definition = workflowDefinitionSchema.parse(termExtractionTemplate({ profileId: 'p' }));
    expect(validateWorkflow(definition, refs).filter((issue) => issue.level === 'error')).toEqual([]);
    expect(definition.nodes.map((node) => (node.type === 'function' ? node.config.fn : node.type))).toEqual(['entry', 'ai', 'addTerms', 'end']);
  });
});

describe('speech level guess', () => {
  it('reads the last sentence ending and ignores tags and trailing punctuation', () => {
    expect(speechLevelOf('알겠습니다.')).toBe('hasipsio');
    expect(speechLevelOf('<b>정말요?</b>')).toBe('haeyo');
    expect(speechLevelOf('그만해, {name}!')).toBe('hae');
    expect(speechLevelOf('어서 가거라.')).toBe('haera');
    expect(speechLevelOf('아냐')).toBe('hae');
    expect(speechLevelOf('자네도 왔는가?')).toBe('hage');
    expect(speechLevelOf('어서 오시오.')).toBe('hao');
    expect(speechLevelOf('OK')).toBeNull();
  });

  it.each([
    // [text, level]
    ['그렇죠?', 'haeyo'], ['이리 오시죠', 'haeyo'], ['누구시죠', 'haeyo'], ['그렇지요.', 'haeyo'],
    ['갑시다', 'hasipsio'], ['조사를 시작합시다', 'hasipsio'], ['앉읍시다.', 'hasipsio'], ['합니까?', 'hasipsio'],
    ['네.', null], ['예, 수사관님.', null], ['수사관님!', null], ['응', null], ['예', null],
    ['주소.', null], ['라디오', null], ['용의자.', null], ['아버지', null], ['한국어', null], ['그러니까', null],
    ['그랬던가?', 'hae'], ['뭐하는가?', 'hage'],
    ['안산다', 'haera'], ['저녁먹는다!', 'haera'], ['같이 가자.', 'haera'], ['가자', 'haera'],
    ['괜찮아', 'hae'], ['그래, 맞지', 'hae'],
  ] as const)('guesses %j as %s', (text, level) => {
    expect(speechLevelOf(text)).toBe(level);
  });

  it('maps levels to the polite/plain axis and null when unsure', () => {
    expect(politenessOf('알겠습니다.')).toBe('polite');
    expect(politenessOf('정말요?')).toBe('polite');
    expect(politenessOf('어서 오시오.')).toBe('polite');
    expect(politenessOf('알았어.')).toBe('plain');
    expect(politenessOf('안산다')).toBe('plain');
    expect(politenessOf('자네도 왔는가?')).toBe('plain');
    expect(politenessOf('네.')).toBeNull();
    expect(politenessOf('OK')).toBeNull();
  });
});
