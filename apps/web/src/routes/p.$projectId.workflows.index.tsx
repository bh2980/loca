import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AiButton } from '@/components/ai-button';
import { EmptyState, DataTable, type ColumnDef, JobStatusBadge, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, RadioGroup, RadioGroupItem, Skeleton, ContextMenuItem, ContextMenuSeparator } from '@loca/ui';
import { HeaderActions, Page } from '@/components/page';
import { RunDialog } from '@/components/workflow/run-dialog';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { dateTime } from '@/lib/datetime';

export const Route = createFileRoute('/p/$projectId/workflows/')({ component: Workflows });

function Workflows() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const workflows = useQuery(q.workflows(projectId));
  const runs = useQuery(q.runs(projectId));
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(client.workflows[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: q.workflows(projectId).queryKey });
      toast.success('워크플로를 삭제했습니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  type Workflow = NonNullable<typeof workflows.data>[number];
  const duplicate = useMutation({
    mutationFn: async (workflow: Workflow) => {
      const detail = await unwrap(client.workflows[':id'].$get({ param: { id: workflow.id } }));
      const created = await unwrap(
        client.projects[':projectId'].workflows.$post({
          param: { projectId },
          json: { name: `${workflow.name} (복사본)`, from: 'blank' },
        })
      );
      await unwrap(
        client.workflows[':id'].$put({
          param: { id: created.id },
          json: {
            name: created.name,
            description: detail.description,
            definition: detail.definition,
            version: created.version,
          },
        })
      );
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: q.workflows(projectId).queryKey });
      toast.success('워크플로를 복제했습니다.');
    },
    onError: (error) => toast.error(error.message),
  });

  const columns: ColumnDef<Workflow, unknown>[] = [
    {
      id: 'name',
      header: '이름',
      meta: { hideable: false },
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: row.original.id }} className="truncate font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
              {row.original.name}
            </Link>
            {row.original.errorCount > 0 && <Badge variant="destructive">오류 {row.original.errorCount}</Badge>}
          </div>
          {row.original.description && <p className="truncate text-xs text-muted-foreground">{row.original.description}</p>}
        </div>
      ),
    },
    { id: 'nodes', header: '노드', meta: { width: 64, align: 'end' }, cell: ({ row }) => row.original.nodeCount },
    {
      id: 'saved',
      header: '저장',
      meta: { width: 120, className: 'text-muted-foreground' },
      cell: ({ row }) => dateTime(row.original.updatedAt),
    },
    {
      id: 'last',
      header: '최근 실행',
      meta: { width: 220 },
      cell: ({ row }) => {
        const last = runs.data?.find((run) => run.workflowId === row.original.id);
        if (!runs.data) return <Skeleton className="h-4 w-24" />;
        if (!last) return <span className="text-muted-foreground">—</span>;
        return (
          <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: last.id }} className="flex items-center gap-2 hover:underline" onClick={(event) => event.stopPropagation()}>
            <JobStatusBadge status={last.status} />
            <span className="truncate text-xs text-muted-foreground">{dateTime(last.createdAt)}</span>
          </Link>
        );
      },
    },
    {
      id: 'run',
      header: () => <span className="sr-only">실행</span>,
      meta: { width: 88, className: 'py-1.5', label: '실행', hideable: false },
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <RunDialog
            projectId={projectId}
            workflowId={row.original.id}
            disabled={row.original.errorCount > 0}
            trigger={
              <Button variant="ghost" disabled={row.original.errorCount > 0}>
                <Play /> 실행
              </Button>
            }
          />
        </div>
      ),
    },
    {
      id: 'delete',
      header: () => <span className="sr-only">삭제</span>,
      meta: { width: 48, className: 'py-1.5', label: '삭제', hideable: false },
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100" aria-label={`${row.original.name} 삭제`}>
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>‘{row.original.name}’을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>지난 실행 기록은 남습니다.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate(row.original.id)}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
    },
  ];

  return (
    <Page title="워크플로" flush>
      <div className="flex h-full min-h-0 flex-col">
        <HeaderActions>
          <AiButton send={false} prompt="이런 워크플로를 만들어줘: ">
            AI로 만들기
          </AiButton>
          <NewWorkflow projectId={projectId} />
        </HeaderActions>
        <DataTable id="workflows"
          columns={columns}
          rows={workflows.data}
          rowId={(workflow) => workflow.id}
          loading={workflows.isLoading}
          empty={<EmptyState noun="워크플로" />}
          onRowClick={(workflow) => void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } })}
          rowContextMenu={(workflow) => (
            <>
              <ContextMenuItem onClick={() => void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } })}>
                워크플로 편집
              </ContextMenuItem>
              <ContextMenuItem onClick={() => duplicate.mutate(workflow)}>
                복제
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget(workflow)}>
                삭제
              </ContextMenuItem>
            </>
          )}
        />
      </div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>‘{deleteTarget?.name}’을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>지난 실행 기록은 남습니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTarget) { remove.mutate(deleteTarget.id); setDeleteTarget(null); } }}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

type From = 'draft' | 'template' | 'terms' | 'listener' | 'people' | 'events' | 'speechFix' | 'analysis' | 'blank';

/** The templates "새 워크플로" offers (defaults.ts); each is drawn as real nodes, prompts and saves included. */
const TEMPLATE_OPTIONS: { value: Exclude<From, 'blank'>; name: string; label: string }[] = [
  { value: 'draft', name: '초벌 번역', label: '초벌 번역 · 초벌 상태로' },
  { value: 'template', name: '번역·검수', label: '번역 + AI 검수 · 확정까지' },
  { value: 'terms', name: '용어 추출', label: '용어 추출' },
  { value: 'people', name: '인물·관계 추출', label: '인물·관계 추출' },
  { value: 'events', name: '사건 추출', label: '사건 추출' },
  { value: 'listener', name: '청자 추정', label: '청자 추정' },
  { value: 'analysis', name: '작품 분석', label: '작품 분석' },
  { value: 'speechFix', name: '말투만 고치기', label: '말투만 고치기' },
];

function NewWorkflow({ projectId }: { projectId: string }) {
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<From>('draft');
  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].workflows.$post({ param: { projectId }, json: { name: name.trim() || (TEMPLATE_OPTIONS.find((option) => option.value === from)?.name ?? '새 워크플로'), from } })),
    onSuccess: (workflow) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> 새 워크플로
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 워크플로</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">이름</Label>
            <Input id="wf-name" value={name} placeholder={TEMPLATE_OPTIONS.find((option) => option.value === from)?.name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <RadioGroup value={from} onValueChange={(value) => setFrom(value as From)}>
            {TEMPLATE_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-start gap-2 text-sm">
                <RadioGroupItem value={option.value} className="mt-0.5" />
                <span>{option.label}</span>
              </label>
            ))}
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="blank" className="mt-0.5" />
              <span>빈 워크플로</span>
            </label>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button disabled={(!name.trim() && from === 'blank') || create.isPending} onClick={() => create.mutate()}>
            만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
