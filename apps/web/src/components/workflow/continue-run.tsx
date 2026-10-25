import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCcw } from 'lucide-react';
import { Box, Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Inline, Skeleton, Text } from '@loca/ui';
import type { ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { Pace, RunModels } from './run-estimate';

/**
 * Continue a paused or finished run (#41): pick another model for any AI step, send the failed
 * lines again, see the estimate for what is left, then go on. Only this run changes; the
 * workflow keeps its own models.
 */
export function ContinueRun({ runId, failed, paused, open: controlledOpen, onOpenChange, hideTrigger = false }: { runId: string; failed: number; paused: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const [picked, setPicked] = useState<Record<string, ModelValue>>({});
  const [retryFailed, setRetryFailed] = useState(failed > 0);
  const queryClient = useQueryClient();
  const models = Object.fromEntries(Object.entries(picked).filter(([, value]) => value.connectionId && value.model)) as Record<string, { connectionId: string; model: string; effort?: string }>;
  const request = { ...(Object.keys(models).length ? { models } : {}), retryFailed };
  const plan = useQuery({
    queryKey: ['runs', 'continue-preflight', runId, request],
    queryFn: () => unwrap(client.runs[':id'].continue.preflight.$post({ param: { id: runId }, json: request })),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const go = useMutation({
    mutationFn: () => unwrap(client.runs[':id'].continue.$post({ param: { id: runId }, json: request })),
    onSuccess: () => {
      setOpen(false);
      setPicked({});
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
  const data = plan.data;
  const nothing = data?.lines === 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && <DialogTrigger asChild>
        <Button variant={paused ? 'outline' : 'default'}>{paused ? <Play /> : <RotateCcw />} {paused ? '모델 바꿔 재개' : '실패한 줄 다시'}</Button>
      </DialogTrigger>}
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{paused ? '모델 바꿔 재개' : '이어서 실행'}</DialogTitle>
        </DialogHeader>
        <Box spaceY="comfortable">
          {failed > 0 && (
            <Inline as="label" gap="condensed" variant="body">
              <Checkbox checked={retryFailed} onCheckedChange={(checked) => setRetryFailed(Boolean(checked))} />
              실패한 줄 {failed.toLocaleString()}개도 실패한 단계부터 다시
            </Inline>
          )}
          {data && (
            <Text as="p" variant="body">
              남은 줄 <Text as="b" tabular>{data.lines.toLocaleString()}</Text>
            </Text>
          )}
          {nothing && <Text as="p" variant="body" tone="muted">이어서 처리할 대사가 없습니다.</Text>}
          {data && !nothing && <Pace data={data.plan} />}
          {data && !nothing && (
            <RunModels
              nodes={data.plan.nodes}
              picked={picked}
              onPick={(nodeId, value) => setPicked((previous) => ({ ...previous, [nodeId]: value }))}
              onReset={(nodeId) => setPicked(({ [nodeId]: _gone, ...rest }) => rest)}
              changedNote="남은 줄부터"
            />
          )}
          {plan.isPending && <Skeleton height="placeholder" width="full" />}
          {plan.isError && <Text as="p" variant="body" tone="danger">{plan.error.message}</Text>}
        </Box>
        {go.isError && <Text as="p" variant="body" tone="danger">{go.error.message}</Text>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
          <Button onClick={() => go.mutate()} disabled={!data || nothing || plan.isPlaceholderData || go.isPending}>
            <Play /> 이어서 실행
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
