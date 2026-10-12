import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { backupBeforeMigration, openDatabase, pendingMigrations } from './index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'loca-migrate-'));
  dirs.push(dir);
  return dir;
};

describe('migration safety', () => {
  it('does not back up a brand-new database', () => {
    const file = path.join(tmp(), 'data', 'workbench.sqlite');
    openDatabase(file).$client.close();
    expect(existsSync(path.join(path.dirname(file), 'backups'))).toBe(false);
  });

  it('does not back up an up-to-date database on reopen', () => {
    const file = path.join(tmp(), 'workbench.sqlite');
    openDatabase(file).$client.close();
    openDatabase(file).$client.close();
    expect(existsSync(path.join(path.dirname(file), 'backups'))).toBe(false);
  });

  it('backs up an existing database with pending migrations, keeping the newest 3', () => {
    const dir = tmp();
    const file = path.join(dir, 'workbench.sqlite');
    openDatabase(file).$client.close();
    // Pretend the last migration was never applied.
    const raw = new Database(file);
    raw.prepare('delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations)').run();
    expect(pendingMigrations(raw, path.resolve(import.meta.dirname, '../../drizzle'))).toBe(1);
    raw.close();

    const backups = path.join(dir, 'backups');
    mkdirSync(backups);
    for (const stamp of ['2020-01-01', '2020-01-02', '2020-01-03']) writeFileSync(path.join(backups, `workbench-${stamp}.sqlite`), '');
    // Re-opening reruns the last migration on a database that already has its effect: that
    // may fail, which is irrelevant here; the backup must exist before migrating either way.
    try {
      openDatabase(file).$client.close();
    } catch {}
    const names = readdirSync(backups).sort();
    expect(names).toHaveLength(3);
    expect(names).not.toContain('workbench-2020-01-01.sqlite');
    const newest = names.at(-1)!;
    const copy = new Database(path.join(backups, newest), { readonly: true });
    expect(copy.prepare("select count(*) as n from sqlite_master where name = 'units'").get()).toEqual({ n: 1 });
    copy.close();
  });

  it('backupBeforeMigration is a no-op with nothing pending', () => {
    const dir = tmp();
    const file = path.join(dir, 'workbench.sqlite');
    const db = openDatabase(file);
    expect(backupBeforeMigration(db.$client, file, path.resolve(import.meta.dirname, '../../drizzle'))).toBeNull();
    db.$client.close();
  });
});
