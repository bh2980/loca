import { describe, expect, it } from 'vitest';
import { callTrail, expandCalls, runNodeName, type CallableWorkflow } from './workflow-calls.ts';
import { callSummary, nodePorts, validateWorkflow, workflowDefinitionSchema, workflowRefOf, type WorkflowDefinition, type WorkflowRefs } from './workflow.ts';

const at = { x: 0, y: 0 };
/** A condition node: ports true / false. */
const cond = (id: string, label?: string) => ({ id, type: 'condition', position: at, label, config: { expression: true } });
/** A function node: ports out / error. */
const act = (id: string, label?: string) => ({ id, type: 'function', position: at, label, config: { fn: 'setStatus', params: {} } });
const call = (id: string, workflowId: string) => ({ id, type: 'call', position: at, config: { workflowId } });
const entry = (input: 'lines' | 'terms' = 'lines') => ({ id: 'entry', type: 'entry', position: at, config: { input } });
const end = (id = 'end') => ({ id, type: 'end', position: at, config: {} });
/** Edges as "from.port -> to" ("out" when no port). */
function flow(nodes: object[], edges: string[], input: 'lines' | 'terms' = 'lines') {
  return workflowDefinitionSchema.parse({
    nodes: [entry(input), ...nodes],
    edges: edges.map((text, index) => {
      const [from, to] = text.split(' -> ');
      const [source, sourceHandle = 'out'] = from!.split('.');
      return { id: `e${index}`, source: source!, sourceHandle, target: to! };
    }),
  });
}
const edgesOf = (definition: WorkflowDefinition) => definition.edges.map((edge) => `${edge.source}.${edge.sourceHandle} -> ${edge.target}`).sort();
const library = (workflows: Record<string, { name?: string; definition: WorkflowDefinition }>) => (id: string): CallableWorkflow | undefined => (workflows[id] ? { name: workflows[id]!.name ?? id, definition: workflows[id]!.definition } : undefined);

describe('expandCalls', () => {
  it('returns a definition without calls as it is', () => {
    const definition = flow([act('a')], ['entry -> a']);
    expect(expandCalls(definition, library({}))).toBe(definition);
  });

  it('puts the called workflow in the call\'s place: edges in go to its first nodes, its unconnected exits go to the call\'s targets', () => {
    const w = flow([act('w1', '추출'), act('w2')], ['entry -> w1', 'w1 -> w2']);
    const outer = flow([act('a'), call('c', 'W'), act('z'), act('f')], ['entry -> a', 'a -> c', 'c -> z', 'c.error -> f']);
    const expanded = expandCalls(outer, library({ W: { name: '용어 추출', definition: w } }));
    expect(expanded.nodes.map((node) => node.id).sort()).toEqual(['a', 'c/w1', 'c/w2', 'entry', 'f', 'z']);
    expect(expanded.nodes.some((node) => node.type === 'call' || (node.type === 'entry' && node.id !== 'entry'))).toBe(false);
    expect(edgesOf(expanded)).toEqual(
      [
        'entry.out -> a',
        'a.out -> c/w1',
        'c/w1.out -> c/w2',
        // w2's unconnected exits: normal → the call's 완료, error → the call's 오류.
        'c/w2.out -> z',
        'c/w2.error -> f',
        // w1's unconnected error exit → the call's 오류.
        'c/w1.error -> f',
      ].sort(),
    );
    expect(expanded.nodes.find((node) => node.id === 'c/w1')?.label).toBe('추출');
  });

  it('turns edges into W\'s end nodes into the call\'s 완료 targets and keeps W\'s connected exits', () => {
    const w = flow([act('w1'), act('w2'), end()], ['entry -> w1', 'w1 -> w2', 'w1.error -> w2', 'w2 -> end', 'w2.error -> end']);
    const outer = flow([call('c', 'W'), act('z'), act('f')], ['entry -> c', 'c -> z', 'c.error -> f']);
    const expanded = expandCalls(outer, library({ W: { definition: w } }));
    expect(expanded.nodes.some((node) => node.type === 'end')).toBe(false);
    expect(edgesOf(expanded)).toEqual(['c/w1.error -> c/w2', 'c/w1.out -> c/w2', 'c/w2.error -> z', 'c/w2.out -> z', 'entry.out -> c/w1'].sort());
  });

  it('leaves inner exits unconnected where the call\'s exit is unconnected (the line ends as it would after the call)', () => {
    const w = flow([act('w1'), cond('w2')], ['entry -> w1', 'w1 -> w2', 'w2.true -> w1']);
    const noOut = flow([call('c', 'W'), act('f')], ['entry -> c', 'c.error -> f']);
    expect(edgesOf(expandCalls(noOut, library({ W: { definition: w } })))).toEqual(['c/w1.error -> f', 'c/w1.out -> c/w2', 'c/w2.true -> c/w1', 'entry.out -> c/w1'].sort());
    const noError = flow([call('c', 'W'), act('z')], ['entry -> c', 'c -> z']);
    // w1.error stays unconnected: the line ends failed with its kind, as it did inside W; w2.false (unconnected, normal) goes on.
    expect(edgesOf(expandCalls(noError, library({ W: { definition: w } })))).toEqual(['c/w1.out -> c/w2', 'c/w2.false -> z', 'c/w2.true -> c/w1', 'entry.out -> c/w1'].sort());
  });

  it('sends each line to every first node of W, from every edge into the call', () => {
    const w = flow([act('p'), act('q')], ['entry -> p', 'entry -> q']);
    const outer = flow([act('a'), cond('b'), call('c', 'W')], ['entry -> a', 'entry -> b', 'a -> c', 'b.true -> c', 'b.false -> c']);
    const expanded = expandCalls(outer, library({ W: { definition: w } }));
    expect(edgesOf(expanded).filter((edge) => edge.includes('-> c/'))).toEqual(['a.out -> c/p', 'a.out -> c/q', 'b.false -> c/p', 'b.false -> c/q', 'b.true -> c/p', 'b.true -> c/q']);
  });

  it('goes straight on out of a call whose workflow does nothing', () => {
    const w = flow([end()], ['entry -> end']);
    const outer = flow([act('a'), call('c', 'W'), act('z')], ['entry -> a', 'a -> c', 'c -> z']);
    expect(edgesOf(expandCalls(outer, library({ W: { definition: w } })))).toEqual(['a.out -> z', 'entry.out -> a']);
  });

  it('expands calls inside called workflows, prefixing each level, and names every call', () => {
    const inner = flow([act('n', '용어 저장')], ['entry -> n']);
    const middle = flow([act('m'), call('c2', 'INNER')], ['entry -> m', 'm -> c2']);
    const outer = flow([call('c1', 'MIDDLE'), act('z'), act('f')], ['entry -> c1', 'c1 -> z', 'c1.error -> f']);
    const expanded = expandCalls(outer, library({ MIDDLE: { name: '가운데', definition: middle }, INNER: { name: '안쪽', definition: inner } }));
    expect(expanded.nodes.map((node) => node.id).sort()).toEqual(['c1/c2/n', 'c1/m', 'entry', 'f', 'z']);
    expect(edgesOf(expanded)).toEqual(['c1/c2/n.error -> f', 'c1/c2/n.out -> z', 'c1/m.error -> f', 'c1/m.out -> c1/c2/n', 'entry.out -> c1/m'].sort());
    expect(expanded.calls).toEqual({ c1: { name: '가운데', workflowId: 'MIDDLE' }, 'c1/c2': { name: '안쪽', workflowId: 'INNER' } });
    const node = expanded.nodes.find((candidate) => candidate.id === 'c1/c2/n')!;
    expect(callTrail(expanded, 'c1/c2/n')).toEqual(['가운데', '안쪽']);
    expect(runNodeName(expanded, node)).toBe('가운데 › 안쪽 › 용어 저장');
    expect(runNodeName(expanded, expanded.nodes.find((candidate) => candidate.id === 'z')!)).toBe('상태 변경');
  });

  it('expands two calls of the same workflow into separate copies, and a call that leads back to itself', () => {
    const w = flow([act('w')], ['entry -> w']);
    const outer = flow([call('c1', 'W'), call('c2', 'W'), act('z')], ['entry -> c1', 'c1 -> c2', 'c2 -> z']);
    const expanded = expandCalls(outer, library({ W: { name: 'W', definition: w } }));
    expect(edgesOf(expanded)).toEqual(['c1/w.out -> c2/w', 'c2/w.out -> z', 'entry.out -> c1/w']);
    expect(Object.keys(expanded.calls!).sort()).toEqual(['c1', 'c2']);
    const loop = flow([call('c', 'W'), cond('again')], ['entry -> c', 'c -> again', 'again.true -> c']);
    expect(edgesOf(expandCalls(loop, library({ W: { definition: w } })))).toEqual(['again.true -> c/w', 'c/w.out -> again', 'entry.out -> c/w']);
  });

  it('ignores the called workflow\'s entry config and settings', () => {
    const w = workflowDefinitionSchema.parse({ ...flow([act('w')], ['entry -> w']), settings: { maxVisitsPerNode: 1, maxConsecutiveFailures: 1 } });
    const outer = flow([call('c', 'W')], ['entry -> c']);
    const expanded = expandCalls(outer, library({ W: { definition: w } }));
    expect(expanded.settings).toEqual(outer.settings);
    expect(expanded.nodes.filter((node) => node.type === 'entry')).toHaveLength(1);
  });

  it('refuses an unpicked, missing, wrong-input or cyclic call with the validation messages', () => {
    const w = flow([act('w')], ['entry -> w']);
    const terms = flow([act('w')], ['entry -> w'], 'terms');
    const run = (outer: WorkflowDefinition, workflows: Parameters<typeof library>[0], workflowId?: string) => () => expandCalls(outer, library(workflows), { workflowId });
    expect(run(flow([call('c', '')], ['entry -> c']), {})).toThrow('부를 워크플로를 고르세요.');
    expect(run(flow([call('c', 'X')], ['entry -> c']), {})).toThrow('부르는 워크플로가 없습니다.');
    expect(run(flow([call('c', 'T')], ['entry -> c']), { T: { name: '용어 번역', definition: terms } })).toThrow("'용어 번역'은(는) 용어를 받는 워크플로라 여기서 부를 수 없습니다.");
    const self = flow([call('c', 'ME')], ['entry -> c']);
    expect(run(self, { ME: { name: '나', definition: self } }, 'ME')).toThrow("'나'을(를) 부르면 다시 이 워크플로로 돌아옵니다.");
    // A calls B calls A (the root is not part of the cycle).
    const a = flow([call('c', 'B')], ['entry -> c']);
    const b = flow([call('c', 'A')], ['entry -> c']);
    expect(run(flow([call('c', 'A')], ['entry -> c']), { A: { name: 'A', definition: a }, B: { name: 'B', definition: b } })).toThrow("'A'을(를) 부르면 다시 이 워크플로로 돌아옵니다.");
    // A missing workflow inside a called one is found too.
    expect(run(flow([call('c', 'A')], ['entry -> c']), { A: { name: 'A', definition: a } })).toThrow('부르는 워크플로가 없습니다.');
    expect(w).toBeTruthy();
  });
});

describe('call node', () => {
  const node = workflowDefinitionSchema.parse(flow([call('c', 'W')], ['entry -> c'])).nodes.find((candidate) => candidate.id === 'c')!;
  it('has 완료 and 오류 exits and summarizes as the called workflow\'s name', () => {
    expect(nodePorts(node)).toEqual([{ id: 'out', label: '완료' }, { id: 'error', label: '오류' }]);
    expect(callSummary({ workflowId: 'W' }, [{ id: 'W', name: '용어 추출' }])).toBe('용어 추출');
    expect(callSummary({ workflowId: 'W' }, [])).toBe('워크플로를 고르세요');
    expect(callSummary({ workflowId: '' }, [{ id: 'W', name: '용어 추출' }])).toBe('워크플로를 고르세요');
  });
});

describe('call validation', () => {
  const lines = flow([act('w')], ['entry -> w']);
  const terms = flow([act('w')], ['entry -> w'], 'terms');
  const refsFor = (workflows: { id: string; name: string; definition: WorkflowDefinition }[], workflowId?: string): WorkflowRefs => ({
    workflows: workflows.map(workflowRefOf),
    workflowId,
    connections: new Map(),
    statusIds: new Set(),
    tagIds: new Set(),
    toolConnectionIds: new Set(),
  });
  const messages = (definition: WorkflowDefinition, refs: WorkflowRefs) => validateWorkflow(definition, refs).filter((issue) => issue.nodeId === 'c').map((issue) => issue.message);
  const outer = (workflowId: string) => flow([call('c', workflowId), act('z')], ['entry -> c', 'c -> z']);

  it('asks for a workflow, and reports a missing one, a different input and a cycle', () => {
    expect(messages(outer(''), refsFor([]))).toEqual(['부를 워크플로를 고르세요.']);
    expect(messages(outer('X'), refsFor([]))).toEqual(['부르는 워크플로가 없습니다.']);
    expect(messages(outer('T'), refsFor([{ id: 'T', name: '용어 번역', definition: terms }]))).toEqual(["'용어 번역'은(는) 용어를 받는 워크플로라 여기서 부를 수 없습니다."]);
    expect(messages(outer('L'), refsFor([{ id: 'L', name: '번역', definition: lines }]))).toEqual([]);
    expect(messages(flow([call('c', 'L'), act('z')], ['entry -> c', 'c -> z'], 'terms'), refsFor([{ id: 'L', name: '번역', definition: lines }]))).toEqual(["'번역'은(는) 대사를 받는 워크플로라 여기서 부를 수 없습니다."]);
  });

  it('finds a call that leads back, itself or at any depth', () => {
    const self = refsFor([{ id: 'ME', name: '나', definition: outer('ME') }], 'ME');
    expect(messages(outer('ME'), self)).toEqual(["'나'을(를) 부르면 다시 이 워크플로로 돌아옵니다."]);
    const b = flow([call('c', 'C'), act('z')], ['entry -> c', 'c -> z']);
    const c = flow([call('c', 'ME'), act('z')], ['entry -> c', 'c -> z']);
    const deep = refsFor([{ id: 'B', name: 'B', definition: b }, { id: 'C', name: 'C', definition: c }, { id: 'ME', name: '나', definition: outer('B') }], 'ME');
    expect(messages(outer('B'), deep)).toEqual(["'B'을(를) 부르면 다시 이 워크플로로 돌아옵니다."]);
    // Not a cycle: B only calls C, which calls nobody.
    const fine = refsFor([{ id: 'B', name: 'B', definition: b }, { id: 'C', name: 'C', definition: lines }], 'ME');
    expect(messages(outer('B'), fine)).toEqual([]);
  });

  it('leaves 완료 and 오류 open like any node\'s, and a loop through a call is fine when something in it branches', () => {
    const definition = flow([call('c', 'L'), cond('again')], ['entry -> c', 'c -> again', 'again.true -> c']);
    const issues = validateWorkflow(definition, refsFor([{ id: 'L', name: 'L', definition: lines }])).filter((issue) => issue.level === 'error');
    expect(issues).toEqual([]);
    expect(validateWorkflow(flow([call('c', 'L')], ['entry -> c']), refsFor([{ id: 'L', name: 'L', definition: lines }]))).toEqual([]);
  });
});
