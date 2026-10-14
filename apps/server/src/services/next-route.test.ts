import { describe, expect, it } from 'vitest';
import { bestRoute, previewNext, routeLines, untranslatedWeights, type Weights } from './next-route.ts';
import { routeGraph, walkRoute } from './route-slice.ts';

type N = { id: string; key: string; kind: string; unitIds: string[] };
const edge = (from: string, to: string) => ({ from, to, label: null as string | null });
let seq = 0;
/** Nodes with `lines` units each; units get ascending seq in definition order so script order is definition order. */
function build(defs: [id: string, kind: string, lines: number][], edges: [string, string][]) {
  const units = new Map<string, { seq: number; source: string }>();
  const nodes: N[] = defs.map(([id, kind, lines]) => ({
    id,
    key: id,
    kind,
    unitIds: Array.from({ length: lines }, (_, i) => {
      const unit = `${id}#${i}`;
      units.set(unit, { seq: ++seq, source: unit });
      return unit;
    }),
  }));
  return { nodes, edges: edges.map(([a, b]) => edge(a, b)), units };
}
const graphOf = (b: ReturnType<typeof build>) => routeGraph(b.nodes, b.edges, b.units);
const weightsOf = (b: ReturnType<typeof build>, translated: string[] = []) => untranslatedWeights(b.nodes, (unit) => translated.some((node) => unit.startsWith(`${node}#`)));

/** Every combination of arms over all exclusive forks; the best untranslated count. */
function brute(g: ReturnType<typeof routeGraph>, weights: Weights) {
  const forks = [...g.byId.keys()].filter((id) => g.exclusive(id));
  let best = 0;
  const go = (i: number, picks: Record<string, string>) => {
    if (i === forks.length) return void (best = Math.max(best, routeLines(g, weights, picks)));
    for (const way of g.out.get(forks[i]!)!) go(i + 1, { ...picks, [forks[i]!]: way.to });
  };
  go(0, {});
  return best;
}

/** start -> pick1 -> [a(3) | b(5)] -> mid -> pick2 -> [c(4) | d(1)] -> end */
const twoForks = () =>
  build(
    [['start', 'script', 1], ['pick1', 'condition', 0], ['a', 'script', 3], ['b', 'script', 5], ['mid', 'script', 1], ['pick2', 'condition', 0], ['c', 'script', 4], ['d', 'script', 1], ['end', 'script', 1]],
    [['start', 'pick1'], ['pick1', 'a'], ['pick1', 'b'], ['a', 'mid'], ['b', 'mid'], ['mid', 'pick2'], ['pick2', 'c'], ['pick2', 'd'], ['c', 'end'], ['d', 'end']],
  );

describe('bestRoute', () => {
  it('takes the arms with the most untranslated lines and equals the brute-force optimum', () => {
    const b = twoForks();
    const g = graphOf(b), w = weightsOf(b);
    const result = bestRoute(g, w, {});
    expect(result.lines).toBe(brute(g, w));
    expect(result.lines).toBe(1 + 5 + 1 + 4 + 1);
    expect(result.picks).toEqual({ pick1: 'b' });
  });

  it('avoids translated lines: with route 1 translated the other arm wins', () => {
    const b = twoForks();
    const g = graphOf(b);
    // Route 1 (a, c) is translated.
    const w = weightsOf(b, ['start', 'a', 'mid', 'c', 'end']);
    const result = bestRoute(g, w, {});
    expect(result.lines).toBe(brute(g, w));
    expect(result.lines).toBe(5 + 1);
    expect(result.picks).toEqual({ pick1: 'b', pick2: 'd' });
  });

  it('ties keep the current pick, else the first arm in script order', () => {
    const b = build(
      [['start', 'script', 1], ['pick', 'condition', 0], ['a', 'script', 2], ['b', 'script', 2], ['end', 'script', 1]],
      [['start', 'pick'], ['pick', 'a'], ['pick', 'b'], ['a', 'end'], ['b', 'end']],
    );
    const g = graphOf(b), w = weightsOf(b);
    expect(bestRoute(g, w, {}).picks).toEqual({});
    expect(bestRoute(g, w, { pick: 'b' }).picks).toEqual({ pick: 'b' });
    expect(bestRoute(g, w, { pick: 'a' }).picks).toEqual({ pick: 'a' });
  });

  it('is deterministic and never worse than the picks it starts from', () => {
    const b = twoForks();
    const g = graphOf(b);
    for (const translated of [[], ['a'], ['b', 'c'], ['start', 'a', 'b', 'c', 'd', 'mid', 'end']]) {
      const w = weightsOf(b, translated);
      for (const start of [{} as Record<string, string>, { pick1: 'b' }, { pick2: 'd' }, { pick1: 'b', pick2: 'd' }]) {
        const once = bestRoute(g, w, start);
        expect(bestRoute(g, w, start)).toEqual(once);
        expect(once.lines).toBeGreaterThanOrEqual(routeLines(g, w, start));
      }
    }
  });

  it('looks through a worse arm to the fork behind it', () => {
    // arm x holds 2 lines but leads to a fork with a 9-line arm; arm y holds 3 lines and ends.
    const b = build(
      [['start', 'script', 0], ['pick', 'condition', 0], ['x', 'script', 2], ['y', 'script', 3], ['inner', 'condition', 0], ['p', 'script', 1], ['q', 'script', 9], ['end', 'script', 1]],
      [['start', 'pick'], ['pick', 'x'], ['pick', 'y'], ['x', 'inner'], ['inner', 'p'], ['inner', 'q'], ['p', 'end'], ['q', 'end'], ['y', 'end']],
    );
    const g = graphOf(b), w = weightsOf(b);
    expect(bestRoute(g, w, {}).lines).toBe(brute(g, w));
    expect(bestRoute(g, w, {}).lines).toBe(2 + 9 + 1);
  });

  it('parallel fan-outs keep all arms and add up', () => {
    const b = build(
      [['start', 'script', 1], ['fan', 'state', 0], ['l', 'script', 2], ['r', 'script', 3]],
      [['start', 'fan'], ['fan', 'l'], ['fan', 'r']],
    );
    const g = graphOf(b);
    expect(bestRoute(g, weightsOf(b), {})).toEqual({ picks: {}, lines: 6 });
  });

  it('matches the brute-force optimum on random layered DAGs', () => {
    let state = 12345;
    const rand = (n: number) => ((state = (state * 1103515245 + 12345) % 2147483648), state % n);
    let optimal = 0;
    const total = 60;
    for (let round = 0; round < total; round++) {
      const defs: [string, string, number][] = [['n0', 'script', 1 + rand(3)]];
      const edges: [string, string][] = [];
      let layer = ['n0'];
      for (let depth = 1; depth <= 4; depth++) {
        const width = 1 + rand(3);
        const next: string[] = [];
        for (let i = 0; i < width; i++) {
          const id = `n${depth}_${i}`;
          defs.push([id, 'script', rand(5)]);
          next.push(id);
        }
        for (const from of layer) {
          const picks = new Set<string>([next[rand(next.length)]!]);
          if (rand(2)) picks.add(next[rand(next.length)]!);
          if (picks.size > 1) {
            // an exclusive fork: a condition node before the arms
            defs.push([`c_${from}`, 'condition', 0]);
            edges.push([from, `c_${from}`]);
            for (const to of picks) edges.push([`c_${from}`, to]);
          } else edges.push([from, [...picks][0]!]);
        }
        layer = next;
      }
      const b = build(defs, edges);
      const g = graphOf(b);
      const translated = defs.filter(() => rand(4) === 0).map(([id]) => id);
      const w = weightsOf(b, translated);
      const result = bestRoute(g, w, {});
      expect(result.lines).toBeLessThanOrEqual(brute(g, w));
      expect(result.lines).toBe(routeLines(g, w, result.picks));
      if (result.lines === brute(g, w)) optimal++;
    }
    // A local search, not an exact one: it must find the optimum on nearly every small graph.
    expect(optimal).toBeGreaterThanOrEqual(Math.floor(total * 0.95));
  });
});

describe('previewNext', () => {
  it('counts what the next route adds, the open lines of this one and the routes still to translate', () => {
    const b = twoForks();
    const g = graphOf(b);
    // Nothing translated: the best route is the next one, and two routes cover the rest.
    const fresh = previewNext(g, weightsOf(b), {});
    expect(fresh.newLines).toBe(12);
    expect(fresh.totalUntranslatedOnRoute).toBe(1 + 3 + 1 + 4 + 1);
    expect(fresh.changed).toBe(true);
    expect(fresh.remainingRoutes).toBe(2);
    // The current route (b, c) translated: the next one differs and adds the rest.
    const done = previewNext(g, weightsOf(b, ['start', 'b', 'mid', 'c', 'end']), { pick1: 'b' });
    expect(done.totalUntranslatedOnRoute).toBe(0);
    expect(done.newLines).toBe(3 + 1);
    expect(done.picks).toEqual({ pick1: 'a', pick2: 'd' });
    expect(done.remainingRoutes).toBe(1);
  });

  it('is finished when no route has an untranslated line', () => {
    const b = twoForks();
    const all = ['start', 'a', 'b', 'mid', 'c', 'd', 'end'];
    const preview = previewNext(graphOf(b), weightsOf(b, all), {});
    expect(preview).toMatchObject({ newLines: 0, totalUntranslatedOnRoute: 0, remainingRoutes: 0, changed: false });
  });

  it('the same route is not a next route', () => {
    const b = twoForks();
    const g = graphOf(b);
    const preview = previewNext(g, weightsOf(b), { pick1: 'b' });
    expect(preview.changed).toBe(false);
    expect(preview.newLines).toBeGreaterThan(0);
    expect(walkRoute(g, preview.picks).inSlice).toEqual(walkRoute(g, { pick1: 'b' }).inSlice);
  });

  it('caps the estimate at 20+', () => {
    // One choice with 25 arms of their own lines: every route covers one arm.
    const defs: [string, string, number][] = [['s', 'script', 1], ['c', 'condition', 0]];
    const edges: [string, string][] = [['s', 'c']];
    for (let i = 0; i < 25; i++) {
      defs.push([`a${i}`, 'script', 2]);
      edges.push(['c', `a${i}`]);
    }
    const b = build(defs, edges);
    expect(previewNext(graphOf(b), weightsOf(b), {}).remainingRoutes).toBe('20+');
  });
});
