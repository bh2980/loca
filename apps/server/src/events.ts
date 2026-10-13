import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';

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
  | 'analysis'
  | 'calls';

/**
 * Queries that read beyond their own topic's tables, so a change also refreshes them. Kept here,
 * in one place, instead of at every write site (where they were missed):
 * - knowledge → units: a line's speech hint and the rule's line list read speech rules and
 *   characters (aliases decide who a speaker is); the AI context preview reads all knowledge.
 * - terms, workflows → units: the AI context preview and run preflight read the glossary and the workflow.
 * - projects → units: the project query (name, format rules, agent settings) lives under units with its status counts.
 * - units → statuses: statuses and tags carry line counts.
 * - statuses, connections → workflows: a workflow's error count checks its statuses, tags and HTTP connections.
 * - calls → runs: the jobs list (keyed 'runs') shows call counts read from ai_calls.
 */
const IMPLIES: Partial<Record<Topic, Topic[]>> = {
  knowledge: ['units'],
  terms: ['units'],
  workflows: ['units'],
  projects: ['units'],
  units: ['statuses'],
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
}

/** Topics for one project merge over this quiet window (trailing emit)... */
export const COALESCE_MS = 300;
/** ...but a continuous stream still emits at least this often. */
export const MAX_WAIT_MS = 1000;

interface Pending {
  topics: Set<Topic>;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class Events extends EventEmitter<{ change: [ChangeEvent] }> {
  private pending = new Map<string | undefined, Pending>();

  constructor(
    private readonly quietMs = COALESCE_MS,
    private readonly maxWaitMs = MAX_WAIT_MS,
  ) {
    super();
  }

  /** Coalesced per project: callers keep calling this as often as they like. */
  changed(projectId: string | undefined, ...topics: Topic[]) {
    // The request making the change also answers with its topics (see trackChanges).
    const touched = requestTopics.getStore();
    if (touched) for (const topic of withImplied(topics)) touched.add(topic);
    const now = Date.now();
    const entry = this.pending.get(projectId);
    if (entry) clearTimeout(entry.timer);
    const topicSet = entry?.topics ?? new Set<Topic>();
    for (const topic of withImplied(topics)) topicSet.add(topic);
    const startedAt = entry?.startedAt ?? now;
    const delay = Math.max(0, Math.min(this.quietMs, startedAt + this.maxWaitMs - now));
    const timer = setTimeout(() => this.flushProject(projectId), delay);
    timer.unref();
    this.pending.set(projectId, { topics: topicSet, startedAt, timer });
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
    if (entry.topics.size) this.emit('change', { projectId, topics: [...entry.topics] });
  }
}

/** Topics a request changed, gathered while it runs. */
const requestTopics = new AsyncLocalStorage<Set<Topic>>();

/**
 * Runs a request and returns the topics it changed, so its response can carry them (header
 * x-changed) and the client refetch at once, without waiting on the event stream, which can be
 * silently gone (a restarted server behind a proxy). Changes made later by work the request
 * started (a run, an analysis) still go out as events.
 */
export async function trackChanges(run: () => Promise<void>) {
  const topics = new Set<Topic>();
  await requestTopics.run(topics, run);
  return topics;
}

export const events = new Events();
events.setMaxListeners(100);
