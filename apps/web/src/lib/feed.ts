import type { FeedRows } from '@tw/shared';

type Listener = (rows: FeedRows, seq: number) => void;

/**
 * The rows the server's change events carry (its row feed), handed to the browser's collections
 * (lib/collections.ts, lib/held.ts). Filled by the event stream (lib/live.ts).
 *
 * Rows reach a collection two ways: what it reads itself (its snapshot, or held rows by id) and the events that
 * follow. Nothing may fall between the two, so the feed knows whether the stream is open:
 * - a read made while the stream is open is followed by every later event;
 * - a read made before it opened, or while it was away, may have missed some: when the stream opens, every
 *   collection hears it (`onOpen`) and reads again what it read meanwhile (after a reconnect: everything).
 * Until a stream is started (`connecting`) there is nothing to wait for and reads are simply made (tests).
 */
class Feed {
  private listeners = new Map<string, Set<Listener>>();
  private opens = new Set<(missed: boolean) => void>();
  private state: 'idle' | 'connecting' | 'open' = 'idle';
  private everOpened = false;
  private liveWaiters = new Set<() => void>();
  /** The count of the last event the stream brought, per project. */
  private pushed = new Map<string, number>();
  /**
   * Each loaded (or loading: -1) snapshot collection's own count, per project. One number for the whole project
   * would call a write shown as soon as any one collection had caught up, while the collection that shows it is
   * still loading its snapshot.
   */
  private tracked = new Map<string, Map<symbol, number>>();
  private waiters: { projectId: string; seq: number; done: () => void }[] = [];

  // ── the stream's state ────────────────────────────────────────────────────────

  /** A stream is being opened (at start, and again after it dropped): reads made now may miss events. */
  connecting() {
    this.state = 'connecting';
  }

  /** Whether reads made now are followed by every later event (or no stream was ever started). */
  get live() {
    return this.state !== 'connecting';
  }

  /**
   * The stream is open. A reconnect may have missed events (and a restarted server counts again from 0): what
   * the last connection brought no longer says anything, and writes waiting on it are let go (their rows come
   * with the collections' new snapshots).
   */
  opened() {
    const missed = this.everOpened;
    this.everOpened = true;
    this.state = 'open';
    if (missed) {
      this.pushed.clear();
      const waiting = this.waiters;
      this.waiters = [];
      for (const waiter of waiting) waiter.done();
    }
    for (const waiter of [...this.liveWaiters]) waiter();
    for (const open of [...this.opens]) open(missed);
  }

  /**
   * Resolves once the stream is open (at once when it is, or when none was started), or after `timeoutMs` when
   * it does not open (the server is away): true when open, so the caller knows whether its read is followed.
   */
  whenLive(timeoutMs: number): Promise<boolean> {
    if (this.state !== 'connecting') return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.liveWaiters.delete(done);
        resolve(this.state === 'open');
      };
      const timer = setTimeout(done, timeoutMs);
      this.liveWaiters.add(done);
    });
  }

  /** Hears every time the stream opens; `missed`: it is a reconnect, so events may be lost. */
  onOpen(open: (missed: boolean) => void) {
    this.opens.add(open);
    return () => void this.opens.delete(open);
  }

  // ── events ────────────────────────────────────────────────────────────────────

  push(projectId: string, rows: FeedRows, seq: number) {
    for (const listener of this.listeners.get(projectId) ?? []) listener(rows, seq);
    this.pushed.set(projectId, seq);
    this.settle(projectId);
  }

  subscribe(projectId: string, listener: Listener) {
    const set = this.listeners.get(projectId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(projectId, set);
    return () => void set.delete(listener);
  }

  /**
   * A snapshot collection says how far it has come (its snapshot's count, then each event's): a write is shown
   * once every collection of its project that is loaded or loading has come that far. `stop` when it is torn down.
   * `loading`: it reads its snapshot (again); it has come nowhere until that is in.
   */
  track(projectId: string) {
    const id = Symbol();
    const counts = this.tracked.get(projectId) ?? new Map<symbol, number>();
    counts.set(id, -1);
    this.tracked.set(projectId, counts);
    return {
      seen: (seq: number) => {
        counts.set(id, seq);
        this.settle(projectId);
      },
      loading: () => void counts.set(id, -1),
      /** Its snapshot could not be read (it will be tried again): until then it holds no write back. */
      failed: () => {
        counts.set(id, Infinity);
        this.settle(projectId);
      },
      stop: () => {
        counts.delete(id);
        this.settle(projectId);
      },
    };
  }

  private reached(projectId: string, seq: number) {
    if ((this.pushed.get(projectId) ?? -1) < seq) return false;
    for (const count of this.tracked.get(projectId)?.values() ?? []) if (count < seq) return false;
    return true;
  }

  private settle(projectId: string) {
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.projectId !== projectId || !this.reached(projectId, waiter.seq)) return true;
      waiter.done();
      return false;
    });
  }

  /**
   * Resolves once the project's collections hold the server's state as of `seq` (a write's x-seq): the stream has
   * brought an event that far and every snapshot collection has applied it, so a write's optimistic rows can give
   * way to the synced ones. Gives up after `timeoutMs`: a stream that is gone must not hold a write forever (its
   * rows then come with the reconnect's snapshot).
   */
  wait(projectId: string, seq: number | undefined, timeoutMs = 5_000) {
    if (seq === undefined || this.reached(projectId, seq)) return Promise.resolve();
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

export type { Feed };
export const createFeed = () => new Feed();
export const feed = createFeed();
