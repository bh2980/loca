import { useEffect, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { RunCard } from '@tw/shared';
import { Box, Button, Inline, Progress, Spinner, Stack, Text } from '@loca/ui';
import { cardSummary } from '@/lib/chat-run';
import { answerRunCard } from '@/lib/chat-run-api';
import { keyLabel } from '@/lib/keys';
import { AttachChip } from './attach-chip';
import { useRuns } from '@/lib/runs';

const STATUS = { running: '진행 중', paused: '일시중지', cancelled: '취소됨', completed: '완료' } as const;

/** What the keyboard does to the card that waits for an answer (Enter in the empty box runs it, Esc cancels). */
export interface RunCardControls {
  start: () => void;
  cancel: () => void;
}

/**
 * The 실행 확인 card (docs/CHAT-INPUT-DESIGN.md 3-2): a message of the conversation, kept on the
 * server. It shows what a /workflow would run on with the numbers it was made with, and 실행 and 취소
 * answer it once (the server starts the run and records its id on the card). After 실행 the same card
 * follows the run and links to its page. The target is not editable here: cancel and start again to change it.
 */
export function RunCardView({ projectId, sessionId, card, onChange, onAnswered, controls }: {
  projectId: string;
  sessionId: string;
  card: RunCard;
  /** The card as the server now has it (after 실행 or 취소). */
  onChange: (card: RunCard) => void;
  /** After 실행 or 취소: focus goes back to the box, never stays on a button. */
  onAnswered: () => void;
  /** Set on the newest waiting card, so the box can answer it by key. */
  controls?: { current: RunCardControls | null };
}) {
  const waiting = card.state === 'pending';
  const answer = useMutation({
    mutationFn: (kind: 'start' | 'cancel') => answerRunCard(sessionId, card.id, kind),
    onSuccess: (next) => {
      onChange(next);
      onAnswered();
    },
  });
  const summary = cardSummary(card.input, card.plan);
  const canStart = waiting && !summary.empty && !answer.isPending;
  const cancel = () => !answer.isPending && answer.mutate('cancel');
  const doStart = () => canStart && answer.mutate('start');
  const latest = useMemo(() => ({ start: doStart, cancel }), [canStart, answer.isPending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!controls || !waiting) return;
    controls.current = latest;
    return () => {
      if (controls.current === latest) controls.current = null;
    };
  }, [controls, waiting, latest]);

  if (card.state === 'cancelled')
    return <Text as="p" variant="caption" tone="muted" role="status">/{card.workflowName} 실행을 취소했습니다.</Text>;

  return (
    <Box spaceY="condensed" radius="md" border="all" background="sunken" paddingX="normal" paddingY="condensed" variant="body" role="group" aria-label={`${card.workflowName} 실행 확인`}>
      <Text as="p" weight="medium">/{card.workflowName}</Text>
      <Stack direction="row" wrap gap="tight" aria-label="실행 대상">
        {card.chips.map((chip) => <AttachChip key={`${chip.kind}:${chip.id}`} projectId={projectId} chip={chip} />)}
      </Stack>
      {card.runId ? <RunProgress projectId={projectId} runId={card.runId} /> : (
        <p>
          {summary.empty ? <Text tone="muted">이 대상에는 실행할 {card.input === 'terms' ? '용어' : '대사'}가 없습니다.</Text> : (
            <>
              대상 <Text as="b" weight="medium" tabular>{summary.targets}</Text> · AI 요청 <Text as="b" weight="medium" tabular>{summary.requests}</Text>
              {summary.time && ` · 약 ${summary.time}`}
              {summary.money && ` · ${summary.money}`}
            </>
          )}
          {summary.excluded > 0 && <Text variant="caption" tone="muted"> · 번역 제외 {summary.excluded.toLocaleString()}줄은 빠집니다</Text>}
        </p>
      )}
      {answer.isError && <Text as="p" variant="caption" tone="danger" role="alert">{answer.error.message}</Text>}
      {waiting && (
        <Inline gap="condensed">
          <Button variant="secondary" disabled={!canStart} onClick={doStart} aria-keyshortcuts="Enter">
            {answer.isPending && answer.variables === 'start' ? <Spinner /> : null} 실행
          </Button>
          <Button variant="ghost" disabled={answer.isPending} onClick={cancel} aria-keyshortcuts="Escape">취소</Button>
          <Text variant="caption" tone="muted">입력창이 비었을 때 {keyLabel('Enter')} 실행 · {keyLabel('Esc')} 취소</Text>
        </Inline>
      )}
    </Box>
  );
}

/** A started run, live: the runs topic refreshes it as items finish. */
function RunProgress({ projectId, runId }: { projectId: string; runId: string }) {
  const runs = useRuns(projectId);
  const run = runs.data?.find((item) => item.id === runId);
  const done = run ? (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0) : 0;
  const percent = run?.total ? Math.round((done / run.total) * 100) : 0;
  return (
    <Box spaceY="condensed" role="status">
      <Progress value={run?.status === 'completed' ? 100 : percent} aria-label="실행 진행" />
      <Inline as="p" wrap gapX="condensed" variant="caption" tone="muted">
        <span>{run ? STATUS[run.status] : '시작하는 중…'}</span>
        {run && <Text tabular>{done.toLocaleString()} / {run.total.toLocaleString()}</Text>}
        {run && (run.states.failed ?? 0) > 0 && <Text tabular>실패 {run.states.failed!.toLocaleString()}</Text>}
        <Text asChild marginLeft="auto" underline="offset"><Link to="/p/$projectId/runs/$runId" params={{ projectId, runId }}>실행 보기</Link></Text>
      </Inline>
    </Box>
  );
}
