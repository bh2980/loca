import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { exclusionRulesSchema, formatRulesSchema, lineExclusion, needsListener, type LineTranslate } from '@tw/shared';
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

/** The JS functions migrations call (a bare database migrated in a test needs them too). */
export function registerMigrationFunctions(sqlite: Database.Database) {
  // issue_tag_nodes(definition json, role → tag id json): a workflow's 태그 붙이기 nodes once tags have no roles (0102):
  // the problem types it named (kinds, every kind) become those tags' ids, and a node reading a result field gets the
  // kind → tag map it used to find by role. Any other node is left as it is.
  sqlite.function('issue_tag_nodes', { deterministic: true }, (definition: unknown, roles: unknown) => {
    if (typeof definition !== 'string') return definition;
    const byRole = JSON.parse(typeof roles === 'string' && roles ? roles : '{}') as Record<string, string>;
    const parsed = JSON.parse(definition) as { nodes?: { config?: { fn?: string; params?: Record<string, unknown> } }[] };
    for (const node of parsed.nodes ?? []) {
      const params = node.config?.fn === 'tagLines' ? node.config.params : undefined;
      if (!params) continue;
      const kinds = params.allKinds ? Object.keys(byRole) : Array.isArray(params.kinds) ? (params.kinds as string[]) : [];
      const tagIds = [...new Set([...(Array.isArray(params.tagIds) ? (params.tagIds as string[]) : []), ...kinds.flatMap((kind) => (byRole[kind] ? [byRole[kind]] : []))])];
      const reads = (params.map as Record<string, string> | undefined)?.tag;
      node.config!.params = { ...Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'kinds' && key !== 'allKinds')), tagIds, categoryTags: reads ? { ...byRole, ...((params.categoryTags as Record<string, string>) ?? {}) } : ((params.categoryTags as Record<string, string>) ?? {}) };
    }
    return JSON.stringify(parsed);
  });
  // fact_conditions(definition json): a condition that asked for one of the automatic tags that became row facts (0105)
  // asks for that fact instead: {"in": ["remaining", {"var": "unit.marks"}]} → {"!": [{"!!": [{"var": "unit.final"}]}]}, and so on.
  const FACT_RULES: Record<string, unknown> = {
    remaining: { '!': [{ '!!': [{ var: 'unit.final' }] }] },
    ai: { '==': [{ var: 'unit.statusBy' }, 'ai'] },
    unknownListener: { '!!': [{ var: 'unit.listenerUnknown' }] },
    noted: { '!!': [{ var: 'unit.noted' }] },
  };
  const rewrite = (rule: unknown): unknown => {
    if (Array.isArray(rule)) return rule.map(rewrite);
    if (!rule || typeof rule !== 'object') return rule;
    const entries = Object.entries(rule as Record<string, unknown>);
    const [name, args] = entries[0] ?? [];
    if (entries.length === 1 && name === 'in' && Array.isArray(args) && typeof args[0] === 'string' && FACT_RULES[args[0]] && (args[1] as { var?: unknown } | undefined)?.var === 'unit.marks') return FACT_RULES[args[0]];
    return Object.fromEntries(entries.map(([key, value]) => [key, rewrite(value)]));
  };
  sqlite.function('fact_conditions', { deterministic: true }, (definition: unknown) => {
    if (typeof definition !== 'string') return definition;
    const parsed = JSON.parse(definition) as { nodes?: { type?: string; config?: { expression?: unknown } }[] };
    for (const node of parsed.nodes ?? []) if (node.type === 'condition' && node.config && 'expression' in node.config) node.config.expression = rewrite(node.config.expression);
    return JSON.stringify(parsed);
  });
}

export function openDatabase(file: string, folder = migrationsFolder) {
  const existed = file !== ':memory:' && existsSync(file);
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    // needs_listener(kind, speaker, source, format_rules json): needsListener in shared itself, so the
    // line marks' SQL (line-marks.ts) decides exactly as the code does (whitespace, format tokens).
    const rulesOf = new Map<string, ReturnType<typeof formatRulesSchema.parse>>();
    sqlite.function('needs_listener', { deterministic: true }, (kind: unknown, speaker: unknown, source: unknown, rules: unknown) => {
      const key = typeof rules === 'string' ? rules : '';
      if (!rulesOf.has(key)) rulesOf.set(key, formatRulesSchema.parse(key ? JSON.parse(key) : {}));
      return needsListener({ kind: String(kind), speaker: typeof speaker === 'string' ? speaker : null, source: String(source ?? '') }, rulesOf.get(key)) ? 1 : 0;
    });
    // exclusion_reason(source, translate, format_rules json, exclusion_rules json, source_language): lineExclusion
    // in shared itself, so 번역 제외 in SQL (line-marks.ts) is what the app shows. Null = for translation.
    const exclusionsOf = new Map<string, ReturnType<typeof exclusionRulesSchema.parse>>();
    sqlite.function('exclusion_reason', { deterministic: true }, (source: unknown, translate: unknown, format: unknown, rules: unknown, language: unknown) => {
      const formatKey = typeof format === 'string' ? format : '';
      if (!rulesOf.has(formatKey)) rulesOf.set(formatKey, formatRulesSchema.parse(formatKey ? JSON.parse(formatKey) : {}));
      const rulesKey = typeof rules === 'string' ? rules : '';
      if (!exclusionsOf.has(rulesKey)) exclusionsOf.set(rulesKey, exclusionRulesSchema.parse(rulesKey ? JSON.parse(rulesKey) : {}));
      return lineExclusion({ source: String(source ?? ''), translate: (translate as LineTranslate | null) ?? null }, rulesOf.get(formatKey), exclusionsOf.get(rulesKey), typeof language === 'string' ? language : null);
    });
    registerMigrationFunctions(sqlite);
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
