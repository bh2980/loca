/**
 * The browser's collections (TanStack DB) and the server's row feed that keeps them current: the
 * database reports every changed row (triggers, apps/server/drizzle/0106_row_feed.sql), and each change
 * event carries those rows as the snapshot has them, so the browser patches rows instead of refetching.
 */
export const FEED_COLLECTIONS = ['terms'] as const;
export type FeedCollection = (typeof FEED_COLLECTIONS)[number];

/** One collection's part of a change event: rows to put, read again when the event was sent, and ids no longer listed. */
export interface FeedChanges {
  upsert: Record<string, unknown>[];
  delete: string[];
}
export type FeedRows = Partial<Record<FeedCollection, FeedChanges>>;

/** A collection's rows as they are at `seq`: what the browser loads first (GET /projects/:id/sync/:collection). */
export interface FeedSnapshot {
  seq: number;
  rows: Record<string, unknown>[];
}
