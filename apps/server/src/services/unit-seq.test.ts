import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { importFileSchema, lineFilterSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { sourceRoutes } from '../routes/source.ts';
import { importProject } from './importer.ts';
import { registerMigrationFunctions } from '../db/index.ts';
import { findLines } from './script-query.ts';

const drizzleDir = path.resolve(import.meta.dirname, '../../drizzle');

// Two scenes with the same `sort`, units numbered per scene: the old two-table order interleaved them.
function interleaved() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Seq' },
    groups: [
      { key: 'zeta', title: 'Zeta', order: 5 },
      { key: 'alpha', title: 'Alpha', order: 5 },
    ],
    units: ['zeta', 'alpha'].flatMap((group) => [0, 1, 2].map((order) => ({ key: `${group}.${order}`, group, order, source: `${group} ${order}` }))),
  });
  const { projectId } = importProject(db, file, null as never);
  return { db, projectId };
}
const expected = ['alpha.0', 'alpha.1', 'alpha.2', 'zeta.0', 'zeta.1', 'zeta.2'];

describe('unit seq', () => {
  it('assigns 0..n-1 at import, by group order then group key, then unit order', () => {
    const { db, projectId } = interleaved();
    const rows = db.select({ key: s.units.key, seq: s.units.seq }).from(s.units).all().sort((a, b) => a.seq - b.seq);
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((row) => row.key)).toEqual(expected);
    expect(projectId).toBeTruthy();
  });

  it('findLines pages scenes unmixed, with no duplicates across pages', () => {
    const { db, projectId } = interleaved();
    const filter = (offset: number) => lineFilterSchema.parse({ offset, limit: 4 });
    const all = findLines(db, projectId, filter(0)).rows.map((row) => row.key);
    expect(all).toEqual(expected.slice(0, 4));
    expect(findLines(db, projectId, filter(4)).rows.map((row) => row.key)).toEqual(expected.slice(4));
  });

  it('the source list route keeps scenes unmixed', async () => {
    const { db, projectId } = interleaved();
    const app = new Hono<Env>().use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    }).route('/', sourceRoutes);
    const page = async (offset: number) => ((await (await app.request(`/projects/${projectId}/units?limit=4&offset=${offset}`)).json()) as { total: number; rows: { key: string }[] });
    const first = await page(0);
    expect(first.total).toBe(6);
    expect([...first.rows, ...(await page(4)).rows].map((row) => row.key)).toEqual(expected);
  });

  it('the migration backfills seq for existing rows', () => {
    const previous = mkdtempSync(path.join(tmpdir(), 'tw-seq-'));
    cpSync(drizzleDir, previous, { recursive: true });
    const journalPath = path.join(previous, 'meta/_journal.json');
    // A database from before the migration: every entry from unit_seq on is left out (drizzle only
    // applies migrations newer than the last applied one, so later ones must not run first).
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] };
    const cut = journal.entries.find((entry) => entry.tag.includes('unit_seq'))!.idx;
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < cut) }));

    const sqlite = new Database(':memory:');
    registerMigrationFunctions(sqlite);
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: previous });
    const now = Date.now();
    sqlite.prepare("insert into projects (id, name, source_language, target_language, created_at, updated_at) values ('p1','P','en','ko',?,?),('p2','Q','en','ko',?,?)").run(now, now, now, now);
    sqlite.prepare("insert into statuses (id, project_id, name, color, kind, sort) values ('s1','p1','a','x','todo',0),('s2','p2','a','x','todo',0)").run();
    const group = sqlite.prepare("insert into groups (id, project_id, key, kind, title, sort) values (?,?,?,'scene',?,?)");
    group.run('g-b', 'p1', 'b', 'B', 1);
    group.run('g-a', 'p1', 'a', 'A', 1); // same sort as g-b: key breaks the tie
    group.run('g-c', 'p1', 'c', 'C', 0);
    group.run('g-q', 'p2', 'q', 'Q', 0);
    const unit = sqlite.prepare("insert into units (id, project_id, group_id, key, sort, kind, source, status_id, updated_at) values (?,?,?,?,?,'dialogue','x',?,?)");
    for (const [group_, project, status] of [['g-b', 'p1', 's1'], ['g-a', 'p1', 's1'], ['g-c', 'p1', 's1']] as const) for (const n of [2, 0, 1]) unit.run(`${group_}.${n}`, project, group_, `${group_}.${n}`, n, status, now);
    unit.run('q.0', 'p2', 'g-q', 'q.0', 0, 's2', now);

    migrate(db, { migrationsFolder: drizzleDir });
    const order = (project: string) => (sqlite.prepare('select id, seq from units where project_id = ? order by seq').all(project) as { id: string; seq: number }[]);
    expect(order('p1').map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(order('p1').map((row) => row.id)).toEqual(['g-c.0', 'g-c.1', 'g-c.2', 'g-a.0', 'g-a.1', 'g-a.2', 'g-b.0', 'g-b.1', 'g-b.2']);
    expect(order('p2')).toEqual([{ id: 'q.0', seq: 0 }]);
    expect(sqlite.prepare("select name from sqlite_master where name = 'units_seq'").get()).toBeTruthy();
  });
});
