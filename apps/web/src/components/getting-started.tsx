import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Play, X } from 'lucide-react';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button, SectionHeading } from '@loca/ui';
import { HeaderActions } from '@/components/page';
import { q, useReviewTagId } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { termMarksOf } from '@tw/shared';

interface Step {
  key: string;
  title: string;
  /** A fact about the step's current state, not an explanation. */
  why?: string;
  done: boolean;
  /** Worth doing but not needed to translate; never "the next step". */
  optional?: boolean;
  /** What to press for this step; the next step's is the page's primary button. */
  action: (primary: boolean) => ReactNode;
}

/**
 * The order of work for a new project, on its home page: each step checks itself off from the
 * project's own data, and only the next required step carries the primary button. It disappears
 * once a run has happened and there is story knowledge (the work is under way), or when the
 * person closes it (kept per project in this browser; '시작하기' in the header brings it back).
 */
export function GettingStarted({ projectId }: { projectId: string }) {
  const connections = useQuery(q.connections());
  const characters = useQuery(q.characters(projectId));
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
  if (!connections.data || !characters.data || !rules.data || !terms.data || !runs.data || !project.data) return null;

  const aiConnections = connections.data.filter((connection) => connection.kind !== 'http');
  // Story knowledge exists (whichever workflow, chat or person made it): AI nodes have context to read.
  const known = characters.data.characters.length > 0 || rules.data.length > 0;
  const ran = runs.data.length > 0;
  if (known && ran) return null;
  if (hidden)
    return (
      <HeaderActions>
        <Button variant="ghost" onClick={() => hide(false)}>
          시작하기
        </Button>
      </HeaderActions>
    );
  const toCheck = rules.data.filter((rule) => rule.tags.some((tag) => tag.id === reviewTag)).length;
  // Counted by the glossary's own marks (#후보, #번역어 없음 on any term), the same ones its links filter by.
  const confirmedTerms = terms.data.filter((term) => term.status === 'confirmed').length;
  const candidates = terms.data.filter((term) => termMarksOf(term).includes('candidate')).length;
  const emptyTerms = terms.data.filter((term) => termMarksOf(term).includes('emptyTarget')).length;

  const steps: Step[] = [
    {
      key: 'ai',
      title: 'AI 연결 추가',
      done: aiConnections.length > 0,
      action: (primary) => (
        <Button asChild variant={primary ? 'default' : 'outline'}>
          <Link to="/p/$projectId/settings/connections" params={{ projectId }} search={{ conn: aiConnections.length ? undefined : 'new' }}>
            AI 연결 추가
          </Link>
        </Button>
      ),
    },
    {
      key: 'knowledge',
      title: '자료 만들기',
      done: known,
      action: (primary) => <RunDialog projectId={projectId} remember="getting-started-knowledge" trigger={<Button variant={primary ? 'default' : 'outline'}>워크플로 실행</Button>} />,
    },
    {
      key: 'check',
      title: '말투 규칙 훑어보기',
      why: toCheck ? `확인 권장 ${toCheck}개` : undefined,
      done: known && toCheck === 0,
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
      why: candidates || emptyTerms ? `용어 후보 ${candidates.toLocaleString()}개${emptyTerms ? ` · 번역어 없음 ${emptyTerms.toLocaleString()}개` : ''}` : confirmedTerms ? `확정한 용어 ${confirmedTerms.toLocaleString()}개` : undefined,
      done: confirmedTerms > 0,
      optional: true,
      action: () => (
        <Button asChild variant="ghost">
          <Link to="/p/$projectId/glossary" params={{ projectId }} search={candidates ? { marks: ['candidate'] } : {}}>
            용어집 열기
          </Link>
        </Button>
      ),
    },
    {
      key: 'run',
      title: '번역 실행',
      done: ran,
      action: (primary) => (
        <RunDialog
          projectId={projectId}
          remember="getting-started"
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
        <SectionHeading page>시작하기</SectionHeading>
        <Button variant="ghost" size="icon" aria-label="시작하기 닫기" onClick={() => hide(true)}>
          <X />
        </Button>
      </div>
      <ol className="rounded-md border border-border bg-background/50">
        {steps.map((step, i) => {
          const current = step === next;
          return (
            <li key={step.key} className={cn('flex items-start gap-4 px-4 py-3', current && 'bg-muted')}>
              <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums', step.done ? 'border-success bg-success text-background' : current ? 'border-foreground font-medium text-foreground' : 'text-muted-foreground')}>
                {step.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
                  {step.title}
                  {step.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">선택</span>}
                </p>
                {!step.done && step.why && <p className="mt-0.5 text-xs text-muted-foreground">{step.why}</p>}
              </div>
              {!step.done && (current || step.optional) && <div className="shrink-0">{step.action(current)}</div>}
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
