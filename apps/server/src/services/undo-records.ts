import { and, desc, eq, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { UndoData, UndoRow } from '../db/schema.ts';
import { badRequest } from '../refusal.ts';
import { changed, invalidate, refreshNodeGroups, resequence } from './source-mutations.ts';

/**
 * The one undo of structural changes: deleting lines, scenes and knowledge items (with everything that hangs from
 * them), and edits of the dialogue graph. The change records what it removes, rewrites and makes while it runs
 * (recorder) and stores that as one row; putting it back (undoRecorded) is the same call for ⌘/Ctrl+Z in the app
 * and for an accepted proposal's 되돌리기 (the restore_deleted tool). Rows are kept as the database stored them
 * (column → raw value), so what comes back is exactly what went: ids, timestamps, JSON and all.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The tables a record may hold, in the order their rows go back (a row after the rows it points at; line_events
 * last, see undoRecorded). `key`: what tells two rows apart. `needs`: a row is left out when the row it links to
 * (parent table → its column here) is gone by then (a tag or a run deleted since): the link has nothing to attach
 * to, and the rest is still worth putting back. `subjects`: run items name these rows without a foreign key.
 */
const TABLES = {
  tags: { key: ['id'] },
  groups: { key: ['id'] },
  units: { key: ['id'], subjects: true },
  candidates: { key: ['id'] },
  unit_tags: { key: ['unit_id', 'tag_id'], needs: { tags: 'tag_id' } },
  graph_nodes: { key: ['id'] },
  graph_edges: { key: ['id'] },
  characters: { key: ['id'] },
  relationships: { key: ['id'] },
  speech_rules: { key: ['id'] },
  story_events: { key: ['id'] },
  event_links: { key: ['id'] },
  documents: { key: ['id'] },
  terms: { key: ['id'], subjects: true },
  knowledge_tags: { key: ['kind', 'item_id', 'tag_id'], needs: { tags: 'tag_id' } },
  run_items: { key: ['id'], needs: { runs: 'run_id' } },
  line_events: { key: ['id'] },
} as const satisfies Record<string, { key: readonly string[]; needs?: Record<string, string>; subjects?: true }>;
export type UndoTable = keyof typeof TABLES;
const ORDER = Object.keys(TABLES) as UndoTable[];
const isTable = (name: string): name is UndoTable => Object.hasOwn(TABLES, name);
/** Changing these changes the script's order and the graph's layout. */
const STRUCTURE: readonly string[] = ['groups', 'units', 'graph_nodes', 'graph_edges'];

/** Records are small next to a project, but nothing reads an old one: kept this long, and this many per project. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_MAX = 1_000;

const name = (identifier: string) => sql.identifier(identifier);
const among = (column: string, values: readonly string[]) => sql`${name(column)} in (select value from json_each(${JSON.stringify(values)}))`;

/** Records what one change touches while it runs; `save` stores it and answers with the record's id. */
export function recorder(tx: Tx, projectId: string) {
  const removed = new Map<UndoTable, UndoRow[]>();
  const rewritten = new Map<string, { table: UndoTable; id: string; values: UndoRow }>();
  const made = new Map<UndoTable, string[]>();
  const seen = new Set<string>();
  const once = (table: UndoTable, row: UndoRow) => {
    const key = `${table}:${TABLES[table].key.map((column) => String(row[column])).join('\u0000')}`;
    return seen.has(key) ? false : (seen.add(key), true);
  };
  return {
    /** Rows about to be removed: those whose `column` is one of `values` (and whose other columns equal `also`). Call before the delete. */
    removed(table: UndoTable, column: string, values: readonly string[], also: Record<string, string> = {}) {
      if (!values.length) return;
      const conditions: SQL[] = [among(column, values), ...Object.entries(also).map(([field, value]) => sql`${name(field)} = ${value}`)];
      const rows = tx.all<UndoRow>(sql`select * from ${name(table)} where ${sql.join(conditions, sql` and `)}`).filter((row) => once(table, row));
      if (rows.length) removed.set(table, [...(removed.get(table) ?? []), ...rows]);
    },
    /** Columns of a row about to be rewritten, as they are now. A column recorded before keeps its first value. */
    rewritten(table: UndoTable, id: string, columns: readonly string[]) {
      // A row this change made (or already holds whole) needs no former values.
      if (seen.has(`${table}:${id}`)) return;
      const row = tx.all<UndoRow>(sql`select ${sql.join(columns.map(name), sql`, `)} from ${name(table)} where id = ${id}`)[0];
      if (!row) return;
      const entry = rewritten.get(`${table}:${id}`) ?? { table, id, values: {} };
      entry.values = { ...row, ...entry.values };
      rewritten.set(`${table}:${id}`, entry);
    },
    /** A row the change made. */
    made(table: UndoTable, id: string) {
      seen.add(`${table}:${id}`);
      made.set(table, [...(made.get(table) ?? []), id]);
    },
    /** Stores the record; null when the change touched nothing. `kind`: what was changed, as the agent permissions name it. */
    save(kind: string): string | null {
      const data: UndoData = {
        removed: [...removed].map(([table, rows]) => ({ table, rows })),
        rewritten: [...rewritten.values()],
        made: [...made].map(([table, ids]) => ({ table, ids })),
      };
      if (!data.removed.length && !data.rewritten.length && !data.made.length) return null;
      const { id } = tx.insert(s.undoRecords).values({ projectId, kind, data }).returning({ id: s.undoRecords.id }).get();
      prune(tx, projectId);
      return id;
    },
  };
}
export type UndoRecorder = ReturnType<typeof recorder>;

function prune(tx: Tx, projectId: string) {
  tx.delete(s.undoRecords).where(and(eq(s.undoRecords.projectId, projectId), lt(s.undoRecords.createdAt, new Date(Date.now() - KEEP_MS)))).run();
  const newest = tx.select({ id: s.undoRecords.id }).from(s.undoRecords).where(eq(s.undoRecords.projectId, projectId)).orderBy(desc(s.undoRecords.createdAt)).limit(KEEP_MAX + 1).all();
  if (newest.length > KEEP_MAX) tx.delete(s.undoRecords).where(and(eq(s.undoRecords.projectId, projectId), notInArray(s.undoRecords.id, newest.slice(0, KEEP_MAX).map((row) => row.id)))).run();
}

const GONE = '되돌릴 수 없습니다. 이미 되돌렸거나 보관 기간(30일)이 지났습니다.';

/**
 * Puts back what the change with this record did, once: the rows it made go, the rows it removed come back as they
 * were, the columns it rewrote get their former values. All or nothing: when the project changed so that a row cannot
 * go back (its scene or status deleted, its key taken), nothing is restored and the reason is said. `kind`: refuses a
 * record of another kind (the tool's permission was checked for the kind it named).
 */
export function undoRecorded(db: Db, projectId: string, id: string, kind?: string) {
  const record = db.select().from(s.undoRecords).where(and(eq(s.undoRecords.id, id), eq(s.undoRecords.projectId, projectId))).get();
  if (!record) badRequest(GONE);
  if (kind !== undefined && record!.kind !== kind) badRequest(`이 기록은 ${record!.kind}의 변경입니다. kind를 맞춰 다시 보내세요.`);
  const { data } = record!;
  const structural = [...data.removed, ...data.rewritten, ...data.made].some((part) => STRUCTURE.includes(part.table));
  let restored = 0;
  try {
    db.transaction((tx) => {
      const columnsOf = (table: UndoTable) => new Set(tx.all<{ name: string }>(sql`select name from pragma_table_info(${table})`).map((column) => column.name));
      // What the change made, the rows that point at others first.
      for (const table of [...ORDER].reverse()) {
        const ids = data.made.filter((part) => part.table === table).flatMap((part) => part.ids);
        if (!ids.length) continue;
        if ('subjects' in TABLES[table]) tx.run(sql`delete from run_items where ${among('subject_id', ids)}`);
        tx.run(sql`delete from ${name(table)} where ${among('id', ids)}`);
      }
      const backLines = data.removed.filter((part) => part.table === 'units').flatMap((part) => part.rows.map((row) => String(row.id)));
      for (const table of ORDER) {
        const rows = data.removed.filter((part) => part.table === table).flatMap((part) => part.rows);
        if (!rows.length) continue;
        const known = columnsOf(table);
        // Putting lines and their tags back writes history of its own (the line_events triggers): the history that
        // comes back is the one the lines had, so what this restore wrote goes first.
        if (table === 'line_events' && backLines.length) tx.run(sql`delete from line_events where ${among('unit_id', backLines)}`);
        const needs = Object.entries(('needs' in TABLES[table] ? TABLES[table].needs : {}) as Record<string, string>);
        for (const row of rows) {
          const columns = Object.keys(row).filter((column) => known.has(column));
          const values = sql.join(columns.map((column) => sql`${row[column]}`), sql`, `);
          const into = sql`${name(table)} (${sql.join(columns.map(name), sql`, `)})`;
          if (needs.length) {
            const there = sql.join(needs.map(([parent, column]) => sql`exists (select 1 from ${name(parent)} where id = ${row[column]})`), sql` and `);
            restored += tx.run(sql`insert or ignore into ${into} select ${values} where ${there}`).changes;
          } else restored += tx.run(sql`insert into ${into} values (${values})`).changes;
        }
      }
      for (const { table, id: rowId, values } of data.rewritten) {
        if (!isTable(table)) continue;
        const known = columnsOf(table);
        const columns = Object.keys(values).filter((column) => known.has(column));
        if (columns.length) tx.run(sql`update ${name(table)} set ${sql.join(columns.map((column) => sql`${name(column)} = ${values[column]}`), sql`, `)} where id = ${rowId}`);
      }
      tx.delete(s.undoRecords).where(eq(s.undoRecords.id, id)).run();
      if (structural) {
        refreshNodeGroups(tx, projectId);
        resequence(tx, projectId);
        invalidate(tx, projectId);
      }
    });
  } catch (error) {
    badRequest(`되돌릴 수 없습니다. 그 뒤에 프로젝트가 바뀌어 그대로 되살릴 수 없습니다 (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (structural) changed(db, projectId);
  return { ok: true as const, restored };
}
