import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Play, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

/** Pick a scope, see exactly how many lines enter (scope ∩ entry statuses), start. */
export function RunDialog({ projectId, workflowId, disabled, dirty, presetGroupIds }: { projectId: string; workflowId: string; disabled?: boolean; dirty?: boolean; presetGroupIds?: string[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'all' | 'groups'>(presetGroupIds?.length ? 'groups' : 'all');
  const [picked, setPicked] = useState<Set<string>>(new Set(presetGroupIds));
  const [filter, setFilter] = useState('');
  const groups = useQuery({ ...q.groups(projectId), enabled: open });
  const scope = mode === 'all' ? {} : { groupIds: [...picked] };
  const preview = useQuery({
    queryKey: ['units', 'run-preview', workflowId, scope],
    queryFn: () => unwrap(client.workflows[':id'].preview.$post({ param: { id: workflowId }, json: scope })),
    enabled: open && (mode === 'all' || picked.size > 0),
  });
  const start = useMutation({
    mutationFn: () => unwrap(client.workflows[':id'].runs.$post({ param: { id: workflowId }, json: scope })),
    onSuccess: (run) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.runId } });
    },
  });
  const visible = useMemo(() => (groups.data ?? []).filter((group) => group.title.toLowerCase().includes(filter.toLowerCase()) || group.key.toLowerCase().includes(filter.toLowerCase())), [groups.data, filter]);
  const count = mode === 'groups' && !picked.size ? 0 : preview.data?.count;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Play /> 실행
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>워크플로 실행</DialogTitle>
          <DialogDescription>저장된 버전과 현재 AI 프로필 설정을 고정해서 실행합니다.{dirty && ' 저장하지 않은 편집은 포함되지 않습니다.'}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode} onValueChange={(value) => setMode(value as 'all' | 'groups')} className="gap-2">
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="all" /> 프로젝트 전체
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="groups" /> 장면 선택
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
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
          진입 조건에 맞는 대사: <b className="tabular-nums">{count === undefined ? '…' : `${count.toLocaleString()}개`}</b>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button disabled={!count || start.isPending} onClick={() => start.mutate()}>
            {start.isPending && <Spinner />} {count ? `${count.toLocaleString()}개 실행` : '실행'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
