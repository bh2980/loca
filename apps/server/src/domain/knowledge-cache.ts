import { and, eq } from 'drizzle-orm';
import { glossaryMatcher, termMatcher } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildGraphOrder } from './graph-order.ts';

/*
 * The knowledge snapshot cache. better-sqlite3 is synchronous, so re-reading whole knowledge tables per batch
 * or per line blocks the server. Reads are cached per project and validated by a version per table. The
 * versions are bumped by TEMP triggers (installed on the connection) that call a JS function on every insert,
 * update or delete, so any writer (API route, workflow node, importer, raw SQL) invalidates. Rolled-back
 * transactions never un-bump a version (it lives in JS), and tables written inside a still-open transaction
 * are not cached until a call outside any transaction has purged them. The cache belongs to its connection:
 * two open databases never read each other's, and a deleted project's entries go when its row does.
 */

const TRACKED = ['characters', 'relationships', 'documents', 'terms', 'speech_rules', 'story_events', 'tags', 'projects'] as const;
/** What a cached read may depend on: a tracked table, the script's order (lines and scenes) or the dialogue graph. */
type Tracked = (typeof TRACKED)[number] | 'order' | 'graph';
const VERSIONS: Tracked[] = [...TRACKED, 'order', 'graph'];
/** Said by the trigger on a deleted project: nothing reads its entries again, so they are dropped. */
const GONE = 'gone';

interface Tracker {
  versions: Map<string, number>;
  entries: Map<string, { signature: string; value: unknown }>;
  /** Tables written while a transaction was open; their cached data may belong to a rollback. */
  dirty: Set<string>;
  /** Triggers were created inside a transaction and may have been rolled back with it. */
  unverified: boolean;
  client: { inTransaction: boolean; exec(sql: string): unknown; prepare(sql: string): { pluck(): { get(): unknown } } };
}
const trackers = new WeakMap<object, Tracker | null>();

function clientOf(db: Db) {
  const handle = db as unknown as { $client?: Tracker['client']; session?: { client?: Tracker['client'] } };
  return handle.$client ?? handle.session?.client ?? null;
}

const EVERY = ['insert', 'update', 'delete'];
/** One trigger per table, name and operation (the table is in its name: two tables bump `order`, three `graph`). */
const trigger = (table: string, name: string, op: string) =>
  `create temp trigger if not exists tw_${table.replace(/\W/g, '')}_${name}_${op.replace(/\W+/g, '_')} after ${op} on main.${table} begin select tw_bump('${name}'); end;`;
const TRIGGERS = [
  ...TRACKED.flatMap((table) => EVERY.map((op) => trigger(table, table, op))),
  ...['insert', 'delete', 'update of sort, group_id, key, project_id'].map((op) => trigger('units', 'order', op)),
  ...['insert', 'delete', 'update of sort'].map((op) => trigger('"groups"', 'order', op)),
  // The graph as the AI context and the speech rules walk it: its nodes and edges, and which groups are scenes.
  ...EVERY.map((op) => trigger('graph_nodes', 'graph', op)),
  ...EVERY.map((op) => trigger('graph_edges', 'graph', op)),
  ...['insert', 'delete', 'update of kind, project_id'].map((op) => trigger('"groups"', 'graph', op)),
  trigger('projects', GONE, 'delete'),
];

const install = (tracker: Tracker) => tracker.client.exec(TRIGGERS.join('\n'));

function trackerOf(db: Db): Tracker | null {
  const client = clientOf(db);
  if (!client) return null;
  let tracker = trackers.get(client);
  if (tracker === undefined) {
    try {
      tracker = { versions: new Map(), entries: new Map(), dirty: new Set(), unverified: false, client };
      const owner = tracker;
      (client as unknown as { function(name: string, fn: (table: string) => number): void }).function('tw_bump', (table: string) => {
        if (table === GONE) owner.entries.clear();
        owner.versions.set(table, (owner.versions.get(table) ?? 0) + 1);
        if (owner.client.inTransaction) owner.dirty.add(table);
        return 0;
      });
      owner.unverified = client.inTransaction;
      install(owner);
    } catch {
      tracker = null;
    }
    trackers.set(client, tracker);
  }
  if (!tracker) return null;
  const outside = !tracker.client.inTransaction;
  if (tracker.unverified) {
    const present = Number(tracker.client.prepare("select count(*) from sqlite_temp_master where name like 'tw\\_%' escape '\\'").pluck().get());
    if (present < TRIGGERS.length) {
      install(tracker);
      for (const table of VERSIONS) tracker.versions.set(table, (tracker.versions.get(table) ?? 0) + 1);
      tracker.entries.clear();
    }
    if (outside) tracker.unverified = false;
  }
  if (outside && tracker.dirty.size) {
    for (const table of tracker.dirty) tracker.versions.set(table, (tracker.versions.get(table) ?? 0) + 1);
    tracker.dirty.clear();
  }
  return tracker;
}

/** Cached `load()` for one project, valid while none of `tables` was written. Treat the result as read-only. */
export function cachedKnowledge<T>(db: Db, projectId: string, name: string, tables: Tracked[], load: () => T): T {
  const tracker = trackerOf(db);
  if (!tracker || tables.some((table) => tracker.dirty.has(table))) return load();
  const signature = tables.map((table) => tracker.versions.get(table) ?? 0).join('.');
  const key = `${projectId}|${name}`;
  const hit = tracker.entries.get(key);
  if (hit && hit.signature === signature) return hit.value as T;
  const value = load();
  tracker.entries.set(key, { signature, value });
  return value;
}

/** Cached whole-table reads for one project, shared by context building and workflow function nodes. */
export function knowledgeOf(db: Db, projectId: string) {
  const confirmed = <T extends { status: string }>(rows: T[]) => rows.filter((row) => row.status === 'confirmed');
  return {
    /** Confirmed terms with a matcher over their sources. */
    terms: () =>
      cachedKnowledge(db, projectId, 'terms', ['terms'], () => {
        const rows = db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), eq(s.terms.status, 'confirmed'))).all();
        return { rows, matcher: glossaryMatcher(rows) };
      }),
    /** Confirmed terms that have a translation, with a matcher: what a translation must contain. */
    glossary: () =>
      cachedKnowledge(db, projectId, 'glossary', ['terms'], () => {
        const rows = db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), eq(s.terms.status, 'confirmed'))).all().filter((term) => term.target.trim());
        return { rows, matcher: glossaryMatcher(rows) };
      }),
    /** Confirmed characters with a matcher over names and aliases. */
    characters: () =>
      cachedKnowledge(db, projectId, 'characters', ['characters'], () => {
        const rows = confirmed(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all());
        return { rows, matcher: termMatcher(rows, (character) => [character.name, ...character.aliases]) };
      }),
    /** Every character, whatever its status (for matching names a writer must not duplicate). */
    allCharacters: () => cachedKnowledge(db, projectId, 'allCharacters', ['characters'], () => db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all()),
    allTermSources: () => cachedKnowledge(db, projectId, 'termSources', ['terms'], () => db.select({ source: s.terms.source }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((term) => term.source)),
    allRelationships: () => cachedKnowledge(db, projectId, 'relationships', ['relationships'], () => db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all()),
    allSpeechRules: () => cachedKnowledge(db, projectId, 'speechRules', ['speech_rules'], () => db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all()),
    eventTitles: () => cachedKnowledge(db, projectId, 'eventTitles', ['story_events'], () => db.select({ title: s.storyEvents.title }).from(s.storyEvents).where(eq(s.storyEvents.projectId, projectId)).all().map((row) => row.title)),
    alwaysDocuments: () =>
      cachedKnowledge(db, projectId, 'alwaysDocuments', ['documents'], () =>
        db.select({ kind: s.documents.kind, title: s.documents.title, body: s.documents.body }).from(s.documents).where(and(eq(s.documents.projectId, projectId), eq(s.documents.alwaysInclude, true), eq(s.documents.status, 'confirmed'))).all(),
      ),
    relationships: () => cachedKnowledge(db, projectId, 'confirmedRelationships', ['relationships'], () => confirmed(db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all())),
    /** Every tag of the project (workflow nodes read them per line). */
    tags: () => cachedKnowledge(db, projectId, 'tags', ['tags'], () => db.select({ id: s.tags.id, name: s.tags.name, scope: s.tags.scope }).from(s.tags).where(eq(s.tags.projectId, projectId)).all()),
    /** The project settings workflow nodes read per line. */
    settings: () =>
      cachedKnowledge(db, projectId, 'settings', ['projects'], () => db.select({ formatRules: s.projects.formatRules, aiAutoConfirm: s.projects.aiAutoConfirm }).from(s.projects).where(eq(s.projects.id, projectId)).get()),
  };
}

/** The dialogue graph's "certainly passed" order; rule intervals are picked by it (DESIGN 3.2). Built once and kept while the script's order and the graph are unchanged. */
export const graphOrder = (db: Db, projectId: string) => cachedKnowledge(db, projectId, 'graphOrder', ['order', 'graph'], () => buildGraphOrder(db, projectId));

/** Script order of every line (scene order, then line order): rule intervals fall back to it for lines outside the graph. */
export function scriptOrder(db: Db, projectId: string) {
  return cachedKnowledge(db, projectId, 'scriptOrder', ['order'], () => {
    const rows = db
      .select({ key: s.units.key, seq: s.units.seq })
      .from(s.units)
      .where(eq(s.units.projectId, projectId))
      .all();
    return new Map(rows.map((row) => [row.key, row.seq]));
  });
}
