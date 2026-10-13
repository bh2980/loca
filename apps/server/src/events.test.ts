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
    expect([...got[0]!.topics].sort()).toEqual(['calls', 'chat', 'graph', 'runs']);
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
    expect(got.find((e) => e.projectId === 'b')!.topics).toEqual(['terms', 'units', 'statuses', 'workflows']);
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
    // A speech rule or character change reaches the line hints (units), their counts and workflow checks.
    expect([...withImplied(['knowledge'])].sort()).toEqual(['knowledge', 'statuses', 'units', 'workflows']);
    expect([...withImplied(['chat'])]).toEqual(['chat']);
  });
});

describe('changes a request made', () => {
  it('are gathered with what they imply, so the response can name them', async () => {
    const own = new Events(0, 0);
    const topics = await trackChanges(async () => {
      await Promise.resolve();
      events.changed('p', 'terms');
      own.changed('p', 'chat');
    });
    expect([...topics].sort()).toEqual(['chat', 'statuses', 'terms', 'units', 'workflows']);
    // Outside a request nothing is gathered.
    expect(await trackChanges(async () => {})).toEqual(new Set());
  });
});
