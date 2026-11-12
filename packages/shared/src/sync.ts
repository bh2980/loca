/**
 * The browser's collections (TanStack DB) and the server's row feed that keeps them current: the
 * database reports every changed row (triggers, apps/server/drizzle/0106_row_feed.sql and the row_feed migrations after it), and each change
 * event carries those rows as the snapshot has them, so the browser patches rows instead of refetching.
 */
export const FEED_COLLECTIONS = ['terms', 'characters', 'relationships', 'speechRules', 'documents', 'statuses', 'tags', 'groups', 'runs', 'project', 'speakers', 'listeners', 'events', 'workflows', 'statusCounts', 'tagCounts', 'units', 'runItems', 'proposals', 'projects', 'appDefaults', 'connections', 'graphViews', 'chatSessions', 'aiCalls', 'lineExtras'] as const;
export type FeedCollection = (typeof FEED_COLLECTIONS)[number];
/**
 * Collections the browser holds only part of (the rows it shows): lines, a line's run history and AI 제안 (line
 * extras), run items, proposals and the AI log are too many to load whole. It reads the rows it shows by id (POST
 * sync/:collection, at most HELD_READ_MAX a request), and an event names the changed ones by id (`changed`) so it
 * reads again only those it holds.
 */
export const HELD_COLLECTIONS = ['units', 'lineExtras', 'runItems', 'proposals', 'aiCalls'] as const satisfies readonly FeedCollection[];
export type HeldCollection = (typeof HELD_COLLECTIONS)[number];
export const HELD_READ_MAX = 500;
/**
 * The app's own rows, noted under the scope APP_FEED instead of a project: the projects list, the home's
 * defaults (one row, id 'defaults') and the home's connections. A project has connections of its own too,
 * in its own scope.
 */
export const APP_FEED = 'app';
export const APP_COLLECTIONS = ['projects', 'appDefaults', 'connections'] as const satisfies readonly FeedCollection[];
export type AppCollection = (typeof APP_COLLECTIONS)[number];
const APP_ONLY: readonly string[] = ['projects', 'appDefaults'];
/** What a project's collections load whole (GET /projects/:id/sync/:collection). */
export const SNAPSHOT_COLLECTIONS = FEED_COLLECTIONS.filter((name): name is Exclude<FeedCollection, HeldCollection | 'projects' | 'appDefaults'> => !(HELD_COLLECTIONS as readonly string[]).includes(name) && !APP_ONLY.includes(name));
export type SnapshotCollection = (typeof SNAPSHOT_COLLECTIONS)[number];
/**
 * The name of the change events on GET /events. Never "change": React reads window.event.type to rank an update, and an
 * update made while handling a "change" event is drawn at once as if a person had typed, in a microtask. A table that kept
 * drawing that way never gave the browser a turn to read the rows it was waiting for: the page froze.
 */
export const FEED_EVENT = 'feed';

/** More changed rows of a held collection than this in one event go out as `reload` instead of ids (a bulk change, an import). */
export const FEED_UNITS_LIMIT = 500;

/** One collection's part of a change event: rows to put, read again when the event was sent, and ids no longer listed. */
export interface FeedChanges {
  upsert: Record<string, unknown>[];
  delete: string[];
  /** Held collections only (HELD_COLLECTIONS): the rows that changed, by id; the browser reads again the ones it holds. */
  changed?: string[];
  /** Held collections only: too many changed to name (FEED_UNITS_LIMIT): read again every row held. */
  reload?: true;
}
export type FeedRows = Partial<Record<FeedCollection, FeedChanges>>;

/**
 * A collection's rows as they are at `seq`: what the browser loads first (GET /projects/:id/sync/:collection) and a
 * held collection's rows by id (POST). The wire is untyped here: each collection's row type is its reader's
 * (FeedRow, apps/server/src/feed.ts), which the browser's collections take.
 */
export interface FeedSnapshot {
  seq: number;
  rows: Record<string, unknown>[];
}

/** Query families ("questions") the browser refetches and the CLI waits on. A change event names the ones that changed. */
export const TOPICS = ['projects', 'units', 'graph', 'statuses', 'terms', 'knowledge', 'connections', 'workflows', 'runs', 'chat', 'proposals', 'calls', 'app'] as const;
export type Topic = (typeof TOPICS)[number];

/**
 * A question that reads beyond its own topic's tables, so a change there refreshes it too. Which topic a
 * table's change belongs to is the database's to say (TABLE_TOPICS, apps/server/src/db/topics.ts); what
 * else reads that table is a fact about the queries, kept here in one place. Each line names its query.
 */
export const IMPLIES: Partial<Record<Topic, readonly Topic[]>> = {
  // A page of line ids and its count (units ids, matches) filter by a saved graph view; the reading route between two
  // lines and a graph node's lines (keyed units) walk the graph's nodes and edges.
  graph: ['units'],
  // The line filter finds speakers, listeners and mentions through characters' aliases; a speech rule's lines, the
  // attach search and the run preflight read characters, rules and the rest of the knowledge.
  knowledge: ['units'],
  // The attach search lists terms and the run preflight counts the glossary each request carries.
  terms: ['units'],
  // The run preflight reads the workflow it would run.
  workflows: ['units'],
  // The line filter's 번역 제외 and marks read the project's format and exclusion rules; so does detect-format-rules.
  projects: ['units'],
  // The line filter reads statuses (검토함: inReview) and tags by name; the result check reads both.
  statuses: ['units'],
  // The run preflight reads each node's connection (model limits, whether it can run).
  connections: ['units'],
  // A term's usage (terms usage) counts the lines it appears in; an AI node's request preview (workflows
  // request-preview) is built from a sample line and, through it, everything a line's request reads.
  units: ['terms', 'workflows'],
  // A run's continue preflight (runs continue-preflight) paces itself by the calls the run has made.
  calls: ['runs'],
};

/** Every topic with all it implies, worked out once. */
const IMPLIED = new Map<Topic, readonly Topic[]>();
for (const topic of TOPICS) {
  const all = new Set<Topic>();
  const visit = (next: Topic) => {
    if (all.has(next)) return;
    all.add(next);
    for (const implied of IMPLIES[next] ?? []) visit(implied);
  };
  visit(topic);
  IMPLIED.set(topic, [...all]);
}

/** Topics with everything they imply, transitively. */
export function withImplied(topics: Iterable<Topic>) {
  const all = new Set<Topic>();
  for (const topic of topics) for (const implied of IMPLIED.get(topic) ?? [topic]) all.add(implied);
  return all;
}

/** What a change event says (GET /events, FEED_EVENT). */
export interface ChangeEvent {
  /** The project it happened in; absent for the app's own (connections of the home, its defaults). */
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
