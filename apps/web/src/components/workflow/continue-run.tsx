import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { Pace, RunModels } from './run-estimate';

/**
 * Continue a paused or finished run (#41): pick another model for any AI step, send the failed
 * lines again, see the estimate for what is left, then go on. Only this run changes; the
 * workflow keeps its own models.
 */
export function ContinueRun({ runId, failed, paused }: { runId: string; failed: number; paused: boolean }) {
  const [open, setOpen] = useState(false);
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
      <DialogTrigger asChild>
        <Button variant={paused ? 'outline' : 'default'}>{paused ? <Play /> : <RotateCcw />} {paused ? '모델 바꿔 재개' : '실패한 줄 다시'}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{paused ? '다른 모델로 이어서 실행' : '이 실행 이어서 하기'}</DialogTitle>
          <DialogDescription>남은 줄부터 고른 모델로 처리합니다. 이미 끝난 줄과 워크플로의 모델은 그대로이고, 어느 호출이 어떤 연결로 갔는지는 AI 호출 기록에 남습니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {failed > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={retryFailed} onCheckedChange={(checked) => setRetryFailed(Boolean(checked))} />
              실패한 줄 {failed.toLocaleString()}개도 실패한 단계부터 다시
            </label>
          )}
          {data && (
            <p className="text-sm">
              이어서 처리할 대사 <b className="tabular-nums">{data.lines.toLocaleString()}</b>줄
            </p>
          )}
          {nothing && <p className="text-sm text-muted-foreground">이어서 처리할 대사가 없습니다.{failed > 0 && ' 실패한 줄을 다시 하려면 위를 고르세요.'}</p>}
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
          {data && !nothing && <p className="text-xs text-muted-foreground">예상은 남은 줄이 모든 단계를 처음부터 거친다고 보고 계산한 최대치입니다.</p>}
          {plan.isPending && <Skeleton className="h-24 w-full" />}
          {plan.isError && <p className="text-sm text-destructive">{plan.error.message}</p>}
        </div>
        {go.isError && <p className="text-sm text-destructive">{go.error.message}</p>}
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
