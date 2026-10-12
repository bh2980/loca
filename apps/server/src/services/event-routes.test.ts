import { describe, expect, it } from 'vitest';
import { eventFlow, forks } from './event-routes.ts';

// start → a (a condition) → (b1 → b2 | c1) → end; s (a state) opens p1 and p2 side by side; x is outside the graph.
const next: Record<string, string[]> = { start: ['a'], a: ['b1', 'c1'], b1: ['b2'], b2: ['end'], c1: ['end'], end: [], s: ['p1', 'p2'], p1: [], p2: [] };
const kinds: Record<string, string> = { a: 'script', s: 'state' };
const labels: Record<string, string> = { 'a>b1': '도와준다', 'a>c1': '떠난다' };
const reach = (from: string, to: string): boolean => (next[from] ?? []).some((step) => step === to || reach(step, to));
const order = { leadsTo: reach };
const nodes = Object.keys(next).map((id) => ({ id, kind: kinds[id] ?? 'script', unitIds: [id] }));
const edges = Object.entries(next).flatMap(([fromId, tos]) => tos.map((toId) => ({ fromId, toId, label: labels[`${fromId}>${toId}`] ?? null })));
const forkOf = forks(nodes, edges, new Map(Object.keys(next).map((id) => [id, id])));
const event = (id: string, key: string, seq: number) => ({ id, at: { seq, key } });

describe('event flow', () => {
  it('links each event to the ones it leads to directly, naming the ways where it splits', () => {
    const events = [event('A', 'a', 1), event('B1', 'b1', 2), event('C1', 'c1', 3), event('B2', 'b2', 4), event('END', 'end', 5), event('X', 'x', 6), { id: 'N', at: null }];
    const flow = new Map(eventFlow(order, forkOf, events).map((row) => [row.id, row.next]));
    expect(flow.get('A')).toEqual([
      { id: 'B1', label: '도와준다' },
      { id: 'C1', label: '떠난다' },
    ]);
    expect(flow.get('B1')).toEqual([{ id: 'B2', label: null }]);
    expect(flow.get('B2')).toEqual([{ id: 'END', label: null }]);
    expect(flow.get('C1')).toEqual([{ id: 'END', label: null }]);
    expect(flow.get('X')).toEqual([]);
    expect(flow.get('N')).toEqual([]);
  });

  it('draws no line between scenes a state opens side by side (both happen; they are not branches)', () => {
    const flow = eventFlow(order, forkOf, [event('P1', 'p1', 1), event('P2', 'p2', 2)]);
    expect(flow.map((row) => row.next)).toEqual([[], []]);
  });

  it('does not fan an event at a state out to every scene the state opens', () => {
    const flow = new Map(eventFlow(order, forkOf, [event('S', 's', 1), event('P1', 'p1', 2), event('P2', 'p2', 3)]).map((row) => [row.id, row.next]));
    expect(flow.get('S')).toEqual([]);
  });
});
