import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_CHOICE, translationTemplate, workflowNodeSchema, type WorkflowDefinition } from '@tw/shared';
import { exitEdges, flowEdges, flowNames, flowNodeCard, nodeSummary, openPorts, type SummaryNames } from './flow-graph';

const names: SummaryNames = { status: new Map(), connection: new Map([['key-1', '맞춤법 API 키']]), connectionsLoaded: true };
const definition = { nodes: [], edges: [] } as unknown as WorkflowDefinition;
// A node as the editor holds it: read through the schema, so its settings are its function's own, defaults filled.
const fn = (name: string, params: Record<string, unknown>) => workflowNodeSchema.parse({ id: 'n1', type: 'function', config: { fn: name, params }, position: { x: 0, y: 0 } });
const summary = (name: string, params: Record<string, unknown>) => nodeSummary(fn(name, params), definition, names);

describe('nodeSummary: HTTP 호출', () => {
  it('says the method and the address the node calls', () => {
    expect(summary('http', { method: 'GET', url: 'https://api.example.com/spell' })).toBe('GET api.example.com/spell');
  });

  it('does not ask for a connection: the API key is optional', () => {
    expect(summary('http', { url: 'https://api.example.com/spell' })).not.toContain('연결');
    expect(summary('http', { url: 'https://api.example.com/spell', connectionId: 'key-1' })).toBe('POST api.example.com/spell');
  });

  it("reads the schema's default method and says when no address is set", () => {
    expect(summary('http', {})).toBe('POST 주소 없음');
  });

  it('leaves the query out with a mark, and cuts a long address', () => {
    expect(summary('http', { method: 'GET', url: 'https://api.example.com/spell?lang=ko&text={{candidate}}' })).toBe('GET api.example.com/spell?…');
    const long = summary('http', { url: `https://api.example.com/${'a'.repeat(80)}` });
    expect(long.length).toBe('POST '.length + 48);
    expect(long.endsWith('…')).toBe(true);
  });

  it('never meets settings that do not fit the schema: such a node is not a node', () => {
    expect(() => fn('http', { method: 'DELETE', url: 'https://api.example.com' })).toThrow();
  });
});

describe('nodeSummary: 스크립트', () => {
  it('lists the declared exits, "out" when none is declared', () => {
    expect(summary('script', { ports: ['ok', 'retry'] })).toBe('출구: ok, retry');
    expect(summary('script', {})).toBe('출구: out');
  });
});

describe('nodeSummary: 형식 검사', () => {
  it("reads the checks that are on by the schema's defaults", () => {
    expect(summary('formatCheck', {})).toBe('검사: 자리표시자·서식 태그·줄바꿈·빈 번역');
    expect(summary('formatCheck', { placeholders: false, tags: false, numbers: true })).toBe('검사: 줄바꿈·빈 번역·숫자');
  });

  it('counts length limits and forbidden words as checks: a node with only those does not always pass', () => {
    const off = { placeholders: false, tags: false, newlines: false, emptyText: false };
    expect(summary('formatCheck', off)).toBe('켠 검사 항목 없음 (항상 통과)');
    expect(summary('formatCheck', { ...off, maxChars: 40 })).toBe('검사: 길이');
    expect(summary('formatCheck', { ...off, forbiddenWords: '암튼, 대충' })).toBe('검사: 금지어');
    expect(summary('formatCheck', { ...off, forbiddenWords: ' , ' })).toBe('켠 검사 항목 없음 (항상 통과)');
  });

  it('counts a custom rule that is still being typed without losing the other checks', () => {
    expect(summary('formatCheck', { customRules: [{ id: 'r1', name: '', pattern: '' }] })).toBe('검사: 자리표시자·서식 태그·줄바꿈·빈 번역·규칙 1개');
  });
});

describe('what the editor and a run graph both draw', () => {
  const template = translationTemplate({ model: EMPTY_MODEL_CHOICE, untranslated: 'u', translated: 't', needsReview: 'needs-review', confirmed: 'c', issueTags: { format: 'format-tag', term: 'term-tag', speech: 'speech-tag', meaning: 'meaning-tag', style: 'style-tag', other: 'other-tag', aiFailed: 'ai-failed' } });
  const graphNames = flowNames({ statuses: [{ id: 't', name: '번역됨', color: 'teal' }], tags: [{ id: 'format-tag', name: '형식 오류', color: 'red' }], connections: [] });

  it('names statuses, tags and connections by id', () => {
    expect(graphNames.summary.status.get('t')).toBe('번역됨');
    expect(graphNames.marks.tags?.get('format-tag')?.name).toBe('형식 오류');
    expect(graphNames.summary.connectionsLoaded).toBe(true);
    expect(flowNames({}).summary.connectionsLoaded).toBe(false);
  });

  it('a card lists the exits no line leaves, each with its marks', () => {
    for (const node of template.nodes.filter((item) => item.type !== 'entry')) {
      const card = flowNodeCard(node, template, 'vertical', graphNames);
      expect(card.open).toEqual(openPorts(node, template));
      expect(Object.keys(card.exitMarks)).toEqual(card.open);
      expect(card.summary).toBe(nodeSummary(node, template, graphNames.summary));
    }
  });

  it('draws an exit\'s actions once, on its first line', () => {
    const edges = exitEdges(template, template, graphNames.marks);
    expect(edges.map((item) => item.edge.id)).toEqual(flowEdges(template).map((edge) => edge.id));
    const marked = edges.filter((item) => item.items.length);
    expect(marked.length).toBeGreaterThan(0);
    // No exit is marked on two of its lines.
    expect(new Set(marked.map((item) => item.key)).size).toBe(marked.length);
    for (const item of marked) expect(edges.find((other) => other.key === item.key)).toBe(item);
  });

  it('marks the selected and hovered lines as flowEdges does', () => {
    const [firstEdge] = flowEdges(template);
    const edges = exitEdges(template, template, graphNames.marks, { selected: firstEdge!.id });
    expect(edges[0]!.edge.selected).toBe(true);
  });
});
