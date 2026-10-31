import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import type { FeedRows } from '@tw/shared';

/** Query families the web client caches. A change event tells it which ones to refetch. */
export type Topic =
  | 'projects'
  | 'units'
  | 'graph'
  | 'statuses'
  | 'terms'
  | 'knowledge'
  | 'connections'
  | 'workflows'
  | 'runs'
  | 'chat'
  | 'proposals'
  | 'calls'
  /** 홈 설정 (app_settings): read by no project query. */
  | 'app';

/**
 * Queries that read beyond their own topic's tables, so a change also refreshes them. Kept here,
 * in one place, instead of at every write site (where they were missed):
 * - knowledge → units: a line's speech hint and the rule's line list read speech rules and
 *   characters (aliases decide who a speaker is); the AI context preview reads all knowledge.
 * - terms, workflows → units: the AI context preview and run preflight read the glossary and the workflow.
 * - projects → units: the project query (name, format rules, agent settings) lives under units with its status counts.
 * - units → statuses: statuses and tags carry line counts.
 * - statuses, connections → workflows: a workflow's error count checks its statuses, tags and HTTP connections.
 * - The route slice's translation counts and 다음 길 preview read units: their queries are keyed under
 *   'units' (not 'graph'), so a translation change refreshes them with no extra emit.
 * - calls → runs: the jobs list (keyed 'runs') shows call counts read from ai_calls.
 */
const IMPLIES: Partial<Record<Topic, Topic[]>> = {
  // Reading routes read source connections and unit text, under the units query family.
  graph: ['units'],
  knowledge: ['units'],
  terms: ['units'],
  workflows: ['units'],
  projects: ['units'],
  units: ['statuses', 'terms'],
  statuses: ['workflows'],
  connections: ['workflows'],
  calls: ['runs'],
};

/** A topic with everything it implies, transitively. */
export function withImplied(topics: Iterable<Topic>) {
  const all = new Set<Topic>();
  const visit = (topic: Topic) => {
    if (all.has(topic)) return;
    all.add(topic);
    for (const next of IMPLIES[topic] ?? []) visit(next);
  };
  for (const topic of topics) visit(topic);
  return all;
}

export interface ChangeEvent {
  projectId?: string;
  topics: Topic[];
  /**
   * The one browser tab (its x-client id) whose requests made every change in this event, each
   * while it was still running, so each answer already named its topics (x-changed). That tab has
   * refetched them and skips the event; every other tab refetches as usual (#20). Absent when any
   * change came from elsewhere: background work, another tab, or a request without an id.
   */
  origin?: string;
  /** The row feed: rows of the browser's collections changed in this event, read again as it was sent (feed.ts). */
  rows?: FeedRows;
  /** The feed's change count when it was sent: the browser drops an event older than its snapshot, and a write waits for its own. */
  seq?: number;
}

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

  /** Coalesced per project: callers keep calling this as often as they like. */
  changed(projectId: string | undefined, ...topics: Topic[]) {
    // The request making the change also answers with its topics (see trackChanges). Work it
    // started that goes on after the answer (a run, a chat stream) is reported only as an event.
    const scope = requestScope.getStore();
    const reporting = scope?.open ? scope : undefined;
    if (reporting) for (const topic of withImplied(topics)) reporting.topics.add(topic);
    this.schedule(projectId, withImplied(topics), reporting);
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

export const events = new Events();
events.setMaxListeners(100);
