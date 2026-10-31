import type { FeedRows } from '@tw/shared';

type Listener = (rows: FeedRows, seq: number) => void;

/**
 * The rows the server's change events carry (its row feed), handed to the browser's collections
 * (lib/collections.ts). Filled by the event stream (lib/live.ts); a reconnect asks every collection
 * to load its snapshot again, since the stream may have missed events.
 */
class Feed {
  private listeners = new Map<string, Set<Listener>>();
  private resyncs = new Set<() => void>();
  /** The highest feed count each project's collections have seen (an event's or a snapshot's). */
  private seen = new Map<string, number>();
  private waiters: { projectId: string; seq: number; done: () => void }[] = [];

  push(projectId: string, rows: FeedRows, seq: number) {
    for (const listener of this.listeners.get(projectId) ?? []) listener(rows, seq);
    this.markSeen(projectId, seq);
  }

  /** `restart`: a snapshot after a reconnect, whose count may be lower (a restarted server counts from 0). */
  markSeen(projectId: string, seq: number, restart = false) {
    if (!restart && seq <= (this.seen.get(projectId) ?? -1)) return;
    this.seen.set(projectId, seq);
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.projectId !== projectId || waiter.seq > seq) return true;
      waiter.done();
      return false;
    });
  }

  subscribe(projectId: string, listener: Listener) {
    const set = this.listeners.get(projectId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(projectId, set);
    return () => void set.delete(listener);
  }

  onResync(load: () => void) {
    this.resyncs.add(load);
    return () => void this.resyncs.delete(load);
  }

  resync() {
    for (const load of this.resyncs) load();
  }

  /**
   * Resolves once the project's collections hold the server's state as of `seq` (a write's x-seq), so a
   * write's optimistic rows can give way to the synced ones. Gives up after `timeoutMs`: a stream that is
   * gone must not hold a write forever (its rows then come with the reconnect's snapshot).
   */
  wait(projectId: string, seq: number | undefined, timeoutMs = 5_000) {
    if (seq === undefined || seq <= (this.seen.get(projectId) ?? -1)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.done !== done);
        resolve();
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push({ projectId, seq, done });
    });
  }
}

export const feed = new Feed();
