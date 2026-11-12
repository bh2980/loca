import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { FEED_EVENT, type ChangeEvent } from '@loca/shared';
import { createFeed } from './feed';
import { startLive, type LiveSource } from './live';
import { key, ownKey } from './query-keys';

/** A fake EventSource: the test opens it, sends events and breaks it. */
class FakeSource implements LiveSource {
  listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: ChangeEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as unknown as Event);
  }
}

function setup(project = 'p1') {
  const sources: FakeSource[] = [];
  const feed = createFeed();
  const queryClient = new QueryClient();
  const asked: string[] = [];
  const ask = (name: string, options: { queryKey: readonly unknown[]; meta?: object }) => {
    void queryClient.prefetchQuery({ ...options, queryFn: async () => { asked.push(name); return null; } });
    // Shown on screen: an invalidation refetches it.
    queryClient.getQueryCache().find({ queryKey: options.queryKey })!.addObserver({ onQueryUpdate: () => undefined, shouldFetchOnWindowFocus: () => false, getCurrentResult: () => ({}) as never, options: { enabled: true, queryKey: options.queryKey } } as never);
  };
  let open: string | undefined = project;
  const stop = startLive(queryClient, { connect: () => (sources.push(new FakeSource()), sources.at(-1)!), feed, project: () => open });
  return { sources, feed, queryClient, asked, ask, stop, setProject: (next: string | undefined) => (open = next) };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('the event stream', () => {
  it('is one connection whichever project is open', async () => {
    const live = setup('p1');
    live.sources[0]!.emit('open');
    live.setProject('p2');
    live.setProject(undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(live.sources.length).toBe(1);
    expect(live.sources[0]!.closed).toBe(false);
    live.stop();
  });

  it('hands the rows to the feed whichever project is open, and refetches the open project\'s topics in one batch', async () => {
    const live = setup('p1');
    live.sources[0]!.emit('open');
    live.ask('units', { queryKey: key('units', 'ids', 'p1') });
    live.ask('terms', { queryKey: key('terms', 'usage', 'p1') });
    live.ask('surroundings', ownKey('line-surroundings', 'u1'));
    await vi.advanceTimersByTimeAsync(0);
    live.asked.length = 0;
    const pushed: [string, number][] = [];
    live.feed.subscribe('p1', (_rows, seq) => void pushed.push(['p1', seq]));
    live.feed.subscribe('p2', (_rows, seq) => void pushed.push(['p2', seq]));
    live.sources[0]!.emit(FEED_EVENT, { projectId: 'p1', topics: ['units'], rows: {}, seq: 1 });
    live.sources[0]!.emit(FEED_EVENT, { projectId: 'p1', topics: ['units', 'knowledge'], rows: {}, seq: 2 });
    live.sources[0]!.emit(FEED_EVENT, { projectId: 'p2', topics: ['terms'], rows: {}, seq: 7 });
    expect(pushed).toEqual([['p1', 1], ['p1', 2], ['p2', 7]]);
    expect(live.asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    // units by its key; the line's surroundings because they follow knowledge; terms not: another project's.
    expect(live.asked.sort()).toEqual(['surroundings', 'units']);
    // The other project's question is marked, to be asked again when it is next shown.
    expect(live.queryClient.getQueryState(key('terms', 'usage', 'p1'))?.isInvalidated).toBe(true);
    live.stop();
  });

  it('reopens a dropped stream with a growing wait, and tells the feed each time it opens', async () => {
    const live = setup();
    const opens: boolean[] = [];
    live.feed.onOpen((missed) => void opens.push(missed));
    expect(live.feed.live).toBe(false);
    live.sources[0]!.emit('open');
    expect([live.feed.live, opens]).toEqual([true, [false]]);
    live.sources[0]!.emit('error');
    expect([live.sources[0]!.closed, live.feed.live]).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(999);
    expect(live.sources.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(live.sources.length).toBe(2);
    // It fails again: the next try waits twice as long.
    live.sources[1]!.emit('error');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(live.sources.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    live.sources[2]!.emit('open');
    expect(opens).toEqual([false, true]);
    // The old stream's late error does not close the new one.
    live.sources[1]!.emit('error');
    expect(live.sources[2]!.closed).toBe(false);
    live.stop();
  });

  it('asks every question again when the stream opens: what was asked without it may have changed unheard', async () => {
    const live = setup();
    live.ask('runs', { queryKey: key('runs', 'plan', 'r1') });
    await vi.advanceTimersByTimeAsync(0);
    live.asked.length = 0;
    live.sources[0]!.emit('open');
    await vi.advanceTimersByTimeAsync(0);
    expect(live.asked).toEqual(['runs']);
    live.stop();
  });

  it('a stream that goes silent is reopened', async () => {
    const live = setup();
    live.sources[0]!.emit('open');
    await vi.advanceTimersByTimeAsync(40_000);
    live.sources[0]!.emit('ping');
    await vi.advanceTimersByTimeAsync(44_999);
    expect(live.sources.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1 + 1_000);
    expect(live.sources.length).toBe(2);
    live.stop();
  });
});
