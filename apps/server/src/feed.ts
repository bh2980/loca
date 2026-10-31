import { and, asc, eq, ne } from 'drizzle-orm';
import type { FeedCollection, FeedRows, FeedSnapshot } from '@tw/shared';
import type { Db } from './db/index.ts';
import { inList } from './db/chunk.ts';
import { rowChangesOf } from './db/row-changes.ts';
import * as s from './db/schema.ts';
import { withTags } from './services/knowledge-tags.ts';
import { fillTermUsage } from './services/term-usage.ts';

/**
 * The row feed: what the browser's collections hold, read the same way for the first load (snapshot)
 * and for each change event (the rows the database noted, db/row-changes.ts). A row a collection no
 * longer lists (deleted, or a rejected term) goes out as a delete.
 */

/** The project's terms as the glossary lists them (not rejected), with their tags; only `ids` when given. */
export function termRows(db: Db, projectId: string, ids?: readonly string[]) {
  const where = and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'), ids ? inList(s.terms.id, ids) : undefined);
  return withTags(db, 'terms', db.select().from(s.terms).where(where).orderBy(asc(s.terms.source)).all());
}

const READERS: Record<FeedCollection, (db: Db, projectId: string, ids?: readonly string[]) => { id: string }[]> = {
  terms: termRows,
};

/** A collection's rows now and the feed's count, for the browser's first load. */
export function feedSnapshot(db: Db, projectId: string, collection: FeedCollection): FeedSnapshot {
  // Usage counts are filled when first read; the writes are noted like any other and come again as events.
  if (collection === 'terms') fillTermUsage(db, projectId);
  const rows = READERS[collection](db, projectId);
  return { seq: rowChangesOf(db.$client).seq, rows };
}

/** The project's rows changed since the last event, read again now; null when none. */
export function feedRows(db: Db, projectId: string): { rows: FeedRows; seq: number } | null {
  const changes = rowChangesOf(db.$client).take(projectId);
  if (!changes.size) return null;
  const rows: FeedRows = {};
  for (const [collection, changed] of changes) {
    const read = READERS[collection as FeedCollection];
    if (!read) continue;
    const ids = [...changed.keys()];
    const upsert = read(db, projectId, ids);
    const listed = new Set(upsert.map((row) => row.id));
    rows[collection as FeedCollection] = { upsert, delete: ids.filter((id) => !listed.has(id)) };
  }
  return { rows, seq: rowChangesOf(db.$client).seq };
}
