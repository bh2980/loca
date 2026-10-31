import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { registerMigrationFunctions } from './index.ts';
import { afterEach, describe, expect, it } from 'vitest';

const drizzleDir = path.resolve(import.meta.dirname, '../../drizzle');
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('graph layout direction migration', () => {
  it('preserves existing layouts as vertical and allows an independent horizontal variant', () => {
    const previous = mkdtempSync(path.join(os.tmpdir(), 'tw-graph-direction-'));
    temporary.push(previous);
    cpSync(drizzleDir, previous, { recursive: true });
    const journalPath = path.join(previous, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < 61) }));

    const sqlite = new Database(':memory:');
    registerMigrationFunctions(sqlite);
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    const now = Date.now();
    migrate(db, { migrationsFolder: previous });
    sqlite.prepare('insert into projects (id, name, source_language, target_language, created_at, updated_at) values (?, ?, ?, ?, ?, ?)').run('p1', 'Graph fixture', 'en', 'ko', now, now);
    const original = JSON.stringify({ version: 7, width: 400, height: 600, nodes: [{ id: 'n1', x: 16, y: 24, width: 260, height: 76 }], edges: [] });
    sqlite.prepare('insert into graph_layouts (project_id, scope, section, status, data, error, updated_at) values (?, ?, ?, ?, ?, ?, ?)').run('p1', 'dialogue', '', 'ready', original, null, now);

    migrate(db, { migrationsFolder: drizzleDir });
    const migrated = sqlite.prepare('select direction, status, data from graph_layouts where project_id = ?').get('p1') as { direction: string; status: string; data: string };
    expect(migrated).toEqual({ direction: 'vertical', status: 'ready', data: original });

    sqlite.prepare('insert into graph_layouts (project_id, scope, section, direction, status, data, error, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'dialogue', '', 'horizontal', 'ready', JSON.stringify({ version: 8, width: 900, height: 300, nodes: [], edges: [] }), null, now);
    expect(sqlite.prepare('select direction from graph_layouts where project_id = ? order by direction').all('p1')).toEqual([{ direction: 'horizontal' }, { direction: 'vertical' }]);
    sqlite.close();
  });
});
