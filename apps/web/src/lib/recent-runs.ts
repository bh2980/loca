import { STORED, useStored } from './storage';

/**
 * 최근 실행's 지우기: when this browser last cleared the status bar's list of finished runs, per project. It only hides
 * them there (the runs page keeps every run), so it is a convenience kept in the browser, not in the project.
 */
export function useRecentRunsCleared(projectId: string): [number, () => void] {
  const [clearedAt, set] = useStored(STORED.recentRunsCleared, projectId);
  return [clearedAt, () => set(Date.now())];
}

/** Whether a run still shows under 최근 실행 after a 지우기 at `clearedAt`: a run going on always does; a finished one if it ended after. */
export function shownAfterClear(run: { status: string; createdAt: unknown; finishedAt: unknown }, clearedAt: number) {
  if (run.status === 'preparing' || run.status === 'running' || run.status === 'paused') return true;
  const ended = new Date((run.finishedAt ?? run.createdAt) as string | number).getTime();
  return !(ended <= clearedAt);
}
