import { useSyncExternalStore } from 'react';

/**
 * 최근 실행's 지우기: when this browser last cleared the status bar's list of finished runs, per project. It only hides
 * them there (the runs page keeps every run), so it is a convenience kept in the browser, not in the project.
 */
const KEY = (projectId: string) => `tw.recentRuns.clearedAt.${projectId}`;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const read = (projectId: string) => {
  try {
    return Number(localStorage.getItem(KEY(projectId))) || 0;
  } catch {
    return 0;
  }
};
/** Kept here too, so 지우기 works where the browser stores nothing (private mode). */
const memory = new Map<string, number>();

export function useRecentRunsCleared(projectId: string): [number, () => void] {
  const clearedAt = useSyncExternalStore(subscribe, () => Math.max(read(projectId), memory.get(projectId) ?? 0), () => 0);
  const clear = () => {
    const now = Date.now();
    memory.set(projectId, now);
    try {
      localStorage.setItem(KEY(projectId), String(now));
    } catch {
      /* private mode: memory holds it for this visit */
    }
    for (const listener of listeners) listener();
  };
  return [clearedAt, clear];
}

/** Whether a run still shows under 최근 실행 after a 지우기 at `clearedAt`: a run going on always does; a finished one if it ended after. */
export function shownAfterClear(run: { status: string; createdAt: unknown; finishedAt: unknown }, clearedAt: number) {
  if (run.status === 'running' || run.status === 'paused') return true;
  const ended = new Date((run.finishedAt ?? run.createdAt) as string | number).getTime();
  return !(ended <= clearedAt);
}
