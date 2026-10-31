import { useQuery } from '@tanstack/react-query';
import { useTaxonomy } from './knowledge';
import { q } from './queries';
import { useRuns } from './runs';

/** Shared project translation totals and currently running workflow runs. */
export function useProgress(projectId: string) {
  const project = useQuery(q.project(projectId));
  const { statuses } = useTaxonomy(projectId);
  const runs = useRuns(projectId);
  const counts = Object.fromEntries(project.data?.byStatus.map((row) => [row.statusId, row.count]) ?? []);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const finalIds = new Set((statuses ?? []).filter((status) => status.kind === 'final').map((status) => status.id));
  const done = Object.entries(counts).reduce((sum, [id, value]) => sum + (finalIds.has(id) ? value : 0), 0);
  const runningRuns = runs.data?.filter((run) => run.status === 'running').length ?? 0;
  const allRuns = runs.data ?? [];
  const activeRuns = allRuns.filter((run) => run.status === 'running' || run.status === 'paused');
  const recentRuns = allRuns.slice(0, 5);
  const reviewCount = project.data?.reviewCount ?? 0;
  return { counts, total, done, statuses: statuses ?? [], runningRuns, activeRuns, recentRuns, reviewCount };
}
