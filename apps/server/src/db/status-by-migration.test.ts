import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './index.ts';
import * as s from './schema.ts';

const drizzleFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A migrations folder that stops before `tag`, to build a database as it was then. */
function folderBefore(tag: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'loca-mig-'));
  dirs.push(dir);
  cpSync(drizzleFolder, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((entry) => entry.tag === tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('reviewed → status_by (0037/0038)', () => {
  it('marks AI items no person touched as set by AI, and lines whose translation came from a run', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loca-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'workbench.sqlite');
    openDatabase(file, folderBefore('0037_status_by')).$client.close();

    const raw = new Database(file);
    raw.exec(`
      insert into projects (id, name, source_language, target_language, created_at, updated_at) values ('p', 'P', 'en', 'ko', 0, 0);
      insert into characters (id, project_id, name, status, origin, reviewed, updated_at) values ('ai', 'p', 'Ghost', 'confirmed', 'ai', 0, 0), ('seen', 'p', 'Vera', 'confirmed', 'ai', 1, 0), ('own', 'p', 'Mira', 'confirmed', 'human', 0, 0);
      insert into terms (id, project_id, source, status, origin, reviewed, updated_at) values ('t1', 'p', 'Hollow', 'candidate', 'ai', 0, 0), ('t2', 'p', 'Pat', 'candidate', 'script', 0, 0);
      insert into statuses (id, project_id, name, color, kind, sort) values ('st', 'p', '확정', '#000', 'final', 0);
      insert into groups (id, project_id, key, kind, title, sort) values ('g', 'p', 'g', 'scene', 'G', 0);
      insert into units (id, project_id, group_id, key, sort, kind, source, status_id, candidate_id, updated_at) values ('u1', 'p', 'g', 'u1', 0, 'dialogue', 'a', 'st', 'c1', 0), ('u2', 'p', 'g', 'u2', 1, 'dialogue', 'b', 'st', 'c2', 0);
      insert into candidates (id, unit_id, text, origin, run_id, created_at) values ('c1', 'u1', '가', 'ai', 'run1', 0), ('c2', 'u2', '나', 'human', null, 0);
    `);
    raw.close();

    const db = openDatabase(file, drizzleFolder);
    expect(db.select({ id: s.characters.id, by: s.characters.statusBy }).from(s.characters).orderBy(s.characters.id).all()).toEqual([
      { id: 'ai', by: 'ai' },
      { id: 'own', by: 'human' },
      { id: 'seen', by: 'human' },
    ]);
    expect(db.select({ id: s.terms.id, by: s.terms.statusBy }).from(s.terms).orderBy(s.terms.id).all()).toEqual([
      { id: 't1', by: 'ai' },
      { id: 't2', by: 'human' },
    ]);
    expect(db.select({ id: s.units.id, by: s.units.statusBy, run: s.units.statusRunId }).from(s.units).orderBy(s.units.id).all()).toEqual([
      { id: 'u1', by: 'ai', run: 'run1' },
      { id: 'u2', by: 'human', run: null },
    ]);
    db.$client.close();
  });
});

describe('unique term source (0048)', () => {
  it('renames earlier duplicates instead of failing or deleting them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loca-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'workbench.sqlite');
    openDatabase(file, folderBefore('0048_terms_unique_source')).$client.close();
    const raw = new Database(file);
    raw.exec(`
      insert into projects (id, name, source_language, target_language, created_at, updated_at) values ('p', 'P', 'en', 'ko', 0, 0), ('q', 'Q', 'en', 'ko', 0, 0);
      insert into terms (id, project_id, source, target, updated_at) values ('a', 'p', 'Lieutenant', '경위', 0), ('b', 'p', 'lieutenant', '중위', 0), ('c', 'p', 'LIEUTENANT', '', 0), ('d', 'q', 'Lieutenant', '경위', 0);
    `);
    raw.close();
    const db = openDatabase(file, drizzleFolder);
    const sources = db.select({ id: s.terms.id, source: s.terms.source }).from(s.terms).all().sort((x, y) => x.id.localeCompare(y.id));
    expect(sources.map((term) => term.source)).toEqual(['Lieutenant', expect.stringMatching(/^lieutenant \(중복 \d+\)$/), expect.stringMatching(/^LIEUTENANT \(중복 \d+\)$/), 'Lieutenant']);
  });
});
