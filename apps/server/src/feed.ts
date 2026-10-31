import { and, asc, eq, ne } from 'drizzle-orm';
import { FEED_UNITS_LIMIT, HELD_COLLECTIONS, normalizeTagScopes, type FeedCollection, type FeedRows, type FeedSnapshot, type SnapshotCollection } from '@tw/shared';
import type { Db } from './db/index.ts';
import { inList } from './db/chunk.ts';
import { rowChangesOf } from './db/row-changes.ts';
import * as s from './db/schema.ts';
import { withTags } from './services/knowledge-tags.ts';
import { fillTermUsage } from './services/term-usage.ts';
import { groupRows } from './services/group-rows.ts';
import { runRows } from './services/run-rows.ts';
import { listenerRows, projectRows, speakerRows } from './services/project-rows.ts';
import { projectEventFlow } from './services/event-routes.ts';
import { workflowRows } from './services/workflow-rows.ts';
import { unitRowsByIds } from './services/unit-rows.ts';

/**
 * The row feed: what the browser's collections hold, read the same way for the first load (snapshot)
 * and for each change event (the rows the database noted, db/row-changes.ts). A row a collection no
 * longer lists (deleted, or a rejected term) goes out as a delete.
 */

/** The project's terms as the glossary lists them (not rejected), with their tags; only `ids` when given. */
export function termRows(db: Db, projectId: string, ids?: readonly string[]) {
  const where = and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'), ids ? inList(s.terms.id, ids) : undefined);
  return withTags(db, 'terms', db.select().from(s.terms).where(where).orderBy(asc(s.terms.source)).all());
}

type Listed = typeof s.characters | typeof s.relationships | typeof s.speechRules | typeof s.documents;
/** A project's knowledge as its lists show it (not rejected), with tags; only `ids` when given. */
const listed = <T extends Listed>(table: T, projectId: string, ids?: readonly string[]) => and(eq(table.projectId, projectId), ne(table.status, 'rejected'), ids ? inList(table.id, ids) : undefined);

export const characterRows = (db: Db, projectId: string, ids?: readonly string[]) => withTags(db, 'characters', db.select().from(s.characters).where(listed(s.characters, projectId, ids)).orderBy(asc(s.characters.name)).all());
export const relationshipRows = (db: Db, projectId: string, ids?: readonly string[]) => withTags(db, 'relationships', db.select().from(s.relationships).where(listed(s.relationships, projectId, ids)).all());
export const speechRuleRows = (db: Db, projectId: string, ids?: readonly string[]) => withTags(db, 'speechRules', db.select().from(s.speechRules).where(listed(s.speechRules, projectId, ids)).all());
export const documentRows = (db: Db, projectId: string, ids?: readonly string[]) => withTags(db, 'documents', db.select().from(s.documents).where(listed(s.documents, projectId, ids)).orderBy(asc(s.documents.kind), asc(s.documents.title)).all());

/** The project's statuses in order. How many lines each has is its own query (it changes with every line). */
export const statusRows = (db: Db, projectId: string, ids?: readonly string[]) =>
  db.select({ id: s.statuses.id, name: s.statuses.name, color: s.statuses.color, kind: s.statuses.kind, sort: s.statuses.sort, inReview: s.statuses.inReview }).from(s.statuses).where(and(eq(s.statuses.projectId, projectId), ids ? inList(s.statuses.id, ids) : undefined)).orderBy(asc(s.statuses.sort)).all();

/** The project's tags in order; their counts are a query of their own, as for statuses. */
export const tagRows = (db: Db, projectId: string, ids?: readonly string[]) =>
  db
    .select({ id: s.tags.id, name: s.tags.name, color: s.tags.color, description: s.tags.description, scope: s.tags.scope, sort: s.tags.sort })
    .from(s.tags)
    .where(and(eq(s.tags.projectId, projectId), ids ? inList(s.tags.id, ids) : undefined))
    .orderBy(asc(s.tags.sort), asc(s.tags.name))
    .all()
    .map((tag) => ({ ...tag, scope: normalizeTagScopes(tag.scope) }));

const READERS: Record<FeedCollection, (db: Db, projectId: string, ids?: readonly string[]) => { id: string }[]> = {
  terms: termRows,
  characters: characterRows,
  relationships: relationshipRows,
  speechRules: speechRuleRows,
  documents: documentRows,
  statuses: statusRows,
  tags: tagRows,
  groups: groupRows,
  runs: runRows,
  project: (db, projectId) => projectRows(db, projectId),
  speakers: speakerRows,
  listeners: listenerRows,
  events: (db, projectId) => projectEventFlow(db, projectId),
  workflows: (db, projectId) => workflowRows(db, projectId),
  // Lines are sent as ids (feedRows); the browser reads the ones it holds by id.
  units: (db, projectId, ids) => (ids ? unitRowsByIds(db, projectId, ids) : []),
  // Named by id; the browser reads the items it shows (POST run-items).
  runItems: () => [],
};

/** A collection's rows now and the feed's count, for the browser's first load. */
export function feedSnapshot(db: Db, projectId: string, collection: SnapshotCollection): FeedSnapshot {
  // Usage counts are filled when first read; the writes are noted like any other and come again as events.
  if (collection === 'terms') fillTermUsage(db, projectId);
  const rows = READERS[collection](db, projectId);
  return { seq: rowChangesOf(db.$client).seq, rows };
}

/**
 * Collections computed over many tables: the event flow (one event's place can move what follows the
 * others) and the workflows with their problems. Their triggers note the whole collection (0113); it is
 * computed again and only the rows that differ from what the last event sent go out. The snapshot does
 * not move that baseline: another tab may still be waiting for the rows of changes made before it.
 */
const DERIVED = new Set<FeedCollection>(['events', 'workflows']);
const sentRows = new WeakMap<Db['$client'], Map<string, Map<string, string>>>();

function derivedChanges(db: Db, projectId: string, collection: FeedCollection) {
  const byProject = sentRows.get(db.$client) ?? new Map<string, Map<string, string>>();
  sentRows.set(db.$client, byProject);
  const key = `${projectId}:${collection}`;
  const before = byProject.get(key) ?? new Map<string, string>();
  const now = new Map(READERS[collection](db, projectId).map((row) => [row.id, { row, json: JSON.stringify(row) }] as const));
  byProject.set(key, new Map([...now].map(([id, { json }]) => [id, json])));
  return { upsert: [...now.values()].filter(({ row, json }) => before.get(row.id) !== json).map(({ row }) => row), delete: [...before.keys()].filter((id) => !now.has(id)) };
}

/** The project's rows changed since the last event, read again now; null when none. */
export function feedRows(db: Db, projectId: string): { rows: FeedRows; seq: number } | null {
  const changes = rowChangesOf(db.$client).take(projectId);
  if (!changes.size) return null;
  const rows: FeedRows = {};
  for (const [collection, changed] of changes) {
    const read = READERS[collection as FeedCollection];
    if (!read) continue;
    if (DERIVED.has(collection as FeedCollection)) {
      const diff = derivedChanges(db, projectId, collection as FeedCollection);
      if (diff.upsert.length || diff.delete.length) rows[collection as FeedCollection] = diff;
      continue;
    }
    const ids = [...changed.keys()];
    // Lines and run items go out as ids: the browser holds a few of them and reads those again.
    if ((HELD_COLLECTIONS as readonly string[]).includes(collection)) {
      rows[collection as FeedCollection] = ids.length > FEED_UNITS_LIMIT ? { upsert: [], delete: [], reload: true } : { upsert: [], delete: ids.filter((id) => changed.get(id) === 'delete'), changed: ids.filter((id) => changed.get(id) !== 'delete') };
      continue;
    }
    const upsert = read(db, projectId, ids);
    const listed = new Set(upsert.map((row) => row.id));
    rows[collection as FeedCollection] = { upsert, delete: ids.filter((id) => !listed.has(id)) };
  }
  return { rows, seq: rowChangesOf(db.$client).seq };
}
