import { Fragment, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Copy, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { WORKFLOW_TEMPLATES } from '@tw/shared';
import { EmptyState, DataTable, type ColumnDef, RunStatusBadge, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Chip, Box, Button, Inline, Skeleton, Stack, Text, ContextMenuItem, ContextMenuSeparator, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@loca/ui';
import { HeaderActions, Page } from '@/components/page';
import { RunDialog } from '@/components/workflow/run-dialog';
import { client, unwrap } from '@/lib/api';
import { dateTime } from '@/lib/datetime';
import { useRuns } from '@/lib/runs';
import { useWorkflows } from '@/lib/workflows';
import { sent } from '@/lib/collections';

export const Route = createFileRoute('/p/$projectId/workflows/')({ component: Workflows });

function Workflows() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const workflows = useWorkflows(projectId);
  const runs = useRuns(projectId);
  const remove = useMutation({
    mutationFn: (id: string) => sent(projectId, client.workflows[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      toast.success('워크플로를 삭제했습니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  type Workflow = NonNullable<typeof workflows.data>[number];
  const create = useMutation({
    mutationFn: (template?: string) => sent(projectId, client.projects[':projectId'].workflows.$post({ param: { projectId }, json: template ? { template } : {} })),
    onSuccess: (workflow) => {
      void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } });
    },
    onError: (error) => toast.error(error.message),
  });
  const duplicate = useMutation({
    mutationFn: async (workflow: Workflow) => {
      const created = await unwrap(
        client.projects[':projectId'].workflows.$post({
          param: { projectId },
          json: { name: `${workflow.name} (복사본)` },
        })
      );
      await sent(
        projectId,
        client.workflows[':id'].$put({
          param: { id: created.id },
          json: {
            name: created.name,
            description: workflow.description,
            definition: workflow.definition,
            version: created.version,
          },
        })
      );
      return created;
    },
    onSuccess: () => {
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
        <Box minWidth={0}>
          <Inline gap="condensed">
            <Text asChild truncate weight="medium" underline="hover">
              <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: row.original.id }} onClick={(event) => event.stopPropagation()}>
                {row.original.name}
              </Link>
            </Text>
            {row.original.errorCount > 0 && <Chip variant="solid" tone="danger">오류 {row.original.errorCount}</Chip>}
          </Inline>
          {row.original.description && <Text as="p" truncate variant="caption" tone="muted">{row.original.description}</Text>}
        </Box>
      ),
    },
    { id: 'nodes', header: '노드', meta: { width: 64, align: 'end' }, cell: ({ row }) => row.original.nodeCount },
    {
      id: 'saved',
      header: '저장',
      meta: { width: 120, tone: 'muted' },
      cell: ({ row }) => dateTime(row.original.updatedAt),
    },
    {
      id: 'last',
      header: '최근 실행',
      meta: { width: 220 },
      cell: ({ row }) => {
        const last = runs.data?.find((run) => run.workflowId === row.original.id);
        if (!runs.data) return <Skeleton height="icon" width="field-sm" />;
        if (!last) return <Text tone="muted">—</Text>;
        return (
          <Inline asChild gap="condensed" underline="hover">
            <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: last.id }} onClick={(event) => event.stopPropagation()}>
              <RunStatusBadge status={last.status} />
              <Text truncate variant="caption" tone="muted">{dateTime(last.createdAt)}</Text>
            </Link>
          </Inline>
        );
      },
    },
    {
      id: 'run',
      header: () => <Text srOnly>실행</Text>,
      meta: { width: 88, dense: true, label: '실행', hideable: false },
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <RunDialog
            projectId={projectId}
            workflowId={row.original.id}
            trigger={
              <Button variant="ghost" disabledReason={row.original.errorCount > 0 && `오류 ${row.original.errorCount}개를 고친 뒤 실행할 수 있습니다.`}>
                <Play /> 실행
              </Button>
            }
          />
        </div>
      ),
    },
    {
      id: 'duplicate',
      header: () => <Text srOnly>복제</Text>,
      meta: { width: 48, dense: true, label: '복제', hideable: false },
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" reveal="row" aria-label={`${row.original.name} 복제`} disabled={duplicate.isPending} onClick={(event) => { event.stopPropagation(); duplicate.mutate(row.original); }}>
          <Copy />
        </Button>
      ),
    },
    {
      id: 'delete',
      header: () => <Text srOnly>삭제</Text>,
      meta: { width: 48, dense: true, label: '삭제', hideable: false },
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" reveal="row" hoverTone="danger" aria-label={`${row.original.name} 삭제`}>
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
      <Stack height="full" minHeight={0}>
        <HeaderActions>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={create.isPending}>
                <Plus /> 새 워크플로
              </Button>
            </DropdownMenuTrigger>
            <Box asChild width="popover">
            <DropdownMenuContent align="end">
              {/* One list: the blank workflow is a choice like the templates, so it reads the same. */}
              {[{ key: undefined, name: '빈 워크플로', description: '노드 없이 처음부터 만듭니다.' }, ...WORKFLOW_TEMPLATES].map((template, index) => (
                <Fragment key={template.key ?? 'blank'}>
                  {index === 1 && <DropdownMenuSeparator />}
                  <Stack asChild gap="hair" align="start">
                    <DropdownMenuItem onClick={() => create.mutate(template.key)}>
                      <Text weight="medium">{template.name}</Text>
                      <Text variant="caption" tone="muted">{template.description}</Text>
                    </DropdownMenuItem>
                  </Stack>
                </Fragment>
              ))}
            </DropdownMenuContent>
            </Box>
          </DropdownMenu>
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
      </Stack>
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
