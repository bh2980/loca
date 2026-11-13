import { Link } from '@tanstack/react-router';
import { Pause } from 'lucide-react';
import { INPUT_TYPES } from '@loca/shared';
import { Button, Icon, Inline, Spinner, Stack, Text } from '@loca/ui';
import { unwatchRun, useRuns } from '@/lib/runs';

/** Active runs started from this conversation, shown above the composer until they stop or are unwatched. */
export function WatchStrip({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const runs = useRuns(projectId);
  const watched = (runs.data ?? []).filter(
    (run) => run.sessionId === sessionId && (run.status === 'preparing' || run.status === 'running' || run.status === 'paused'),
  );
  if (!watched.length) return null;
  return (
    <Stack gap="tight">
      {watched.map((run) => {
        const done = (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0) + (run.states.skipped ?? 0);
        return (
          <Inline key={run.id} gap="tight" align="center" paddingX="normal" paddingY="tight" variant="caption" tone="muted">
            {run.status === 'paused' ? <Icon icon={Pause} size="xs" tone="warning" /> : <Spinner size="xs" />}
            <Text truncate minWidth={0} grow>
              감시 중 · {run.workflowName} · {done.toLocaleString()}/{run.total.toLocaleString()}{INPUT_TYPES[run.subject].unit}
              {run.status === 'paused' ? ' · 일시정지' : ''}
            </Text>
            <Button variant="ghost" size="inline" asChild>
              <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }}>보기</Link>
            </Button>
            <Button variant="ghost" size="inline" onClick={() => void unwatchRun(projectId, run.id)}>
              감시 끊기
            </Button>
          </Inline>
        );
      })}
    </Stack>
  );
}
