import { useTaxonomy } from './knowledge';
import { useRuns } from './runs';
import { useProjectProgress } from './project';

/** Shared project translation totals and currently running workflow runs. */
export function useProgress(projectId: string) {
  const progress = useProjectProgress(projectId);
  const { statuses } = useTaxonomy(projectId);
  const runs = useRuns(projectId);
  const counts = progress?.byStatus ?? {};
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const finalIds = new Set((statuses ?? []).filter((status) => status.kind === 'final').map((status) => status.id));
  const done = Object.entries(counts).reduce((sum, [id, value]) => sum + (finalIds.has(id) ? value : 0), 0);
  const runningRuns = runs.data?.filter((run) => run.status === 'running').length ?? 0;
  const allRuns = runs.data ?? [];
  const activeRuns = allRuns.filter((run) => run.status === 'running' || run.status === 'paused');
  const recentRuns = allRuns.slice(0, 5);
  const reviewCount = progress?.reviewCount ?? 0;
  return { counts, total, done, statuses: statuses ?? [], runningRuns, activeRuns, recentRuns, reviewCount };
}
