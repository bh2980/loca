import { describe, expect, it } from 'vitest';
import { forks, withRoutes } from './event-routes.ts';

// start → a (a condition) → (b1 → b2 | c1) → end; s (a state) opens p1 and p2 side by side; x is outside the graph.
const next: Record<string, string[]> = { start: ['a'], a: ['b1', 'c1'], b1: ['b2'], b2: ['end'], c1: ['end'], end: [], s: ['p1', 'p2'], p1: [], p2: [] };
const kinds: Record<string, string> = { a: 'condition', s: 'state' };
const reach = (from: string, to: string): boolean => (next[from] ?? []).some((step) => step === to || reach(step, to));
const order = { has: (key: string) => key in next, leadsTo: reach };
const nodes = Object.keys(next).map((id) => ({ id, kind: kinds[id] ?? 'script', unitIds: [id] }));
const edges = Object.entries(next).flatMap(([fromId, tos]) => tos.map((toId) => ({ fromId, toId, label: null })));
const forkOf = forks(nodes, edges, new Map(Object.keys(next).map((id) => [id, id])));
const event = (id: string, key: string, seq: number) => ({ id, at: { seq, key } });

describe('event routes', () => {
  it('puts events down different ways of one condition side by side, until the routes meet', () => {
    const events = [event('A', 'a', 1), event('B1', 'b1', 2), event('C1', 'c1', 3), event('B2', 'b2', 4), event('END', 'end', 5), event('X', 'x', 6), { id: 'N', at: null }];
    const routed = new Map(withRoutes(order, forkOf, events).map((row) => [row.id, { route: row.route, lanes: row.lanes }]));
    expect(routed.get('B1')).toEqual({ route: { block: 1, lane: 0 }, lanes: 2 });
    expect(routed.get('C1')).toEqual({ route: { block: 1, lane: 1 }, lanes: 2 });
    expect(routed.get('B2')).toEqual({ route: { block: 1, lane: 0 }, lanes: 2 });
    expect(routed.get('END')?.lanes).toBe(1);
    expect(routed.get('X')?.lanes).toBe(1);
    expect(routed.get('N')).toEqual({ route: null, lanes: 1 });
  });

  it('keeps scenes a state opens side by side in script order (both happen; they are not branches)', () => {
    const routed = withRoutes(order, forkOf, [event('P1', 'p1', 1), event('P2', 'p2', 2)]);
    expect(routed.map((row) => row.lanes)).toEqual([1, 1]);
  });
});
