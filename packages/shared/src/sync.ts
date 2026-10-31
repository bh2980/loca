/**
 * The browser's collections (TanStack DB) and the server's row feed that keeps them current: the
 * database reports every changed row (triggers, apps/server/drizzle/0106_row_feed.sql and the row_feed migrations after it), and each change
 * event carries those rows as the snapshot has them, so the browser patches rows instead of refetching.
 */
export const FEED_COLLECTIONS = ['terms', 'characters', 'relationships', 'speechRules', 'documents', 'statuses', 'tags', 'groups', 'runs', 'project', 'speakers', 'listeners', 'units'] as const;
export type FeedCollection = (typeof FEED_COLLECTIONS)[number];
/**
 * The collections the browser loads whole. Lines are too many: it holds the ones it shows (POST
 * units/by-ids), and the feed says which lines changed (`changed`) so it reads again only those it holds.
 */
export const SNAPSHOT_COLLECTIONS = FEED_COLLECTIONS.filter((name): name is Exclude<FeedCollection, 'units'> => name !== 'units');
export type SnapshotCollection = (typeof SNAPSHOT_COLLECTIONS)[number];
/** More changed lines than this in one event go out as `reload` instead of ids (a bulk change, an import). */
export const FEED_UNITS_LIMIT = 500;

/** One collection's part of a change event: rows to put, read again when the event was sent, and ids no longer listed. */
export interface FeedChanges {
  upsert: Record<string, unknown>[];
  delete: string[];
  /** Lines only: the lines whose rows changed (not their rows); the browser reads again the ones it holds. */
  changed?: string[];
  /** Lines only: too many changed to name (FEED_UNITS_LIMIT): read again every line held. */
  reload?: true;
}
export type FeedRows = Partial<Record<FeedCollection, FeedChanges>>;

/** A collection's rows as they are at `seq`: what the browser loads first (GET /projects/:id/sync/:collection). */
export interface FeedSnapshot {
  seq: number;
  rows: Record<string, unknown>[];
}
