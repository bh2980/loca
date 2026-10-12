import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { q } from '@/lib/queries';

const KINDS: Record<string, string> = { documents: '문서', characters: '인물', relationships: '관계', events: '사건', speechRules: '말투 규칙' };

/**
 * Long work ends while the user is elsewhere: a work analysis, a glossary fill or a workflow run
 * that finishes, fails or pauses says so wherever they are, with what came out and a way to it.
 * Only changes seen while the project is open are announced (nothing on first load).
 */
export function useJobNotices(projectId: string) {
  const navigate = useNavigate();
  const analyses = useQuery(q.analysisJobs(projectId));
  const jobs = useQuery(q.jobs(projectId));
  const runs = useQuery(q.runs(projectId));
  const seen = useRef(new Map<string, string>());

  useEffect(() => {
    const items = [
      ...(analyses.data ?? []).map((job) => ({ id: job.id, status: job.status, notice: () => analysisNotice(job) })),
      ...(jobs.data?.jobs ?? []).filter((job) => job.kind === 'terms').map((job) => ({ id: job.id, status: job.status, notice: () => termsNotice(job) })),
      ...(runs.data ?? []).map((run) => ({ id: run.id, status: run.status, notice: () => runNotice(run) })),
    ];
    for (const item of items) {
      const before = seen.current.get(item.id);
      seen.current.set(item.id, item.status);
      if (before === 'running' && item.status !== 'running') item.notice();
    }

    function analysisNotice(job: NonNullable<typeof analyses.data>[number]) {
      const open = { label: '자료 보기', onClick: () => void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: { tab: 'people' } }) };
      if (job.status === 'completed') {
        const result = job.result ?? {};
        const made = Object.entries(KINDS).flatMap(([key, label]) => (result[key] ? [`${label} ${result[key]}`] : []));
        const listeners = result.listeners ? [`청자 ${result.listeners.toLocaleString()}줄`] : [];
        toast.success('작품 분석이 끝났습니다', { description: [...made, ...listeners].join(' · ') || '새로 만든 초안이 없습니다.', action: open, duration: 15_000 });
      } else if (job.status === 'failed') toast.error('작품 분석이 실패했습니다', { description: job.error ?? undefined, action: open, duration: 15_000 });
    }
    function termsNotice(job: NonNullable<typeof jobs.data>['jobs'][number]) {
      const open = { label: '용어집 보기', onClick: () => void navigate({ to: '/p/$projectId/glossary', params: { projectId } }) };
      if (job.status === 'completed') toast.success('용어 번역 채우기가 끝났습니다', { description: `${(job.done ?? 0).toLocaleString()}개 채움 · 확정은 용어집에서`, action: open, duration: 15_000 });
      else if (job.status === 'failed') toast.error('용어 번역 채우기가 실패했습니다', { description: job.error ?? undefined, action: open, duration: 15_000 });
    }
    function runNotice(run: NonNullable<typeof runs.data>[number]) {
      const open = { label: '실행 보기', onClick: () => void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.id } }) };
      if (run.status === 'completed') toast.success(`‘${run.workflowName}’ 실행이 끝났습니다`, { description: `${run.total.toLocaleString()}줄`, action: open, duration: 15_000 });
      else if (run.status === 'paused') toast.warning(`‘${run.workflowName}’ 실행이 멈췄습니다`, { description: run.notice ?? undefined, action: open, duration: 15_000 });
    }
  }, [analyses.data, jobs.data, runs.data, navigate, projectId]);
}
