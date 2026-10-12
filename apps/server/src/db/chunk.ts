import { inArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * SQLite refuses a statement with more than 32,766 bound variables, and a project can have
 * 50,000 lines. Any `inArray` over ids whose count grows with the project goes through these.
 */
export const CHUNK = 5_000;

/** Runs `query` on slices of `ids` and concatenates the rows. */
export function inChunks<T>(ids: readonly string[], query: (slice: string[]) => T[], size = CHUNK): T[] {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let index = 0; index < unique.length; index += size) rows.push(...query(unique.slice(index, index + size)));
  return rows;
}

/** Runs `write` on slices of `ids`, for updates and deletes. */
export function eachChunk(ids: readonly string[], write: (slice: string[]) => void, size = CHUNK) {
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += size) write(unique.slice(index, index + size));
}

/**
 * `column in (...)` for a list of any size, to be composed into a larger `where`. Short lists bind
 * one variable per value; long ones travel as a single JSON parameter read by `json_each`.
 */
export function inList(column: SQLiteColumn, values: readonly string[], size = 500): SQL {
  if (values.length <= size) return inArray(column, [...values]);
  return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}
