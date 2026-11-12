import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * estimateTokens (@loca/shared: UTF-8 bytes / 4, rounded up) of a text column, computed by SQLite so a
 * query that only sizes lines does not load their text. Every place that plans or packs by tokens reads
 * the same number.
 */
export const tokensSql = (column: SQLiteColumn | SQL) => sql<number>`(length(cast(${column} as blob)) + 3) / 4`;
