import { describe, expect, it } from 'vitest';
import { withRoutes } from './event-routes.ts';

// start → a → (b1 → b2 | c1) → end; x is outside the graph.
const next: Record<string, string[]> = { start: ['a'], a: ['b1', 'c1'], b1: ['b2'], b2: ['end'], c1: ['end'], end: [] };
const reach = (from: string, to: string): boolean => (next[from] ?? []).some((step) => step === to || reach(step, to));
const order = { has: (key: string) => key in next, passage: (a: string, b: string) => (a in next && b in next ? ('maybe' as const) : ('unknown' as const)), leadsTo: reach };
const event = (id: string, key: string, seq: number) => ({ id, at: { seq, key } });

describe('event routes', () => {
  it('puts events on branches the graph keeps apart side by side, until the routes meet', () => {
    const events = [event('A', 'a', 1), event('B1', 'b1', 2), event('C1', 'c1', 3), event('B2', 'b2', 4), event('END', 'end', 5), event('X', 'x', 6), { id: 'N', at: null }];
    const routed = new Map(withRoutes(order, events).map((row) => [row.id, { route: row.route, lanes: row.lanes }]));
    expect(routed.get('A')).toEqual({ route: { block: 0, lane: 0 }, lanes: 1 });
    expect(routed.get('B1')).toEqual({ route: { block: 1, lane: 0 }, lanes: 2 });
    expect(routed.get('C1')).toEqual({ route: { block: 1, lane: 1 }, lanes: 2 });
    expect(routed.get('B2')).toEqual({ route: { block: 1, lane: 0 }, lanes: 2 });
    expect(routed.get('END')?.route?.block).toBe(2);
    expect(routed.get('X')?.lanes).toBe(1);
    expect(routed.get('N')).toEqual({ route: null, lanes: 1 });
  });
});
