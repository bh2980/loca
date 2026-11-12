import { EventEmitter } from 'node:events';
import type { Db } from '../db/index.ts';
import { perDatabase } from '../db/per-database.ts';

/*
 * A run set going again from outside the runner's own tick (continueRun: a resume, failed lines queued
 * again). A runner that put the run to sleep until a retry wait is due takes it up now instead of then.
 * The service that changes the run calls wakeRun; the database's started runner listens.
 */
const woken = perDatabase(() => new EventEmitter());

export const wakeRun = (db: Db, runId: string) => void woken(db).emit('wake', runId);

/** Hears every wakeRun of the database; returns how to stop hearing. */
export function onRunWake(db: Db, listener: (runId: string) => void) {
  woken(db).on('wake', listener);
  return () => void woken(db).off('wake', listener);
}
