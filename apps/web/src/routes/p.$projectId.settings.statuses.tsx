import { useState } from 'react';
import { MarkPane } from '@/components/settings/mark-pane';
import { StatusPane } from '@/components/settings/status-pane';
import { TagPane } from '@/components/settings/tag-pane';
import { scopeLabel, type StatusForm, type StatusRowData, type TagForm, type TagRowData } from '@/components/settings/status-types';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARK_IDS, AUTO_MARKS, markColor, REVIEW_TAG, type AutoMark, type MarkColors } from '@tw/shared';
import { EmptyState, DataTable, type ColumnDef, SplitPane, FilterBar, AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusIcon, TagChip, HelpTip } from '@loca/ui';
import { Page } from '@/components/page';
import { MarkChip } from '@/components/status';
import { client, unwrap } from '@/lib/api';
import { STATUS_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { optimistic } from '@/lib/optimistic';

type StatusSearch = { status?: string; tag?: string; mark?: AutoMark };
const param = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const Route = createFileRoute('/p/$projectId/settings/statuses')({
  validateSearch: (raw: Record<string, unknown>): StatusSearch => ({ status: param(raw.status), tag: param(raw.tag), mark: AUTO_MARK_IDS.find((id) => id === raw.mark) }),
  component: StatusSettings,
});

function StatusSettings() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const data = useQuery(q.statuses(projectId));
  const statuses = data.data ? (data.data.statuses as StatusRowData[]) : undefined;
  const tags = data.data ? (data.data.tags as TagRowData[]) : undefined;
  const project = useQuery(q.project(projectId));
  const markColors = (project.data?.markColors ?? {}) as MarkColors;
  const [removing, setRemoving] = useState<StatusRowData | null>(null);
  const [moveTo, setMoveTo] = useState<string>('');

  /** Only one of the two panes is open at a time; the selection lives in the URL. */
  const open = (next: StatusSearch) => void navigate({ search: next, replace: true });
  const close = () => open({});
  const selectedStatus = search.status && search.status !== 'new' ? statuses?.find((status) => status.id === search.status) : undefined;
  const selectedMark = search.mark;
  const selectedTag = search.tag && search.tag !== 'new' ? tags?.find((tag) => tag.id === search.tag) : undefined;

  useReportView('statuses', [
    selectedStatus && { kind: '상태', id: selectedStatus.id, label: selectedStatus.name },
    selectedTag && { kind: '태그', id: selectedTag.id, label: selectedTag.name },
    selectedMark && { kind: '자동 표시', id: selectedMark, label: AUTO_MARKS[selectedMark].name },
  ]);
  const fail = (error: Error) => toast.error(error.message);
  const queryClient = useQueryClient();
  const reorder = useMutation({
    mutationFn: (ids: string[]) => unwrap(client.projects[':projectId'].statuses.order.$put({ param: { projectId }, json: { ids } })),
    // The row moves at once; a failure moves it back.
    onMutate: async (ids) => ({
      undo: await optimistic(queryClient, [
        { key: q.statuses(projectId).queryKey, update: (data: { statuses: { id: string }[] }) => ({ ...data, statuses: [...data.statuses].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) }) },
      ]),
    }),
    onError: (error, _ids, context) => {
      context?.undo();
      fail(error);
    },
  });
  const create = useMutation({
    mutationFn: (json: StatusForm) => unwrap(client.projects[':projectId'].statuses.$post({ param: { projectId }, json })),
    onSuccess: () => {
      close();
      toast.success('상태를 추가했습니다.');
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (variables: { id: string; json: Partial<StatusForm> }) =>
      unwrap(client.projects[':projectId'].statuses[':id'].$patch({ param: { projectId, id: variables.id }, json: variables.json })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (variables: { id: string; moveTo: string }) =>
      unwrap(client.projects[':projectId'].statuses[':id'].$delete({ param: { projectId, id: variables.id }, json: { moveTo: variables.moveTo } })),
    onSuccess: () => {
      setRemoving(null);
      close();
      toast.success('상태를 삭제하고 대사를 옮겼습니다.');
    },
    onError: fail,
  });
  const createTag = useMutation({
    mutationFn: (json: TagForm) => unwrap(client.projects[':projectId'].tags.$post({ param: { projectId }, json })),
    onSuccess: () => {
      close();
      toast.success('태그를 추가했습니다.');
    },
    onError: fail,
  });
  const updateTag = useMutation({
    mutationFn: (variables: { id: string; json: Partial<TagForm> }) =>
      unwrap(client.projects[':projectId'].tags[':id'].$patch({ param: { projectId, id: variables.id }, json: variables.json })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: fail,
  });
  const saveMarkColor = useMutation({
    mutationFn: (variables: { mark: AutoMark; color: string }) => {
      // A color equal to the default is not stored, so a later default change still reaches the project.
      const next: MarkColors = { ...markColors, [variables.mark]: variables.color };
      if (variables.color === AUTO_MARKS[variables.mark].color) delete next[variables.mark];
      return unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { markColors: next } }));
    },
    onMutate: async (variables) => ({
      undo: await optimistic(queryClient, [{ key: q.project(projectId).queryKey, update: (data: { markColors?: MarkColors }) => ({ ...data, markColors: { ...data.markColors, [variables.mark]: variables.color } }) }]),
    }),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error, _variables, context) => {
      context?.undo();
      fail(error);
    },
  });
  const removeTag = useMutation({
    mutationFn: (id: string) => unwrap(client.projects[':projectId'].tags[':id'].$delete({ param: { projectId, id } })),
    onSuccess: () => {
      close();
      toast.success('태그를 삭제했습니다.');
    },
    onError: fail,
  });

  const move = (status: StatusRowData, delta: number) => {
    if (!statuses) return;
    const ids = statuses.map((item) => item.id);
    const index = ids.indexOf(status.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    reorder.mutate(ids);
  };

  const statusColumns: ColumnDef<StatusRowData, unknown>[] = [
    { id: 'order', header: '순서', meta: { width: 56, className: 'text-muted-foreground tabular-nums' }, cell: ({ row }) => row.index + 1 },
    {
      id: 'name',
      header: '이름',
      meta: { hideable: false },
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <StatusIcon status={row.original} className="size-2.5" />
          {row.original.name}
        </span>
      ),
    },
    { id: 'kind', header: '종류', meta: { width: 112, className: 'text-muted-foreground' }, cell: ({ row }) => STATUS_KIND[row.original.kind] },
    { id: 'review', header: '검토함에 표시', meta: { width: 120 }, cell: ({ row }) => (row.original.inReview ? '표시' : <span className="text-muted-foreground">–</span>) },
    { id: 'human', header: '사람만 지정', meta: { width: 104 }, cell: ({ row }) => (row.original.humanOnly ? '사람만' : <span className="text-muted-foreground">–</span>) },
    { id: 'units', header: '대사 수', meta: { width: 96, align: 'end' }, cell: ({ row }) => row.original.units.toLocaleString() },
  ];
  // One table: the built-in tags first (marks the app reads off, then tags the app puts on), then the person's own.
  type AnyTag = { id: string; mark?: AutoMark; tag?: TagRowData };
  const allTags: AnyTag[] | undefined = tags && [
    ...AUTO_MARK_IDS.map((mark) => ({ id: `mark:${mark}`, mark })),
    ...tags.filter((tag) => tag.role).map((tag) => ({ id: tag.id, tag })),
    ...tags.filter((tag) => !tag.role).map((tag) => ({ id: tag.id, tag })),
  ];
  const tagColumns: ColumnDef<AnyTag, unknown>[] = [
    {
      id: 'name',
      header: '이름',
      meta: { width: 220, hideable: false },
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          {row.original.mark ? <MarkChip mark={row.original.mark} projectId={projectId} /> : <TagChip tag={row.original.tag!} />}
          {(row.original.mark || row.original.tag?.role) && <span className="text-xs text-muted-foreground">기본</span>}
        </span>
      ),
    },
    {
      id: 'on',
      header: '붙는 곳',
      meta: { width: 140, className: 'text-muted-foreground' },
      cell: ({ row }) => scopeLabel(row.original.mark ? AUTO_MARKS[row.original.mark].on : row.original.tag!.scope),
    },
    {
      id: 'description',
      header: '뜻',
      meta: { className: 'text-muted-foreground' },
      cell: ({ row }) =>
        row.original.mark
          ? AUTO_MARKS[row.original.mark].description
          : row.original.tag?.role === REVIEW_TAG.role
            ? '분석이 확인이 필요하다고 본 자료. 사람이 정하거나 고치면 떨어짐'
            : row.original.tag?.role
              ? '검사·검수가 찾은 문제 유형. 고치면 떨어짐'
              : '',
    },
    { id: 'units', header: '붙은 수', meta: { width: 88, align: 'end' }, cell: ({ row }) => (row.original.tag ? (row.original.tag.units + (row.original.tag.items ?? 0)).toLocaleString() : <span className="text-muted-foreground">–</span>) },
  ];

  const pane =
    selectedMark ? (
      <MarkPane key={selectedMark} mark={selectedMark} color={markColor(selectedMark, markColors)} pending={saveMarkColor.isPending} onClose={close} onSave={(color) => saveMarkColor.mutate({ mark: selectedMark, color })} />
    ) : search.status === 'new' ? (
      <StatusPane key="new" pending={create.isPending} onClose={close} onSave={(form) => create.mutate(form)} />
    ) : selectedStatus ? (
      <StatusPane
        key={selectedStatus.id}
        status={selectedStatus}
        index={statuses!.indexOf(selectedStatus)}
        count={statuses!.length}
        pending={update.isPending}
        reordering={reorder.isPending}
        onClose={close}
        onSave={(_form, changed) => update.mutate({ id: selectedStatus.id, json: changed })}
        onMove={(delta) => move(selectedStatus, delta)}
        onDelete={() => {
          setRemoving(selectedStatus);
          setMoveTo('');
        }}
      />
    ) : search.tag === 'new' ? (
      <TagPane key="new" pending={createTag.isPending} onClose={close} onSave={(form) => createTag.mutate(form)} />
    ) : selectedTag ? (
      <TagPane key={selectedTag.id} tag={selectedTag} pending={updateTag.isPending} onClose={close} onSave={(_form, changed) => updateTag.mutate({ id: selectedTag.id, json: selectedTag.role ? { color: changed.color } : changed })} onDelete={() => removeTag.mutate(selectedTag.id)} />
    ) : null;

  return (
    <Page title="상태·태그" flush>
      <SplitPane id="settings-statuses" defaultWidth="384px" className="h-full" pane={pane}>
        <div className="min-h-0 flex-1 overflow-auto">
          <FilterBar end={<>
            {statuses && <span className="text-2xs font-medium text-subtle-foreground tabular-nums">{statuses.length}개</span>}
            <Button variant="outline" size="sm" onClick={() => open({ status: 'new' })}><Plus /> 추가</Button>
          </>}>
            <h2 className="flex items-center gap-1 text-sm font-semibold">상태 <HelpTip label="‘검토함에 표시’ 상태 도움말">이 상태의 대사는 사람이 바꾸든 워크플로가 바꾸든 검토함에 모입니다. 검토함에서는 다른 상태 중 하나를 골라 옮기는 것으로 결정합니다.</HelpTip></h2>
          </FilterBar>
          <DataTable id="statuses"
            className="flex-none"
            columns={statusColumns}
            rows={statuses}
            rowId={(row) => row.id}
            selected={search.status}
            empty={<EmptyState noun="상태" />}
            onRowClick={(row) => open({ status: row.id })}
          />
          <FilterBar className="mt-8" end={<>
            {allTags && <span className="text-2xs font-medium text-subtle-foreground tabular-nums">{allTags.length}개</span>}
            <Button variant="outline" size="sm" onClick={() => open({ tag: 'new' })}><Plus /> 추가</Button>
          </>}>
            <h2 className="flex items-center gap-1 text-sm font-semibold">태그 <HelpTip label="태그 도움말">상태와 별개로 여러 개 붙는 표시입니다. 필터·실행 범위·워크플로 조건에서 고릅니다. ‘기본’은 앱이 붙이거나 읽어 내는 태그로, 지우거나 이름을 바꿀 수 없고 색만 바꿉니다. 내 태그(예: #재검토)는 대사를 골라 붙이거나 상태 변경 노드로 붙입니다.</HelpTip></h2>
          </FilterBar>
          <DataTable
            id="tags"
            className="flex-none"
            columns={tagColumns}
            rows={allTags}
            rowId={(row) => row.id}
            selected={search.mark ? `mark:${search.mark}` : search.tag}
            onRowClick={(row) => open(row.mark ? { mark: row.mark } : { tag: row.id })}
          />
        </div>
      </SplitPane>

      <AlertDialog open={!!removing} onOpenChange={(next) => !next && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>“{removing?.name}” 상태를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 상태의 대사 {removing?.units.toLocaleString()}개를 다른 상태로 옮깁니다. 이 상태를 쓰는 워크플로 노드는 검증에 실패하므로 수정해야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={moveTo} onValueChange={setMoveTo}>
            <SelectTrigger className="w-full" aria-label="옮길 상태">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(statuses ?? [])
                .filter((status) => status.id !== removing?.id)
                .map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    <StatusIcon status={status} /> {status.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button variant="destructive" disabled={!moveTo || remove.isPending} onClick={() => removing && remove.mutate({ id: removing.id, moveTo })}>
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

