import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { withImplied, type ChangeEvent, type FeedRows, type Topic } from '@loca/shared';
import { perDatabase } from './db/per-database.ts';

/** Topics for one project merge over this quiet window (trailing emit)... */
export const COALESCE_MS = 300;
/** ...but a continuous stream still emits at least this often. */
export const MAX_WAIT_MS = 1000;

interface Pending {
  topics: Set<Topic>;
  /** Tabs whose running requests made these changes. */
  origins: Set<string>;
  /** Some change was not reported in a response (made in the background, or by a request without an id). */
  unreported: boolean;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class Events extends EventEmitter<{ change: [ChangeEvent]; shutdown: [] }> {
  private pending = new Map<string | undefined, Pending>();
  /** The project's changed rows and the feed's count, taken when an event goes out (set by the app: feed.ts). */
  rowSource?: (projectId: string) => { rows: FeedRows; seq: number } | null;

  constructor(
    private readonly quietMs = COALESCE_MS,
    private readonly maxWaitMs = MAX_WAIT_MS,
  ) {
    super();
  }

  /**
   * These topics changed in the project (none: the app's own). The database says so itself for every table
   * (topic_changed, db/topics.ts); code calls this only for what is not a row (CHANGED_BY_HAND, events.test.ts).
   * Coalesced per project: it may be called as often as rows change.
   */
  changed(projectId: string | undefined, ...topics: Topic[]) {
    // The request making the change also answers with its topics (see trackChanges). Work it
    // started that goes on after the answer (a run, a chat stream) is reported only as an event.
    const scope = requestScope.getStore();
    const reporting = scope?.open ? scope : undefined;
    const all = withImplied(topics);
    if (reporting) for (const topic of all) reporting.topics.add(topic);
    this.schedule(projectId, all, reporting);
  }

  /** A row the feed keeps changed (db/row-changes.ts): an event goes out like for a topic, carrying the rows. */
  rowsChanged(projectId: string, seq: number) {
    const scope = requestScope.getStore();
    const reporting = scope?.open ? scope : undefined;
    if (reporting) reporting.seq = seq;
    this.schedule(projectId, [], reporting);
  }

  private schedule(projectId: string | undefined, topics: Iterable<Topic>, reporting: RequestScope | undefined) {
    const now = Date.now();
    const entry = this.pending.get(projectId);
    if (entry) clearTimeout(entry.timer);
    const topicSet = entry?.topics ?? new Set<Topic>();
    for (const topic of topics) topicSet.add(topic);
    const origins = entry?.origins ?? new Set<string>();
    let unreported = entry?.unreported ?? false;
    if (reporting?.client) origins.add(reporting.client);
    else unreported = true;
    const startedAt = entry?.startedAt ?? now;
    const delay = Math.max(0, Math.min(this.quietMs, startedAt + this.maxWaitMs - now));
    const timer = setTimeout(() => this.flushProject(projectId), delay);
    timer.unref();
    this.pending.set(projectId, { topics: topicSet, origins, unreported, startedAt, timer });
  }

  /** Emit everything pending right now (for callers or tests that need synchronous delivery). */
  flush() {
    for (const projectId of [...this.pending.keys()]) this.flushProject(projectId);
  }

  private flushProject(projectId: string | undefined) {
    const entry = this.pending.get(projectId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(projectId);
    const origin = !entry.unreported && entry.origins.size === 1 ? [...entry.origins][0] : undefined;
    const feed = projectId ? (this.rowSource?.(projectId) ?? null) : null;
    if (entry.topics.size || feed) this.emit('change', { projectId, topics: [...entry.topics], ...(origin && { origin }), ...(feed && { rows: feed.rows, seq: feed.seq }) });
  }
}

/** Topics a request changed, gathered while it runs, and the tab that sent it (x-client). */
interface RequestScope {
  topics: Set<Topic>;
  /** The feed's count after the last row this request changed (the answer's x-seq): a write waits for an event with it. */
  seq?: number;
  client?: string;
  /** Until its answer is made: changes after that are not in its x-changed. */
  open: boolean;
}
const requestScope = new AsyncLocalStorage<RequestScope>();

/**
 * Runs a request and returns the topics it changed, so its response can carry them (header
 * x-changed) and the client refetch at once, without waiting on the event stream, which can be
 * silently gone (a restarted server behind a proxy). Changes made later by work the request
 * started (a run) still go out as events. `seq` is the feed's count after the last row it changed (x-seq).
 */
export async function trackChanges(run: () => Promise<void>, client?: string) {
  const scope: RequestScope = { topics: new Set(), client: client || undefined, open: true };
  try {
    await requestScope.run(scope, run);
  } finally {
    scope.open = false;
  }
  return { topics: scope.topics, seq: scope.seq };
}

/**
 * A database's change events: what its triggers and the code working on it report, and what the app's event stream
 * sends. One per open database, so an app only hears (and only carries the rows of) its own.
 */
export const eventsOf = perDatabase(() => {
  const events = new Events();
  events.setMaxListeners(100);
  return events;
});
