import { or, sql, type SQL } from 'drizzle-orm';
import * as s from '../db/schema.ts';

/**
 * A line's text search — source, translation, speaker or key contains `q` as written — shared by
 * the app's list and the CLI/chat (findLines), so the same words find the same lines. %, _ and \
 * are plain characters. Trigram FTS needs 3+ characters; shorter queries fall back to LIKE.
 */
export function lineTextFilter(q: string): SQL {
  if ([...q].length >= 3) {
    const phrase = `"${q.replace(/"/g, '""')}"`;
    return sql`${s.units}.rowid in (select rowid from units_fts where units_fts match ${phrase})`;
  }
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return or(
    sql`${s.units.source} like ${pattern} escape '\\'`,
    sql`${s.units.translation} like ${pattern} escape '\\'`,
    sql`${s.units.speaker} like ${pattern} escape '\\'`,
    sql`${s.units.key} like ${pattern} escape '\\'`,
  )!;
}
