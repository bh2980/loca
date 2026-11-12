import { EventEmitter } from 'node:events';

/*
 * A run set going again from outside the runner's own tick (continueRun: a resume, failed lines queued
 * again). A runner that put the run to sleep until a retry wait is due takes it up now instead of then.
 * The service that changes the run calls wakeRun; a started runner listens.
 */
const woken = new EventEmitter();

export const wakeRun = (runId: string) => void woken.emit('wake', runId);

/** Hears every wakeRun; returns how to stop hearing. */
export function onRunWake(listener: (runId: string) => void) {
  woken.on('wake', listener);
  return () => void woken.off('wake', listener);
}
