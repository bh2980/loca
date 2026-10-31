import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Events, events, trackChanges, withImplied, type ChangeEvent } from './events.ts';

describe('Events coalescing', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  function collect(bus: Events) {
    const got: ChangeEvent[] = [];
    bus.on('change', (e) => got.push(e));
    return got;
  }

  it('merges 50 calls within 100ms into one event with the union of topics', () => {
    const bus = new Events();
    const got = collect(bus);
    const topics = ['runs', 'calls', 'chat', 'graph'] as const;
    for (let i = 0; i < 50; i++) {
      bus.changed('p1', topics[i % 4]!);
      vi.advanceTimersByTime(2);
    }
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(got).toHaveLength(1);
    expect(got[0]!.projectId).toBe('p1');
    expect([...got[0]!.topics].sort()).toEqual(['calls', 'chat', 'graph', 'runs', 'terms', 'units']);
  });

  it('keeps projects separate', () => {
    const bus = new Events();
    const got = collect(bus);
    bus.changed('a', 'runs');
    bus.changed('b', 'terms');
    bus.changed(undefined, 'connections');
    vi.advanceTimersByTime(300);
    expect(got).toHaveLength(3);
    expect(got.find((e) => e.projectId === 'a')!.topics).toEqual(['runs']);
    expect(got.find((e) => e.projectId === 'b')!.topics).toEqual(['terms', 'units']);
  });

  it('emits at least every max wait under a steady stream', () => {
    const bus = new Events();
    const got = collect(bus);
    // A call every 100ms never leaves a 300ms quiet window.
    for (let t = 0; t < 3500; t += 100) {
      bus.changed('p1', 'runs');
      vi.advanceTimersByTime(100);
    }
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.length).toBeLessThanOrEqual(4);
  });

  it('flush() delivers synchronously', () => {
    const bus = new Events();
    const got = collect(bus);
    bus.changed('p1', 'runs');
    bus.flush();
    expect(got).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(got).toHaveLength(1);
  });
});

describe('implied topics', () => {
  it('refreshes queries that read beyond their own topic', () => {
    // A speech rule or character change reaches the line hints and filters (units) and term usage.
    expect([...withImplied(['knowledge'])].sort()).toEqual(['knowledge', 'terms', 'units']);
    // The reading route reads source connections (graph) and line text/counts (units).
    expect([...withImplied(['graph'])].sort()).toEqual(['graph', 'terms', 'units']);
    // A line change does not reach the workflow checks: they read status definitions, not counts.
    expect(withImplied(['units']).has('workflows')).toBe(false);
    expect([...withImplied(['statuses'])].sort()).toEqual(['statuses', 'terms', 'units', 'workflows']);
    expect([...withImplied(['chat'])]).toEqual(['chat']);
  });
});

describe('changes a request made', () => {
  it('are gathered with what they imply, so the response can name them', async () => {
    const own = new Events(0, 0);
    const { topics } = await trackChanges(async () => {
      await Promise.resolve();
      events.changed('p', 'terms');
      own.changed('p', 'chat');
    });
    expect([...topics].sort()).toEqual(['chat', 'terms', 'units']);
    // Outside a request nothing is gathered.
    expect(await trackChanges(async () => {})).toEqual({ topics: new Set(), seq: undefined });
  });
});

describe('the tab whose own requests made a change (#20)', () => {
  const capture = () => {
    const bus = new Events(10_000, 10_000);
    const seen: ChangeEvent[] = [];
    bus.on('change', (event) => seen.push(event));
    return { bus, seen };
  };

  it('is named when every change came from its running requests, so it can skip the event', async () => {
    const { bus, seen } = capture();
    await trackChanges(async () => bus.changed('p', 'units'), 'tab-1');
    await trackChanges(async () => bus.changed('p', 'terms'), 'tab-1');
    bus.flush();
    expect(seen).toEqual([expect.objectContaining({ projectId: 'p', origin: 'tab-1' })]);
  });

  it('is not named when another tab, a request without an id, or background work joined in', async () => {
    const { bus, seen } = capture();
    await trackChanges(async () => bus.changed('a', 'units'), 'tab-1');
    await trackChanges(async () => bus.changed('a', 'units'), 'tab-2');
    await trackChanges(async () => bus.changed('b', 'units'), 'tab-1');
    await trackChanges(async () => bus.changed('b', 'units'));
    await trackChanges(async () => bus.changed('c', 'units'), 'tab-1');
    bus.changed('c', 'runs');
    bus.flush();
    expect(seen.map((event) => [event.projectId, event.origin])).toEqual([['a', undefined], ['b', undefined], ['c', undefined]]);
  });

  it('is not named for work a request started that went on after its answer', async () => {
    const { bus, seen } = capture();
    // A timer started inside the request keeps its async context, as a run's progress does.
    let done: () => void = () => {};
    const finished = new Promise<void>((resolve) => (done = resolve));
    const { topics } = await trackChanges(async () => {
      setTimeout(() => (bus.changed('p', 'runs'), done()), 5);
    }, 'tab-1');
    await finished;
    bus.flush();
    expect(topics.size).toBe(0);
    expect(seen[0]?.origin).toBeUndefined();
  });
});
