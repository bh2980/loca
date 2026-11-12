import type Database from 'better-sqlite3';

/** Any handle on an open database: the connection itself, drizzle's `db` (its `$client`) or a transaction of it (its session's client, which drizzle's types keep to themselves). */
export type DatabaseHandle = object;

/** The connection behind a handle. */
export function sqliteOf(handle: DatabaseHandle): Database.Database {
  const given = handle as { $client?: Database.Database; session?: { client?: Database.Database } };
  const client = given.$client ?? given.session?.client ?? (handle as Database.Database);
  if (typeof (client as { prepare?: unknown }).prepare !== 'function') throw new Error('not a database handle');
  return client;
}

/**
 * State the server keeps in memory for one open database: turns in progress, layout jobs, caches, the change
 * events. It is made on first use and goes when the connection does. A module-level Map keyed by a project,
 * conversation or run id would instead be one for every database the process has open (a test file opens many,
 * and their rows share ids), and would outlive them all.
 */
export function perDatabase<T>(make: (sqlite: Database.Database) => T): (handle: DatabaseHandle) => T {
  const all = new WeakMap<Database.Database, T>();
  return (handle) => {
    const sqlite = sqliteOf(handle);
    let state = all.get(sqlite);
    if (state === undefined) all.set(sqlite, (state = make(sqlite)));
    return state;
  };
}
