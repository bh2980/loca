import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { APP_COLLECTIONS, APP_FEED, FEED_COLLECTIONS, type FeedCollection } from '@tw/shared';
import { openDatabase } from './db/index.ts';
import { rowChangesOf } from './db/row-changes.ts';
import * as s from './db/schema.ts';
import { tablesRead } from './db/test-tables-read.ts';
import { rows } from './db/test-rows.ts';
import { schemaTables, type TableName } from './db/topics.ts';
import { READERS } from './feed.ts';
import { memoryStore } from './services/secrets.ts';

type Op = 'insert' | 'update' | 'delete';
const OPS: readonly Op[] = ['insert', 'update', 'delete'];
/** A table a reader reads: any change of it can alter the row ('all'), or only these changes can, and why the others cannot. */
type Reads = 'all' | { ops: readonly Op[]; why: string };

const MADE_ONCE = { ops: [], why: "Only what a run is made with (its name, its start, its nodes' names): never changed, and a run is never deleted alone." } as const;
const PAIR = { ops: ['insert', 'delete'], why: 'A row is a pair of ids: put or taken away, never changed.' } as const;
const IDS_ONLY = { ops: ['insert', 'delete'], why: 'Only which ones there are (their ids).' } as const;
/** What a proposal's card names by id inside its input (proposal-details.ts): no trigger can tell which proposals name a changed row without reading every input. */
const NAMED = { ops: [], why: 'Named inside the input: the browser reads the cards it shows again when one of the rows they name comes in an event (lib/proposals.ts, staleBy).' } as const;

/**
 * What each collection's row is computed from (feed.ts READERS). A row is sent again only when the database notes it
 * (row_changed), so every table here needs triggers that note this collection; one a reader starts to read fails
 * below until it is stated here, and stated means its triggers exist.
 */
const READS: Record<FeedCollection, Partial<Record<TableName, Reads>>> = {
  terms: { terms: 'all', knowledge_tags: 'all' },
  characters: { characters: 'all', knowledge_tags: 'all' },
  relationships: { relationships: 'all', knowledge_tags: 'all' },
  speechRules: { speech_rules: 'all', knowledge_tags: 'all' },
  documents: { documents: 'all', knowledge_tags: 'all' },
  statuses: { statuses: 'all' },
  tags: { tags: 'all' },
  // A scene's progress counts its lines by the project's rules (번역 제외, the format tokens).
  groups: { groups: 'all', units: 'all', projects: { ops: ['update'], why: 'The rules its lines are counted by; a project is made before its scenes and takes them with it.' } },
  runs: { runs: 'all', run_items: 'all', ai_calls: 'all' },
  project: { projects: { ops: ['update'], why: "A project's own collection is opened once it is there; that it is gone is the projects list's to say (the app's scope)." } },
  speakers: { units: 'all', characters: 'all' },
  listeners: { units: 'all' },
  events: {
    story_events: 'all',
    event_links: 'all',
    knowledge_tags: 'all',
    units: 'all',
    groups: { ops: ['update'], why: 'Where an event happens: the title and section of its evidence lines’ scene. A scene is made before its lines and goes after them, and they say so.' },
    graph_nodes: 'all',
    graph_edges: 'all',
  },
  workflows: { workflows: 'all', statuses: 'all', tags: 'all', connections: 'all' },
  statusCounts: { statuses: IDS_ONLY, units: 'all' },
  tagCounts: { tags: IDS_ONLY, unit_tags: PAIR, knowledge_tags: { ops: ['insert', 'delete'], why: 'Counted; its note is not read.' } },
  units: { units: 'all', candidates: 'all', unit_tags: PAIR, run_items: 'all', runs: MADE_ONCE },
  lineExtras: {
    units: { ops: ['delete'], why: 'Only whether the line is there.' },
    candidates: 'all',
    run_items: 'all',
    runs: MADE_ONCE,
    line_events: { ops: ['insert'], why: 'History is only added to, and goes with its line.' },
  },
  runItems: {
    run_items: 'all',
    runs: { ops: ['update'], why: 'A continue changes its models and definition; a run is made before its items and never deleted alone.' },
    units: { ops: [], why: 'Only whether the line is there: deleting a line deletes its items (source-mutations.ts).' },
    terms: { ops: ['update'], why: "The term's words; deleting a term deletes its items (item-delete.ts)." },
  },
  proposals: { proposals: 'all', characters: NAMED, relationships: NAMED, speech_rules: NAMED, story_events: NAMED, documents: NAMED, statuses: NAMED, tags: NAMED, workflows: NAMED, groups: NAMED, units: NAMED, terms: NAMED, connections: NAMED, runs: NAMED },
  aiCalls: { ai_calls: 'all' },
  graphViews: { graph_views: 'all' },
  chatSessions: { chat_sessions: 'all', ai_calls: 'all' },
  projects: { projects: 'all', units: { ops: ['insert', 'delete'], why: 'Counted; a line never changes project.' } },
  appDefaults: { app_settings: { ops: ['insert', 'update'], why: 'One row, never deleted.' } },
  connections: { connections: 'all', connection_key_copies: PAIR },
};

/** Everything the seeded rows are called, to read by id. */
const IDS = ['p1', 'st', 'tag', 'g', 'u', 'term', 'doc', 'ch1', 'ch2', 'rel', 'ev1', 'ev2', 'rule', 'home', 'own', 'w', 'run', 'term-run', 'item', 'term-item', 'call', 'chat-call', 'test-call', 'chat', 'v', 'A', 'B', ''];

/** A database with a row of every table, and enough besides that each reader takes every path it has. */
function seeded() {
  const db = openDatabase(':memory:');
  for (const row of rows(db)) row.insert();
  const p = 'p1';
  // A line said by someone to someone, an event with an evidence line (where it happens), a run over terms, and proposals of each tool whose card names rows.
  db.update(s.units).set({ speaker: 'A', listener: 'B' }).where(eq(s.units.id, 'u')).run();
  db.update(s.storyEvents).set({ evidence: ['u'] }).where(eq(s.storyEvents.id, 'ev1')).run();
  db.insert(s.runs).values({ id: 'term-run', projectId: p, subject: 'terms', workflowName: 'W', workflowVersion: 1, definition: { nodes: [], edges: [] } as never, scope: {} as never, status: 'completed', total: 1 }).run();
  db.insert(s.runItems).values({ id: 'term-item', runId: 'term-run', subjectId: 'term', nodeId: 'n', state: 'done', visits: {}, data: {} as never }).run();
  const named: [string, Record<string, unknown>][] = [
    ['save_knowledge', { characters: [{ id: 'ch1', name: 'A2' }], relationships: [{ id: 'rel', kind: 'rival' }], speechRules: [{ id: 'rule', note: 'n' }], events: [{ id: 'ev1', title: 'E' }], documents: [{ id: 'doc', title: 'D2' }] }],
    ['update_unit', { unitId: 'u', groupId: 'g' }],
    ['update_status', { id: 'st' }],
    ['update_tag', { id: 'tag' }],
    ['save_workflow', { id: 'w' }],
    ['start_run', { workflowId: 'w', filter: { groups: ['g'], tags: ['tag'], statuses: ['st'] }, terms: { terms: ['term'] }, models: { n: { connection: 'own' } } }],
    ['continue_run', { runId: 'run', models: { n: { connection: 'own' } } }],
  ];
  const proposals = named.map(([tool, input], index) => ({ id: `named-${index}`, projectId: p, source: 'cli' as const, tool, input }));
  db.insert(s.proposals).values(proposals).run();
  return { db, ids: [...IDS, ...proposals.map((row) => row.id)] };
}

describe('what the feed readers read', () => {
  it('is stated for every collection, with tables of the schema', () => {
    expect(Object.keys(READS).sort()).toEqual([...FEED_COLLECTIONS].sort());
    expect(Object.keys(READERS).sort()).toEqual([...FEED_COLLECTIONS].sort());
    const tables = schemaTables();
    for (const stated of Object.values(READS)) for (const table of Object.keys(stated)) expect(tables).toContain(table);
  });

  it('is only the stated tables: a reader that starts to read another fails here until it is stated (and has triggers)', () => {
    const { db, ids } = seeded();
    const deps = { secrets: memoryStore() };
    for (const collection of FEED_COLLECTIONS) {
      // The app's own collections are read under its scope; connections under both.
      const scopes = collection === 'connections' || collection === 'aiCalls' ? ['p1', APP_FEED] : (APP_COLLECTIONS as readonly string[]).includes(collection) ? [APP_FEED] : ['p1'];
      const read = READERS[collection] as (db: unknown, scope: string, ids: readonly string[] | undefined, deps: unknown) => { id: string }[];
      let found = 0;
      const seen = tablesRead(db, () => {
        for (const scope of scopes) for (const wanted of [undefined, ids]) found += read(db, scope, wanted, deps).length;
      });
      expect(found, `${collection} read no row: the seed does not reach it`).toBeGreaterThan(0);
      expect([...seen].sort(), collection).toEqual(Object.keys(READS[collection]).sort());
    }
  });

  it('has, for each table a reader reads, the triggers that note the collection’s row', () => {
    const db = openDatabase(':memory:');
    const triggers = db.$client.prepare("select tbl_name as tbl, sql from sqlite_master where type = 'trigger' and sql like '%row_changed(%'").all() as { tbl: string; sql: string }[];
    // A trigger notes a collection by naming it, or (knowledge_tags) by the tagged item's kind, listed in its WHEN.
    const notes = (sql: string, collection: string) => sql.includes(`row_changed('${collection}'`) || (/row_changed\((NEW|OLD)\.`kind`/.test(sql) && sql.includes(`'${collection}'`));
    const missing: string[] = [];
    for (const [collection, stated] of Object.entries(READS))
      for (const [table, reads] of Object.entries(stated)) {
        if (reads !== 'all') expect(reads.why, `${collection} ← ${table}`).not.toBe('');
        for (const op of reads === 'all' ? OPS : reads.ops)
          if (!triggers.some((trigger) => trigger.tbl === table && new RegExp(`AFTER ${op} `, 'i').test(trigger.sql) && notes(trigger.sql, collection))) missing.push(`${collection} ← ${table} ${op}`);
      }
    expect(missing).toEqual([]);
  });
});

describe('rows a reader joins from other tables', () => {
  /** The collections and ids the database noted for a write. */
  const noted = (db: ReturnType<typeof openDatabase>, write: () => void) => {
    const taken = (scope: string) => Object.fromEntries([...rowChangesOf(db.$client).take(scope)].map(([collection, changed]) => [collection, [...changed.keys()].sort()]));
    taken('p1');
    write();
    return taken('p1');
  };

  it("are noted: a line's extras for its candidates and its own delete, a term's run item for the term's words, a run's items for its models, a run for a call taken away", () => {
    const { db } = seeded();
    expect(noted(db, () => db.update(s.candidates).set({ text: '안녕하세요' }).where(eq(s.candidates.id, 'c')).run())).toMatchObject({ lineExtras: ['u'] });
    expect(noted(db, () => db.update(s.terms).set({ target: '관문' }).where(eq(s.terms.id, 'term')).run())).toMatchObject({ runItems: ['term-item'] });
    // Usage counts are written often and are not the item's.
    expect(noted(db, () => db.update(s.terms).set({ lines: 3 }).where(eq(s.terms.id, 'term')).run()).runItems).toBeUndefined();
    expect(noted(db, () => db.update(s.runs).set({ models: { n: { label: 'M' } } as never }).where(eq(s.runs.id, 'run')).run())).toMatchObject({ runItems: ['item'] });
    expect(noted(db, () => db.update(s.runs).set({ status: 'paused' }).where(eq(s.runs.id, 'run')).run()).runItems).toBeUndefined();
    // A run's row counts its calls: one taken away counts too.
    db.insert(s.aiCalls).values({ id: 'run-call', projectId: 'p1', kind: 'run', refId: 'run', label: 'L', startedAt: new Date(0) }).run();
    expect(noted(db, () => db.delete(s.aiCalls).where(eq(s.aiCalls.id, 'run-call')).run())).toMatchObject({ runs: ['run'], aiCalls: ['run-call'] });
    db.delete(s.units).where(eq(s.units.id, 'u')).run();
    expect(rowChangesOf(db.$client).take('p1').get('lineExtras')).toEqual(new Map([['u', 'delete']]));
  });

  it('are not carried where the browser holds them already: renaming a scene changes its row and no line', () => {
    const { db } = seeded();
    const changed = noted(db, () => db.update(s.groups).set({ title: 'Renamed', section: 'Ch2' }).where(eq(s.groups.id, 'g')).run());
    expect(changed.groups).toEqual(['g']);
    expect(changed.units).toBeUndefined();
    const line = READERS.units(db, 'p1', ['u'])[0]!;
    expect(line.groupId).toBe('g');
    expect(Object.keys(line).filter((key) => /^group(?!Id$)/.test(key))).toEqual([]);
  });
});
