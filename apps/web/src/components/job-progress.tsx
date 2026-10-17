import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Progress } from '@loca/ui';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** "2분 13초": how long something has been running, ticking every second while shown. */
export function Elapsed({ since, until }: { since: Date | string; until?: Date | string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  const seconds = Math.max(0, Math.round(((until ? new Date(until).getTime() : now) - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`}</span>;
}

/**
 * Progress of a run or job. Counted when there is something to count; while a single long step is
 * under way (one model call reading the whole script) the bar moves instead of sitting at 0.
 */
export function JobProgress({ done, total, running, className }: { done: number; total: number; running: boolean; className?: string }) {
  if (running && done === 0 && total <= 1)
    return (
      <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20', className)} role="progressbar" aria-label="진행 중">
        <div className="absolute inset-y-0 w-2/5 rounded-full bg-primary" style={{ animation: 'indeterminate 1.4s ease-in-out infinite' }} />
      </div>
    );
  return <Progress value={total ? (done / total) * 100 : 0} className={cn('h-1.5', className)} />;
}

interface AnalysisJob {
  id: string;
  model: string | null;
  status: string;
  partsDone: number;
  partsTotal: number;
  createdAt: string | Date;
  input: { lines: number; scenes: number; tokens: number } | null;
}

/**
 * What a running work analysis is doing, step by step: the script it prepared, the model reading
 * it (with parts when the script was split), then checking and saving the drafts. The time is
 * estimated from how fast this model answered analyses before, and says so when it has no record.
 */
export function AnalysisSteps({ job, actions }: { job: AnalysisJob; actions?: React.ReactNode }) {
  const pace = useQuery({ ...q.aiPace(job.model ?? '', 'analysis'), enabled: Boolean(job.model) });
  const reading = job.partsDone < job.partsTotal;
  const estimate = job.input && pace.data?.secondsPer1k ? (pace.data.secondsPer1k * job.input.tokens) / 1000 : null;
  const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
  const steps = [
    { label: '대본 준비', state: 'done', detail: job.input && `대사 ${job.input.lines.toLocaleString()}줄 · 장면 ${job.input.scenes.toLocaleString()}개 · 약 ${job.input.tokens.toLocaleString()} 토큰${job.partsTotal > 1 ? ` · ${job.partsTotal}부분으로 나눔` : ' · 한 번에 읽음'}` },
    {
      label: job.partsTotal > 1 ? `AI가 읽는 중 (${Math.min(job.partsDone + 1, job.partsTotal)}/${job.partsTotal}부분)` : 'AI가 대본을 읽는 중',
      state: reading ? 'now' : 'done',
      detail: (
        <>
          {job.model} · <Elapsed since={job.createdAt} /> 경과
          {estimate ? ` · 보통 약 ${minutes(estimate * 0.8)}~${minutes(estimate * 1.3)}분 (이 모델의 지난 분석 ${pace.data!.samples}번 기준)` : pace.data ? ' · 이 모델로 분석한 기록이 없어 예상 시간이 없습니다' : ''}
        </>
      ),
    },
    { label: '결과 검사와 저장', state: reading ? 'later' : 'now', detail: '근거 대사가 대본에 있는지 확인하고 인물·관계·사건·말투 규칙·장면별 청자는 자료에, 용어 후보는 용어집에 넣습니다' },
  ] as const;
  return (
    <div className="space-y-2">
      <JobProgress done={job.partsDone} total={job.partsTotal} running />
      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-2 text-xs">
            <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', step.state === 'done' && 'border-success bg-success text-background', step.state === 'now' && 'border-foreground')}>
              {step.state === 'done' ? <Check className="size-3" /> : step.state === 'now' ? <span className="size-1.5 animate-pulse rounded-full bg-foreground" /> : null}
            </span>
            <span className="min-w-0">
              <span className={cn('font-medium', step.state === 'later' && 'text-muted-foreground')}>{step.label}</span>
              {step.detail && <span className="block text-muted-foreground">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {actions && <div className="flex flex-wrap items-center gap-2 pl-6 text-xs">{actions}</div>}
    </div>
  );
}
