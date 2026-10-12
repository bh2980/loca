import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Play } from 'lucide-react';
import { hasAnalysis, StartAnalysis } from '@/components/knowledge/analysis-controls';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface Step {
  key: string;
  title: string;
  why: string;
  done: boolean;
  /** Worth doing but not needed to translate; never "the next step". */
  optional?: boolean;
  /** What to press for this step; the next step's is the page's primary button. */
  action: (primary: boolean) => ReactNode;
}

/**
 * The order of work for a new project, on its home page: each step checks itself off from the
 * project's own data, and only the next required step carries the primary button. It disappears
 * once a translation run has happened and the analysis exists (the work is under way).
 */
export function GettingStarted({ projectId }: { projectId: string }) {
  const profiles = useQuery(q.profiles());
  const connections = useQuery(q.connections());
  const jobs = useQuery(q.analysisJobs(projectId));
  const rules = useQuery(q.speechRules(projectId));
  const terms = useQuery(q.terms(projectId));
  const runs = useQuery(q.runs(projectId));
  const project = useQuery(q.project(projectId));
  if (!profiles.data || !connections.data || !jobs.data || !rules.data || !terms.data || !runs.data || !project.data) return null;

  const analysed = hasAnalysis(jobs.data);
  const ran = runs.data.length > 0;
  if (analysed && ran) return null;
  const toCheck = rules.data.filter((rule) => rule.review && !rule.reviewed).length;
  const confirmedTerms = terms.data.filter((term) => term.status === 'confirmed').length;

  const steps: Step[] = [
    {
      key: 'ai',
      title: 'AI 준비',
      why: 'AI 연결(API·CLI 등)과 그 위에 쓸 모델 프로필을 만듭니다. 분석과 번역이 이 프로필을 씁니다.',
      done: profiles.data.length > 0,
      action: (primary) => (
        <Button asChild variant={primary ? 'default' : 'outline'}>
          <Link to={connections.data.length ? '/p/$projectId/settings/profiles' : '/p/$projectId/settings/ai'} params={{ projectId }}>
            {connections.data.length ? '모델 프로필 만들기' : 'AI 연결 추가'}
          </Link>
        </Button>
      ),
    },
    {
      key: 'analysis',
      title: '작품 분석',
      why: 'AI가 대본 전체를 읽고 인물·관계·사건·말투 규칙과 장면별 청자 초안을 만듭니다. 번역할 때 AI가 받는 문맥의 바탕입니다.',
      done: analysed,
      action: (primary) => <StartAnalysis projectId={projectId} variant={primary ? 'default' : 'outline'} />,
    },
    {
      key: 'check',
      title: '말투 규칙 훑어보기',
      why: toCheck ? `확인 권장으로 표시된 말투 규칙이 ${toCheck}개 있습니다. 틀린 규칙은 많은 줄의 말투를 틀리게 합니다.` : '분석이 만든 화자 → 청자 말투 규칙을 훑어봅니다. 나중에 고쳐도 됩니다.',
      done: analysed && toCheck === 0,
      optional: true,
      action: () => (
        <Button asChild variant="ghost">
          <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table' }}>
            인물·관계 보기
          </Link>
        </Button>
      ),
    },
    {
      key: 'terms',
      title: '용어 정하기',
      why: '대본에서 고유명사 후보를 찾아 번역을 정합니다. 확정한 용어만 번역 문맥에 들어갑니다.',
      done: confirmedTerms > 0,
      optional: true,
      action: () => (
        <Button asChild variant="ghost">
          <Link to="/p/$projectId/glossary" params={{ projectId }}>
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
      why: '검수에서 걸린 줄은 검토함에 모입니다. 번역 화면에서 고치고 ⌘↵로 확정합니다.',
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
      <h2 className="mb-1 text-base font-semibold">시작하기</h2>
      <p className="mb-3 text-sm text-muted-foreground">이 순서로 하면 됩니다. 단계는 프로젝트 상태를 보고 저절로 체크됩니다.</p>
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
              </div>
              {!step.done && (current || step.optional) && <div className="shrink-0">{step.action(current)}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
