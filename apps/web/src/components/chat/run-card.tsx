import { useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, Progress, Spinner } from '@loca/ui';
import { cardSummary, planCard, startCard, type RunCard } from '@/lib/chat-run';
import { runApi } from '@/lib/chat-run-api';
import { keyLabel } from '@/lib/keys';
import { q } from '@/lib/queries';
import { AttachChip } from './attach-chip';

const STATUS = { running: '진행 중', paused: '일시중지', cancelled: '취소됨', completed: '완료' } as const;

/** What the keyboard does to the card that waits for an answer (Enter in the empty box runs it, Esc cancels). */
export interface RunCardControls {
  start: () => void;
  cancel: () => void;
}

/**
 * The 실행 확인 card (docs/CHAT-INPUT-DESIGN.md 3-2): what a /workflow would run on, from the same
 * preflight as the run dialog, with 실행 and 취소. After 실행 the same card follows the run and links to its
 * page. The target is not editable here: cancel and start again to change it.
 */
export function RunCardView({ projectId, card, onChange, onAnswered, controls }: {
  projectId: string;
  card: RunCard;
  onChange: (patch: Partial<RunCard>) => void;
  /** After 실행 or 취소: focus goes back to the box, never stays on a button. */
  onAnswered: () => void;
  /** Set on the newest waiting card, so the box can answer it by key. */
  controls?: { current: RunCardControls | null };
}) {
  const api = useMemo(() => runApi(projectId), [projectId]);
  const waiting = !card.runId && !card.cancelled;
  // The same key family as the run dialog's preflight (units: lines, statuses and workflows refresh it).
  const planned = useQuery({ queryKey: ['units', 'chat-run-plan', projectId, card.id], queryFn: () => planCard(api, card), enabled: waiting, retry: false });
  const start = useMutation({
    mutationFn: () => startCard(api, card, planned.data!),
    onSuccess: (run) => {
      onChange({ runId: run.runId });
      onAnswered();
    },
  });
  const summary = planned.data ? cardSummary(card.input, planned.data.plan) : null;
  const canStart = waiting && Boolean(planned.data) && !summary?.empty && !start.isPending;
  const cancel = () => {
    onChange({ cancelled: true });
    onAnswered();
  };
  const doStart = () => canStart && start.mutate();
  const latest = useMemo(() => ({ start: doStart, cancel }), [canStart, planned.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!controls || !waiting) return;
    controls.current = latest;
    return () => {
      if (controls.current === latest) controls.current = null;
    };
  }, [controls, waiting, latest]);

  if (card.cancelled)
    return <p className="text-xs text-muted-foreground" role="status">/{card.workflowName} 실행을 취소했습니다.</p>;

  return (
    <div className="space-y-2 rounded-md border bg-muted px-3 py-2 text-sm" role="group" aria-label={`${card.workflowName} 실행 확인`}>
      <p className="font-medium">/{card.workflowName}</p>
      <div className="flex flex-wrap gap-1" aria-label="실행 대상">
        {card.chips.map((chip) => <AttachChip key={`${chip.kind}:${chip.id}`} projectId={projectId} chip={chip} />)}
      </div>
      {card.runId ? <RunProgress projectId={projectId} runId={card.runId} /> : planned.isError ? (
        <p className="text-xs text-destructive" role="alert">{planned.error.message}</p>
      ) : !summary ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner className="size-3" /> 세는 중…</p>
      ) : (
        <p>
          {summary.empty ? <span className="text-muted-foreground">이 대상에는 실행할 {card.input === 'terms' ? '용어' : '대사'}가 없습니다.</span> : (
            <>
              대상 <b className="font-medium tabular-nums">{summary.targets}</b> · AI 요청 <b className="font-medium tabular-nums">{summary.requests}</b>
              {summary.time && ` · 약 ${summary.time}`}
              {summary.money && ` · ${summary.money}`}
            </>
          )}
          {summary.excluded > 0 && <span className="text-xs text-muted-foreground"> · 번역 제외 {summary.excluded.toLocaleString()}줄은 빠집니다</span>}
        </p>
      )}
      {start.isError && <p className="text-xs text-destructive" role="alert">{start.error.message}</p>}
      {waiting && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={!canStart} onClick={doStart} aria-keyshortcuts="Enter">
            {start.isPending ? <Spinner /> : null} 실행
          </Button>
          <Button variant="ghost" onClick={cancel} aria-keyshortcuts="Escape">취소</Button>
          <span className="text-xs text-muted-foreground">입력창이 비었을 때 {keyLabel('Enter')} 실행 · {keyLabel('Esc')} 취소</span>
        </div>
      )}
    </div>
  );
}

/** A started run, live: the runs topic refreshes it as items finish. */
function RunProgress({ projectId, runId }: { projectId: string; runId: string }) {
  const runs = useQuery(q.runs(projectId));
  const run = runs.data?.find((item) => item.id === runId);
  const done = run ? (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0) : 0;
  const percent = run?.total ? Math.round((done / run.total) * 100) : 0;
  return (
    <div className="space-y-1.5" role="status">
      <Progress value={run?.status === 'completed' ? 100 : percent} aria-label="실행 진행" />
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{run ? STATUS[run.status] : '시작하는 중…'}</span>
        {run && <span className="tabular-nums">{done.toLocaleString()} / {run.total.toLocaleString()}</span>}
        {run && (run.states.failed ?? 0) > 0 && <span className="tabular-nums">실패 {run.states.failed!.toLocaleString()}</span>}
        <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId }} className="ml-auto underline underline-offset-2">실행 보기</Link>
      </p>
    </div>
  );
}
