import { describe, expect, it } from 'vitest';
import { expandCalls, workflowDefinitionSchema, type WorkflowDefinition } from '@tw/shared';
import { callMembers, callOf, collapseCalls, liveCounts, topCallIds } from './run-calls';

const at = { x: 40, y: 80 };
const act = (id: string, label?: string, position = { x: 0, y: 0 }) => ({ id, type: 'function', position, label, config: { fn: 'setStatus', params: {} } });
const call = (id: string, workflowId: string) => ({ id, type: 'call', position: at, config: { workflowId } });
const flow = (nodes: object[], edges: string[]) =>
  workflowDefinitionSchema.parse({
    nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { input: 'lines' } }, ...nodes],
    edges: edges.map((text, index) => {
      const [from, to] = text.split(' -> ');
      const [source, sourceHandle = 'out'] = from!.split('.');
      return { id: `e${index}`, source: source!, sourceHandle, target: to! };
    }),
  });
const edgesOf = (definition: WorkflowDefinition) => definition.edges.map((edge) => `${edge.source}.${edge.sourceHandle} -> ${edge.target}`).sort();

const inner = flow([act('w1', '추출'), act('w2', '정리')], ['entry -> w1', 'w1 -> w2']);
const outer = flow([act('a'), call('c', 'W'), act('z'), act('f')], ['entry -> a', 'a -> c', 'c -> z', 'c.error -> f']);
const library = { W: { name: '용어 추출', definition: inner } };
const run = expandCalls(outer, (id) => library[id as 'W']);

describe('collapseCalls', () => {
  it('folds a call\'s inner nodes into one call card at their position and rewires the lines', () => {
    expect(topCallIds(run)).toEqual(['c']);
    const folded = collapseCalls(run);
    expect(folded.nodes.map((node) => node.id).sort()).toEqual(['a', 'c', 'entry', 'f', 'z']);
    const card = folded.nodes.find((node) => node.id === 'c')!;
    expect(card).toMatchObject({ type: 'call', label: '용어 추출', position: at });
    // Into any inner node → the card; out of w1/w2's exits → the card's 완료 / 오류 (merged: w1.error and w2.error both go to f).
    expect(edgesOf(folded)).toEqual(['a.out -> c', 'c.error -> f', 'c.out -> z', 'entry.out -> a'].sort());
  });

  it('returns a definition without calls as it is, and drops lines among a call\'s own nodes', () => {
    const plain = flow([act('a')], ['entry -> a']);
    expect(collapseCalls(plain)).toBe(plain);
    expect(edgesOf(collapseCalls(run)).some((edge) => edge.includes('c/'))).toBe(false);
  });

  it('folds nested calls into the outermost one', () => {
    const middle = flow([call('x', 'W'), act('m')], ['entry -> x', 'x -> m']);
    const top = flow([call('c', 'M'), act('z')], ['entry -> c', 'c -> z']);
    const nested = expandCalls(top, (id) => ({ M: { name: '중간', definition: middle }, W: library.W }[id as 'M' | 'W']));
    expect(nested.nodes.map((node) => node.id).sort()).toEqual(['c/m', 'c/x/w1', 'c/x/w2', 'entry', 'z']);
    expect(topCallIds(nested)).toEqual(['c']);
    expect(callOf(nested, 'c/x/w2')).toBe('c');
    const folded = collapseCalls(nested);
    expect(folded.nodes.map((node) => node.id).sort()).toEqual(['c', 'entry', 'z']);
    expect(edgesOf(folded)).toEqual(['c.out -> z', 'entry.out -> c']);
  });

  it('keeps two calls apart and the lines between them', () => {
    const twice = flow([call('c1', 'W'), call('c2', 'W'), act('z')], ['entry -> c1', 'c1 -> c2', 'c2 -> z']);
    const folded = collapseCalls(expandCalls(twice, (id) => library[id as 'W']));
    expect(edgesOf(folded)).toEqual(['c1.out -> c2', 'c2.out -> z', 'entry.out -> c1']);
  });
});

describe('liveCounts', () => {
  const counts = {
    nodes: [
      { nodeId: 'a', state: 'queued', count: 2 },
      { nodeId: 'c/w1', state: 'running', count: 3 },
      { nodeId: 'c/w1', state: 'failed', count: 1 },
      { nodeId: 'c/w2', state: 'queued', count: 4 },
      { nodeId: 'c/w2', state: 'done', count: 9 },
    ],
    passed: { a: 7, 'c/w1': 5 },
    calls: { 'c/w1': 2 },
    callLimits: { 'c/w1': 4, 'c/w2': 1, a: 1 },
  };
  it('sums everything inside a call onto its card; passed stays per node', () => {
    const live = liveCounts(run, counts);
    expect(live.get('c')).toEqual({ queued: 4, running: 3, failed: 1, calls: 2, limit: 5 });
    expect(live.get('a')).toMatchObject({ queued: 2, passed: 7, limit: 1, calls: 0 });
    expect(live.get('c/w1')).toBeUndefined();
  });
});

describe('callMembers', () => {
  it('lists the nodes inside a call with their lines per state', () => {
    const members = callMembers(run, 'c', [{ nodeId: 'c/w1', state: 'done', count: 3 }, { nodeId: 'c/w1', state: 'failed', count: 1 }]);
    expect(members.map((member) => [member.name, member.depth, member.counts])).toEqual([['추출', 0, { done: 3, failed: 1 }], ['정리', 0, {}]]);
  });
  it('names nested nodes with their inner call', () => {
    const middle = flow([call('x', 'W')], ['entry -> x']);
    const nested = expandCalls(flow([call('c', 'M')], ['entry -> c']), (id) => ({ M: { name: '중간', definition: middle }, W: library.W }[id as 'M' | 'W']));
    expect(callMembers(nested, 'c', []).map((member) => [member.name, member.depth])).toEqual([['용어 추출 › 추출', 1], ['용어 추출 › 정리', 1]]);
  });
});
