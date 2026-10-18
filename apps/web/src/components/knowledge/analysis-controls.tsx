import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleStop } from 'lucide-react';
import { toast } from 'sonner';
import { Elapsed, JobProgress } from '@/components/job-progress';
import { Button } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { dateTime } from '@/lib/datetime';

const fail = (error: Error) => toast.error(error.message);

/** The last work analysis: progress with a stop button, or its result. */
export function JobStatus({ projectId }: { projectId: string }) {
  const jobs = useQuery(q.analysisJobs(projectId));
  const cancel = useMutation({ mutationFn: (jobId: string) => unwrap(client.projects[':projectId'].analysis[':jobId'].cancel.$post({ param: { projectId, jobId } })), onError: fail });
  const job = jobs.data?.[0];
  if (!job) return null;
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
  // What a run saved is in 제안 (or written straight away, as its apply nodes say); only the old service's jobs carry counts.
  const result = job.result;
  const counts = result ? ([['documents', '문서'], ['characters', '인물'], ['relationships', '관계'], ['events', '사건'], ['speechRules', '말투 규칙']] as const).flatMap(([kind, label]) => (result[kind] ? [[label, result[kind]] as const] : [])) : [];
  return (
    <span>
      마지막 분석 {when} · {job.model}
      {counts.length > 0 && <span className="text-muted-foreground"> · {counts.map(([label, count]) => `${label} ${count}`).join(' · ')}</span>}
      {result?.terms ? ` · 용어 후보 ${result.terms}개` : ''}
    </span>
  );
}

/** Whether an analysis has finished before, so its drafts exist. */
export const hasAnalysis = (jobs: { status: string }[] | undefined) => (jobs ?? []).some((job) => job.status === 'completed');
