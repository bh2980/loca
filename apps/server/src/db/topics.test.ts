import { describe, expect, it } from 'vitest';
import { TOPICS, withImplied, type ChangeEvent } from '@tw/shared';
import { events } from '../events.ts';
import { openDatabase } from './index.ts';
import * as s from './schema.ts';
import { rows } from './test-rows.ts';
import { TABLE_TOPICS, schemaTables, topicTriggerSql } from './topics.ts';

describe('topics from the database', () => {
  it('lists every table of the schema, each with its topics or the reason it has none', () => {
    expect(Object.keys(TABLE_TOPICS).sort()).toEqual(schemaTables().sort());
    for (const entry of Object.values(TABLE_TOPICS)) {
      if ('none' in entry) expect(entry.none).not.toBe('');
      else for (const rule of entry.topics) expect(TOPICS).toContain(typeof rule === 'string' ? rule : rule.topic);
    }
  });

  it('has, in a freshly migrated database, exactly the triggers TABLE_TOPICS stands for', () => {
    const db = openDatabase(':memory:');
    const stored = db.$client.prepare("select name, sql from sqlite_master where type = 'trigger' and name like 'topic\\_%' escape '\\'").all() as { name: string; sql: string }[];
    expect(Object.fromEntries(stored.map((row) => [row.name, row.sql]))).toEqual(Object.fromEntries(topicTriggerSql()));
  });
});

/** Runs a write and returns the topics that went out for each scope (a project id, or 'app' for the app's own). */
function topicsOf(write: () => void) {
  events.flush();
  const seen: ChangeEvent[] = [];
  const listen = (event: ChangeEvent) => seen.push(event);
  events.on('change', listen);
  write();
  events.flush();
  events.off('change', listen);
  return Object.fromEntries(seen.map((event) => [event.projectId ?? 'app', [...event.topics].sort()]));
}

describe('a row written with a plain statement', () => {
  it('says its topic and the ones it implies, on insert, update and delete, for every table', () => {
    const db = openDatabase(':memory:');
    const written = rows(db);
    expect([...new Set(written.map((row) => row.table))].sort()).toEqual(schemaTables().sort());
    const said = (row: (typeof written)[number]) => (row.topics.length ? { [row.scope]: [...withImplied(row.topics)].sort() } : {});
    // Other tables' triggers may add to it (a line's insert writes its history); the row's own topics are always there.
    const expectSaid = (row: (typeof written)[number], op: string, got: Record<string, string[]>) => {
      for (const [scope, topics] of Object.entries(said(row))) expect(got[scope] ?? [], `${op} ${row.table}`).toEqual(expect.arrayContaining(topics));
      if (!row.topics.length) expect(got, `${op} ${row.table}`).toEqual({});
    };
    for (const row of written) expectSaid(row, 'insert', topicsOf(row.insert));
    // The last row written of each table, updated in place and then deleted, children before their parents.
    const last = new Map(written.map((row) => [row.table, row] as const));
    for (const row of last.values()) expectSaid(row, 'update', topicsOf(() => db.$client.prepare(`update \`${row.table}\` set rowid = rowid where rowid = (select max(rowid) from \`${row.table}\`)`).run()));
    for (const row of [...last.values()].reverse()) expectSaid(row, 'delete', topicsOf(() => db.$client.prepare(`delete from \`${row.table}\` where rowid = (select max(rowid) from \`${row.table}\`)`).run()));
  });

  it('says nothing for a row whose parent went first, and the parent says it', () => {
    const db = openDatabase(':memory:');
    for (const row of rows(db)) row.insert();
    // The line's tags, history and candidates go with it (cascade): their triggers find no line any more.
    expect(topicsOf(() => db.delete(s.units).run())).toEqual({ p1: [...withImplied(['units'])].sort() });
    // A tag's rows on knowledge go after it; the items they were on are still there and say their topic.
    expect(topicsOf(() => db.delete(s.tags).run()).p1).toEqual([...withImplied(['statuses', 'terms', 'knowledge'])].sort());
  });
});
