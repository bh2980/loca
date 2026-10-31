import type Database from 'better-sqlite3';

type Op = 'upsert' | 'delete';

/**
 * Rows of the browser's collections changed since the row feed last sent them, noted by the
 * database's triggers (row_changed, 0106_row_feed.sql). Only ids: the feed reads each row again when
 * it sends, so a row changed many times goes out once, as it is then. `seq` counts every change of
 * this process; a snapshot and each event carry it, so the browser drops an event older than its snapshot.
 */
export class RowChanges {
  seq = 0;
  private pending = new Map<string, Map<string, Map<string, Op>>>();
  /** Told of each change (the app schedules a change event for the project). */
  listener?: (projectId: string, seq: number) => void;

  note(collection: string, rowId: string, op: Op, projectId: string | null) {
    // An item already gone (its tags removed after it): its own delete was noted.
    if (!projectId) return;
    this.seq += 1;
    const project = this.pending.get(projectId) ?? new Map<string, Map<string, Op>>();
    const rows = project.get(collection) ?? new Map<string, Op>();
    rows.set(rowId, op);
    project.set(collection, rows);
    this.pending.set(projectId, project);
    this.listener?.(projectId, this.seq);
  }

  /** The project's changed rows, by collection, and forget them. */
  take(projectId: string) {
    const project = this.pending.get(projectId);
    this.pending.delete(projectId);
    return project ?? new Map<string, Map<string, Op>>();
  }
}

const recorders = new WeakMap<Database.Database, RowChanges>();

/** The connection's recorder (one per database file opened). */
export function rowChangesOf(sqlite: Database.Database) {
  let recorder = recorders.get(sqlite);
  if (!recorder) {
    recorder = new RowChanges();
    recorders.set(sqlite, recorder);
  }
  return recorder;
}
