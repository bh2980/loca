import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { registerMigrationFunctions } from './index.ts';

const drizzleDir = path.resolve(import.meta.dirname, '../../drizzle');
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('legacy columns migration (0126)', () => {
  it('drops the old route state and replaces agent_settings without touching the project or what hangs under it', () => {
    const previous = mkdtempSync(path.join(os.tmpdir(), 'tw-legacy-columns-'));
    temporary.push(previous);
    cpSync(drizzleDir, previous, { recursive: true });
    const journalPath = path.join(previous, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < 126) }));

    const sqlite = new Database(':memory:');
    registerMigrationFunctions(sqlite);
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    const now = Date.now();
    migrate(db, { migrationsFolder: previous });
    sqlite.prepare('insert into projects (id, name, source_language, target_language, agent_settings, route_picks, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('p1', 'Fixture', 'en', 'ko', JSON.stringify({ disabledTools: ['save_character'], terminalPermissionMode: 'auto' }), JSON.stringify({ fork: 'arm' }), now, now);
    sqlite.prepare('insert into statuses (id, project_id, name, color, kind, sort) values (?, ?, ?, ?, ?, ?)').run('s1', 'p1', '미번역', '#000000', 'initial', 0);

    migrate(db, { migrationsFolder: drizzleDir });
    const columns = (table: string) => (sqlite.prepare(`select name from pragma_table_info('${table}')`).all() as { name: string }[]).map((column) => column.name);
    for (const gone of ['route_picks', 'join_checks', 'route_state', 'agent_settings_next']) expect(columns('projects')).not.toContain(gone);
    expect(columns('app_settings')).not.toContain('done');
    // The project's row and its children are still there: the table was not recreated.
    expect(JSON.parse((sqlite.prepare('select agent_settings from projects where id = ?').get('p1') as { agent_settings: string }).agent_settings)).toEqual({ terminalPermissionMode: 'auto' });
    expect(sqlite.prepare('select count(*) as n from statuses where project_id = ?').get('p1')).toEqual({ n: 1 });
    sqlite.prepare('insert into projects (id, name, source_language, target_language, created_at, updated_at) values (?, ?, ?, ?, ?, ?)').run('p2', 'New', 'en', 'ko', now, now);
    expect(sqlite.prepare('select agent_settings from projects where id = ?').get('p2')).toEqual({ agent_settings: '{}' });
    // The row feed's triggers on projects survived the column changes.
    expect((sqlite.prepare("select count(*) as n from sqlite_master where type = 'trigger' and tbl_name = 'projects'").get() as { n: number }).n).toBeGreaterThanOrEqual(5);
    sqlite.close();
  });
});
