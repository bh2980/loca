import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { q } from '@/lib/queries';

/**
 * Long work ends while the user is elsewhere: a workflow run
 * that finishes, fails or pauses says so wherever they are, with what came out and a way to it.
 * Only changes seen while the project is open are announced (nothing on first load).
 */
export function useJobNotices(projectId: string) {
  const navigate = useNavigate();
  const runs = useQuery(q.runs(projectId));
  const seen = useRef(new Map<string, string>());

  useEffect(() => {
    const items = [
      ...(runs.data ?? []).map((run) => ({ id: run.id, status: run.status, notice: () => runNotice(run) })),
    ];
    for (const item of items) {
      const before = seen.current.get(item.id);
      seen.current.set(item.id, item.status);
      if (before === 'running' && item.status !== 'running') item.notice();
    }

    function runNotice(run: NonNullable<typeof runs.data>[number]) {
      const open = { label: '실행 보기', onClick: () => void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.id } }) };
      if (run.status === 'completed') toast.success(`‘${run.workflowName}’ 실행이 끝났습니다`, { description: `${run.total.toLocaleString()}${run.subject === 'terms' ? '개' : '줄'}`, action: open, duration: 15_000 });
      else if (run.status === 'paused') toast.warning(`‘${run.workflowName}’ 실행이 멈췄습니다`, { description: run.notice ?? undefined, action: open, duration: 15_000 });
    }
  }, [runs.data, navigate, projectId]);
}
