import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { formatRulesSchema, hasText } from '@tw/shared';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const KEEP_BACKUPS = 3;

/** Journal entries drizzle would still run: newer than the last applied one (its own rule). */
export function pendingMigrations(sqlite: Database.Database, folder: string): number {
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as { entries: { when: number }[] };
  const hasTable = sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  const last = hasTable ? (sqlite.prepare('select max(created_at) as last from __drizzle_migrations').get() as { last: number | null }).last : null;
  return journal.entries.filter((entry) => last === null || Number(last) < entry.when).length;
}

/**
 * Drizzle runs every pending migration in one transaction, where `PRAGMA foreign_keys = OFF` is
 * ignored: a migration that recreates a parent table cascades deletes into its children. So an
 * existing database is copied (VACUUM INTO) before it is migrated. Returns the backup's path.
 */
export function backupBeforeMigration(sqlite: Database.Database, file: string, folder: string, now = new Date()): string | null {
  if (!pendingMigrations(sqlite, folder)) return null;
  const dir = path.join(path.dirname(file), 'backups');
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `workbench-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`);
  sqlite.prepare('vacuum into ?').run(target);
  const old = readdirSync(dir)
    .filter((name) => /^workbench-.*\.sqlite$/.test(name))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const name of old) rmSync(path.join(dir, name), { force: true });
  return target;
}

export function openDatabase(file: string, folder = migrationsFolder) {
  const existed = file !== ':memory:' && existsSync(file);
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    // has_text(source, format_rules json): hasText in shared, for the line marks' SQL (line-marks.ts).
    const rulesOf = new Map<string, ReturnType<typeof formatRulesSchema.parse>>();
    sqlite.function('has_text', { deterministic: true }, (source: unknown, rules: unknown) => {
      const key = typeof rules === 'string' ? rules : '';
      if (!rulesOf.has(key)) rulesOf.set(key, formatRulesSchema.parse(key ? JSON.parse(key) : {}));
      return hasText(String(source ?? ''), rulesOf.get(key)) ? 1 : 0;
    });
    const backup = existed ? backupBeforeMigration(sqlite, file, folder) : null;
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: folder });
    const broken = sqlite.pragma('foreign_key_check') as { table: string }[];
    if (broken.length) {
      const tables = [...new Set(broken.map((row) => row.table))].join(', ');
      throw new Error(`마이그레이션 뒤 외래 키가 깨졌습니다 (${tables}, ${broken.length}건).${backup ? ` 백업: ${backup}` : ''}`);
    }
    return db;
  } catch (error) {
    // Windows keeps the database files locked until the failed initialization closes its handle.
    sqlite.close();
    throw error;
  }
}

export type Db = ReturnType<typeof openDatabase>;
export { schema };
