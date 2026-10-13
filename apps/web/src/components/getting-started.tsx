import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CircleStop, Play, X } from 'lucide-react';
import { hasAnalysis, StartAnalysis } from '@/components/knowledge/analysis-controls';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
import { HeaderActions } from '@/components/page';
import { AnalysisSteps } from '@/components/job-progress';
import { client, unwrap } from '@/lib/api';
import { q, useReviewTagId } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { keyLabel } from '@/lib/keys';

interface Step {
  key: string;
  title: string;
  why: string;
  done: boolean;
  /** Worth doing but not needed to translate; never "the next step". */
  optional?: boolean;
  /** Shown under the step while it is being done (an analysis reading the script). */
  progress?: ReactNode;
  /** What to press for this step; the next step's is the page's primary button. */
  action: (primary: boolean) => ReactNode;
}

/**
 * The order of work for a new project, on its home page: each step checks itself off from the
 * project's own data, and only the next required step carries the primary button. It disappears
 * once a translation run has happened and the analysis exists (the work is under way), or when the
 * person closes it (kept per project in this browser; '시작하기' in the header brings it back).
 */
export function GettingStarted({ projectId }: { projectId: string }) {
  const connections = useQuery(q.connections());
  const jobs = useQuery(q.analysisJobs(projectId));
  const rules = useQuery(q.speechRules(projectId));
  const reviewTag = useReviewTagId(projectId);
  const terms = useQuery(q.terms(projectId));
  const runs = useQuery(q.runs(projectId));
  const project = useQuery(q.project(projectId));
  const [hidden, setHidden] = useState(() => readHidden(projectId));
  const hide = (value: boolean) => {
    setHidden(value);
    writeHidden(projectId, value);
  };
  const cancel = useMutation({ mutationFn: (jobId: string) => unwrap(client.projects[':projectId'].analysis[':jobId'].cancel.$post({ param: { projectId, jobId } })) });
  if (!connections.data || !jobs.data || !rules.data || !terms.data || !runs.data || !project.data) return null;

  const aiConnections = connections.data.filter((connection) => connection.kind !== 'http');
  const analysed = hasAnalysis(jobs.data);
  const reading = jobs.data.find((job) => job.status === 'running');
  const ran = runs.data.length > 0;
  if (analysed && ran) return null;
  if (hidden)
    return (
      <HeaderActions>
        <Button variant="ghost" onClick={() => hide(false)}>
          시작하기
        </Button>
      </HeaderActions>
    );
  const toCheck = rules.data.filter((rule) => rule.statusBy === 'ai' && rule.tags.some((tag) => tag.id === reviewTag)).length;
  const confirmedTerms = terms.data.filter((term) => term.status === 'confirmed').length;
  const candidates = terms.data.filter((term) => term.status === 'candidate').length;
  const emptyTerms = terms.data.filter((term) => term.status === 'candidate' && !term.target.trim()).length;

  const steps: Step[] = [
    {
      key: 'ai',
      title: 'AI 연결 추가',
      why: 'AI를 부를 통로(API·CLI 등)를 추가하고 기본 모델을 정합니다. 분석·번역·채팅에서 이 연결과 모델을 고릅니다.',
      done: aiConnections.length > 0,
      action: (primary) => (
        <Button asChild variant={primary ? 'default' : 'outline'}>
          <Link to="/p/$projectId/ai/connections" params={{ projectId }} search={{ conn: aiConnections.length ? undefined : 'new' }}>
            AI 연결 추가
          </Link>
        </Button>
      ),
    },
    {
      key: 'analysis',
      title: '작품 분석',
      why: 'AI가 대본 전체를 읽고 인물·관계·사건·말투 규칙·장면별 청자 초안과 용어 후보(번역 제안 포함)를 만듭니다. 번역할 때 AI가 받는 문맥의 바탕입니다.',
      done: analysed,
      action: (primary) => <StartAnalysis projectId={projectId} variant={primary ? 'default' : 'outline'} />,
      progress: reading && (
        <div className="mt-3">
          <AnalysisSteps
            job={reading}
            actions={
              <>
                <Link to="/p/$projectId/runs" params={{ projectId }} search={{ job: reading.id }} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  실행 기록에서 보기
                </Link>
                <Button variant="ghost" size="inline" onClick={() => cancel.mutate(reading.id)} disabled={cancel.isPending}>
                  <CircleStop /> 중단
                </Button>
              </>
            }
          />
        </div>
      ),
    },
    {
      key: 'check',
      title: '말투 규칙 훑어보기',
      why: toCheck ? `확인 권장으로 표시된 말투 규칙이 ${toCheck}개 있습니다. 틀린 규칙은 많은 줄의 말투를 틀리게 합니다.` : '분석이 만든 화자 → 청자 말투 규칙을 훑어봅니다. 나중에 고쳐도 됩니다.',
      done: analysed && toCheck === 0,
      optional: true,
      action: () => (
        <Button asChild variant="ghost">
          <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', ...(reviewTag && { tags: [reviewTag] }) }}>
            인물·관계 보기
          </Link>
        </Button>
      ),
    },
    {
      key: 'terms',
      title: '용어 정하기',
      why: !terms.data.length
        ? analysed
          ? '작품 분석이 용어를 찾지 못했습니다. 용어집에서 직접 추가할 수 있습니다.'
          : '작품 분석이 용어 후보도 만듭니다.'
        : `용어 후보 ${candidates.toLocaleString()}개${emptyTerms ? ` (번역이 빈 것 ${emptyTerms.toLocaleString()}개)` : ''}. 용어집에서 빈 번역을 AI로 채우고, 확인해서 확정하세요. 확정한 용어만 번역 문맥에 들어갑니다.`,
      done: confirmedTerms > 0,
      optional: true,
      action: () => (
        <Button asChild variant="ghost">
          <Link to="/p/$projectId/glossary" params={{ projectId }} search={terms.data.length ? { state: ['candidate'] } : {}}>
            용어집 열기
          </Link>
        </Button>
      ),
    },
    {
      key: 'run',
      title: '번역 실행',
      why: '워크플로(기본: 번역 → 형식 검사 → 검수 → 확정)를 범위를 골라 실행합니다. 시작 전에 호출 수와 토큰 예상치를 보여 줍니다.',
      done: ran,
      action: (primary) => (
        <RunDialog
          projectId={projectId}
          preferWorkflow="기본 번역"
          trigger={
            <Button variant={primary ? 'default' : 'outline'}>
              <Play /> 실행 범위 고르기
            </Button>
          }
        />
      ),
    },
    {
      key: 'review',
      title: '검토하고 확정',
      why: `검수에서 걸린 줄은 검토함에 모입니다. 번역 화면에서 고치고 ${keyLabel('Mod+Enter')}로 확정합니다.`,
      done: false,
      action: () => (
        <Button asChild variant="ghost">
          <Link to="/p/$projectId/script" params={{ projectId }} search={{ review: true }}>
            검토함 열기
          </Link>
        </Button>
      ),
    },
  ];
  const next = steps.find((step) => !step.done && !step.optional);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">시작하기</h2>
        <Button variant="ghost" size="icon" aria-label="시작하기 닫기" title="닫기 (머리줄의 '시작하기'로 다시 열기)" onClick={() => hide(true)}>
          <X />
        </Button>
      </div>
      <ol className="divide-y rounded-lg border">
        {steps.map((step, i) => {
          const current = step === next;
          return (
            <li key={step.key} className={cn('flex items-start gap-4 px-4 py-3', current && 'bg-muted/40')}>
              <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums', step.done ? 'border-success bg-success text-background' : current ? 'border-foreground font-medium text-foreground' : 'text-muted-foreground')}>
                {step.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
                  {step.title}
                  {step.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">선택</span>}
                </p>
                {!step.done && <p className="text-xs text-muted-foreground">{step.why}</p>}
                {step.progress}
              </div>
              {!step.done && !step.progress && (current || step.optional) && <div className="shrink-0">{step.action(current)}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const hiddenKey = (projectId: string) => `getting-started-hidden:${projectId}`;

function readHidden(projectId: string) {
  try {
    return localStorage.getItem(hiddenKey(projectId)) === '1';
  } catch {
    return false;
  }
}

function writeHidden(projectId: string, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(projectId), '1');
    else localStorage.removeItem(hiddenKey(projectId));
  } catch {
    // Storage unavailable: closed until the page reloads.
  }
}
