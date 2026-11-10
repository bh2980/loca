import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRuns, type Run } from './runs';

/** A run that ended while the project was open: what the bell (알림) lists until someone opens it. */
export type RunNews = Pick<Run, 'id' | 'workflowName' | 'status' | 'total' | 'subject' | 'notice'>;

const EMPTY: RunNews[] = [];
const news = new Map<string, RunNews[]>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Puts a run's end in the bell (once per run; a later end of the same run replaces it). */
export function addRunNews(projectId: string, run: RunNews) {
  news.set(projectId, [run, ...(news.get(projectId) ?? EMPTY).filter((entry) => entry.id !== run.id)]);
  changed();
}

/** Read: the bell was opened and closed, so these are no longer new. */
export function clearRunNews(projectId: string) {
  if (!news.get(projectId)?.length) return;
  news.delete(projectId);
  changed();
}

/** The runs that ended since the bell was last opened, newest first. */
export function useRunNews(projectId: string) {
  return useSyncExternalStore(subscribe, () => news.get(projectId) ?? EMPTY, () => EMPTY);
}

/**
 * Long work ends while the user is elsewhere: a workflow run that finishes or pauses goes into the bell (알림) in the
 * status bar, with a count on it, instead of a toast of its own. Only changes seen while the project is open count
 * (nothing on first load); a run someone cancelled is not news.
 */
export function useJobNotices(projectId: string) {
  const runs = useRuns(projectId);
  const seen = useRef(new Map<string, string>());

  useEffect(() => {
    for (const run of runs.data ?? []) {
      const before = seen.current.get(run.id);
      seen.current.set(run.id, run.status);
      if (before === 'running' && (run.status === 'completed' || run.status === 'paused'))
        addRunNews(projectId, { id: run.id, workflowName: run.workflowName, status: run.status, total: run.total, subject: run.subject, notice: run.notice });
    }
  }, [runs.data, projectId]);
}
