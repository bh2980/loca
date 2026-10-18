import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ANALYSIS_WORKFLOW } from '@tw/shared';
import { CircleStop, Play, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Elapsed, JobProgress } from '@/components/job-progress';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@loca/ui';
import { AiConfirmNote } from '@/components/settings/ai-confirm';
import { ModelPicker, useInitialModel, type ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { dateTime } from '@/lib/datetime';

const fail = (error: Error) => toast.error(error.message);

/** The last work analysis: progress with a stop button, or its result. */
export function JobStatus({ projectId }: { projectId: string }) {
  const jobs = useQuery(q.analysisJobs(projectId));
  const cancel = useMutation({ mutationFn: (jobId: string) => unwrap(client.projects[':projectId'].analysis[':jobId'].cancel.$post({ param: { projectId, jobId } })), onError: fail });
  const job = jobs.data?.[0];
  if (!job) return <span>작품 분석을 돌리면 대본 전체를 읽고 아래 다섯 가지 초안을 만듭니다.</span>;
  const when = dateTime(job.finishedAt ?? job.createdAt);
  if (job.status === 'running')
    return (
      <span className="flex min-w-0 items-center gap-2">
        <JobProgress done={job.partsDone} total={job.partsTotal} running className="w-20 shrink-0" />
        <span className="truncate">
          대본을 읽는 중 · {job.model} · <Elapsed since={job.createdAt} />
          {job.partsTotal > 1 && ` · ${job.partsDone}/${job.partsTotal} 부분`}
        </span>
        <Button variant="ghost" size="inline" onClick={() => cancel.mutate(job.id)} disabled={cancel.isPending}>
          <CircleStop /> 중단
        </Button>
      </span>
    );
  if (job.status === 'failed') return <span className="text-destructive">분석 실패 ({when}): {job.error}</span>;
  if (job.status === 'cancelled') return <span>분석을 중단했습니다 ({when}).</span>;
  const result = job.result ?? {};
  const kinds = [
    ['documents', '문서'],
    ['characters', '인물'],
    ['relationships', '관계'],
    ['events', '사건'],
    ['speechRules', '말투 규칙'],
  ] as const;
  const counts = kinds.map(([kind, label]) => [label, result[kind] ?? 0] as const).filter(([, count]) => count > 0);
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  return (
    <span>
      마지막 분석 {when} · {job.model} · 초안 {total}개
      {counts.length > 0 && <span className="text-muted-foreground"> ({counts.map(([label, count]) => `${label} ${count}`).join(' · ')})</span>}
      {result.rulesForReview ? ` · 확인 권장 말투 규칙 ${result.rulesForReview}개` : ''}
      {result.listeners ? ` · 청자 ${result.listeners.toLocaleString()}줄 채움` : ''}
      {result.terms ? ` · 용어 후보 ${result.terms}개` : ''}
      {result.invalidEvidence ? ` · 대본에 없는 근거 ${result.invalidEvidence}개 제외` : ''}
    </span>
  );
}

/** Whether an analysis has finished before, so its drafts exist. */
export const hasAnalysis = (jobs: { status: string }[] | undefined) => (jobs ?? []).some((job) => job.status === 'completed');

/** Start (or redo) a work analysis with a connection + model; how its drafts land is AI › 사용 방식. */
export function StartAnalysis({ projectId, variant = 'default' }: { projectId: string; /** Outline once drafts exist and another action is the screen's primary. */ variant?: 'default' | 'outline' }) {
  const jobs = useQuery(q.analysisJobs(projectId));
  const workflows = useQuery(q.workflows(projectId));
  const initial = useInitialModel(['generate'], jobs.data?.[0]);
  const [picked, setPicked] = useState<ModelValue | null>(null);
  const model = picked ?? initial;
  const [open, setOpen] = useState(false);
  // The button runs the project's 작품 분석 workflow (#47); a failed run continues from 실행 기록.
  const workflow = workflows.data?.find((row) => row.name === ANALYSIS_WORKFLOW);
  const last = jobs.data?.[0];
  const unfinished = last && last.status === 'failed' && last.runId ? last : undefined;
  const start = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].analysis.$post({ param: { projectId }, json: { model: model! } })),
    onSuccess: () => {
      setOpen(false);
      toast.success('작품 분석을 시작했습니다. 끝나면 초안이 여기에 들어옵니다.');
    },
    onError: fail,
  });
  const running = jobs.data?.[0]?.status === 'running';
  const hasDrafts = hasAnalysis(jobs.data);
  // Only one analysis runs at a time; while it does, its progress (with a stop button) stands in for this.
  if (running) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant}>
          <Sparkles className="size-3.5 text-primary" /> {hasDrafts ? '작품 다시 분석' : '작품 분석'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">작품 분석</h3>
          <p className="text-xs text-muted-foreground">
            모델이 대본 전체를 한 번에 읽고 개요·인물·관계·사건·말투 규칙 초안과 용어(번역 제안 포함)를 근거와 함께 만듭니다. 번역과 상태는 바뀌지 않습니다. 긴 문맥 모델을 권장하고, 연결 설정의 최대 출력 토큰이 작으면 답이 잘릴 수 있습니다.
            {hasDrafts && ' 다시 분석하면 사람이 고치거나 확정·확인하지 않은 AI 항목이 새 결과로 바뀝니다.'}
          </p>
          <p className="text-xs text-muted-foreground">
            {workflow ? (
              <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: workflow.id }} className="underline underline-offset-2 hover:text-foreground">
                ‘{ANALYSIS_WORKFLOW}’ 워크플로
              </Link>
            ) : (
              `‘${ANALYSIS_WORKFLOW}’ 워크플로`
            )}
            를 실행합니다. 읽을 항목·지시문은 그 워크플로에서 고치고, 인물만·사건만처럼 나눈 분석은 새 워크플로의 작품 분석 템플릿으로 만듭니다.
          </p>
        </div>
        <ModelPicker value={model} onChange={setPicked} />
        <AiConfirmNote projectId={projectId} kinds={['documents', 'characters', 'relationships', 'events', 'speechRules', 'terms']} />
        {unfinished?.runId && (
          <p className="text-xs text-muted-foreground">
            지난 분석이 끝나지 못했습니다.{' '}
            <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: unfinished.runId }} className="underline underline-offset-2 hover:text-foreground">
              실행 기록에서 이어서 하면
            </Link>{' '}
            읽은 부분은 다시 읽지 않습니다.
          </p>
        )}
        <Button variant="outline" className="w-full" disabled={!model?.model || start.isPending} onClick={() => start.mutate()}>
          <Play /> 시작
        </Button>
      </PopoverContent>
    </Popover>
  );
}
