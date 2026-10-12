import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Events, type ChangeEvent } from './events.ts';

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
    const topics = ['runs', 'reviews', 'units', 'terms'] as const;
    for (let i = 0; i < 50; i++) {
      bus.changed('p1', topics[i % 4]!);
      vi.advanceTimersByTime(2);
    }
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(got).toHaveLength(1);
    expect(got[0]!.projectId).toBe('p1');
    expect([...got[0]!.topics].sort()).toEqual(['reviews', 'runs', 'terms', 'units']);
  });

  it('keeps projects separate', () => {
    const bus = new Events();
    const got = collect(bus);
    bus.changed('a', 'runs');
    bus.changed('b', 'units');
    bus.changed(undefined, 'connections');
    vi.advanceTimersByTime(300);
    expect(got).toHaveLength(3);
    expect(got.find((e) => e.projectId === 'a')!.topics).toEqual(['runs']);
    expect(got.find((e) => e.projectId === 'b')!.topics).toEqual(['units']);
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
