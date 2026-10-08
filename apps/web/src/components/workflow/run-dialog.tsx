import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Play, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

type Mode = 'all' | 'groups' | 'units';

/**
 * Start a workflow on the whole project, chosen scenes, or picked lines. The count shown is
 * exactly what will run: scope ∩ entry statuses (unless the user chooses to ignore statuses).
 */
export function RunDialog({ projectId, workflowId: fixedWorkflowId, groupIds, unitIds, dirty, disabled, trigger }: {
  projectId: string;
  /** Omit to let the user pick a workflow (when starting from a scene or a line selection). */
  workflowId?: string;
  groupIds?: string[];
  unitIds?: string[];
  dirty?: boolean;
  disabled?: boolean;
  trigger?: ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const initialMode: Mode = unitIds?.length ? 'units' : groupIds?.length ? 'groups' : 'all';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [picked, setPicked] = useState<Set<string>>(new Set(groupIds));
  const [filter, setFilter] = useState('');
  const [ignoreStatus, setIgnoreStatus] = useState(false);
  const workflows = useQuery({ ...q.workflows(projectId), enabled: open && !fixedWorkflowId });
  const [chosen, setChosen] = useState<string>();
  const workflowId = fixedWorkflowId ?? chosen ?? workflows.data?.find((workflow) => !workflow.errorCount)?.id;
  const groups = useQuery({ ...q.groups(projectId), enabled: open && mode === 'groups' });

  const scope = mode === 'units' ? { unitIds, ignoreStatus } : mode === 'groups' ? { groupIds: [...picked], ignoreStatus } : {};
  const preview = useQuery({
    queryKey: ['units', 'run-preview', workflowId, scope],
    queryFn: () => unwrap(client.workflows[':id'].preview.$post({ param: { id: workflowId! }, json: scope })),
    enabled: open && Boolean(workflowId) && (mode !== 'groups' || picked.size > 0),
  });
  const start = useMutation({
    mutationFn: () => unwrap(client.workflows[':id'].runs.$post({ param: { id: workflowId! }, json: scope })),
    onSuccess: (run) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.runId } });
    },
  });
  const visible = useMemo(() => (groups.data ?? []).filter((group) => `${group.title} ${group.key}`.toLowerCase().includes(filter.toLowerCase())), [groups.data, filter]);
  const count = mode === 'groups' && !picked.size ? 0 : preview.data?.count;
  const selectedTotal = mode === 'units' ? unitIds!.length : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMode(initialMode);
          setPicked(new Set(groupIds));
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" disabled={disabled}>
            <Play /> 실행
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>워크플로 실행</DialogTitle>
          <DialogDescription>저장된 버전과 현재 AI 프로필 설정을 고정해서 실행합니다.{dirty && ' 저장하지 않은 편집은 포함되지 않습니다.'}</DialogDescription>
        </DialogHeader>

        {!fixedWorkflowId && (
          <Select value={workflowId} onValueChange={setChosen}>
            <SelectTrigger className="w-full" aria-label="워크플로">
              <SelectValue placeholder="워크플로 선택" />
            </SelectTrigger>
            <SelectContent>
              {workflows.data?.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id} disabled={workflow.errorCount > 0}>
                  {workflow.name} <span className="text-muted-foreground">v{workflow.version}{workflow.errorCount > 0 && ' · 오류 있음'}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <RadioGroup value={mode} onValueChange={(value) => setMode(value as Mode)} className="gap-2">
          {unitIds?.length ? (
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="units" /> 선택한 대사 {unitIds.length}개
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="groups" /> 장면 선택{groupIds?.length && mode === 'groups' ? ` (${picked.size}개)` : ''}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="all" /> 프로젝트 전체
          </label>
        </RadioGroup>

        {mode === 'groups' && (
          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b px-2">
              <Search className="size-4 text-muted-foreground" />
              <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="장면 찾기" className="h-9 border-0 shadow-none focus-visible:ring-0" />
              <span className="shrink-0 text-xs text-muted-foreground">{picked.size}개 선택</span>
            </div>
            <ul className="max-h-60 overflow-auto p-1">
              {visible.map((group) => (
                <li key={group.id}>
                  <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                    <Checkbox
                      checked={picked.has(group.id)}
                      onCheckedChange={(checked) =>
                        setPicked((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(group.id);
                          else next.delete(group.id);
                          return next;
                        })
                      }
                    />
                    <span className="truncate">{group.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{group.total}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mode !== 'all' && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ignoreStatus} onCheckedChange={(checked) => setIgnoreStatus(Boolean(checked))} className="mt-0.5" />
            <span>
              진입 노드의 상태 조건 무시
              <span className="block text-xs text-muted-foreground">이미 확정된 대사도 다시 돌립니다. 끄면 진입 조건(예: 미번역)에 맞는 대사만 실행합니다.</span>
            </span>
          </label>
        )}

        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
          실행할 대사: <b className="tabular-nums">{!workflowId ? '—' : count === undefined ? '…' : `${count.toLocaleString()}개`}</b>
          {selectedTotal !== undefined && count !== undefined && count < selectedTotal && (
            <span className="text-muted-foreground"> (선택 {selectedTotal}개 중 {selectedTotal - count}개는 진입 상태 조건에 맞지 않음)</span>
          )}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button disabled={!count || !workflowId || start.isPending} onClick={() => start.mutate()}>
            {start.isPending && <Spinner />} {count ? `${count.toLocaleString()}개 실행` : '실행'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
