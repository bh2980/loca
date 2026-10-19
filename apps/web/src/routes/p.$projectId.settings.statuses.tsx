import { useState } from 'react';
import { MarkPane } from '@/components/settings/mark-pane';
import { StatusPane } from '@/components/settings/status-pane';
import { TagPane } from '@/components/settings/tag-pane';
import { scopeLabel, type StatusForm, type StatusRowData, type TagForm, type TagRowData } from '@/components/settings/status-types';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARK_IDS, AUTO_MARKS, markColor, normalizeTagScopes, REVIEW_TAG, TAG_SCOPE_LABELS, TAG_SCOPES, type AutoMark, type MarkColors } from '@tw/shared';
import { EmptyState, DataTable, type ColumnDef, SplitPane, AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusIcon, TagChip, SettingsContent, SettingsSection, ContextMenuItem, ContextMenuSeparator } from '@loca/ui';
import { Page } from '@/components/page';
import { MarkChip } from '@/components/status';
import { client, unwrap } from '@/lib/api';
import { STATUS_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { usePicked } from '@/lib/use-picked';
import { HeaderFilter } from '@/components/header-filter';
import { optimistic } from '@/lib/optimistic';

type StatusSearch = { status?: string; tag?: string; mark?: AutoMark; on?: TagFilterPlace };
/** 붙는 곳 filter of the tag table ('knowledge' is not a place of its own). */
const TAG_FILTER_PLACES = TAG_SCOPES.filter((place) => place !== 'knowledge');
type TagFilterPlace = (typeof TAG_FILTER_PLACES)[number];
const param = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const Route = createFileRoute('/p/$projectId/settings/statuses')({
  validateSearch: (raw: Record<string, unknown>): StatusSearch => ({ status: param(raw.status), tag: param(raw.tag), mark: AUTO_MARK_IDS.find((id) => id === raw.mark), on: TAG_FILTER_PLACES.find((place) => place === raw.on) }),
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
  const [removing, setRemoving] = useState<StatusRowData[] | null>(null);
  const statusPicks = usePicked(`statuses.${projectId}`);
  const tagPicks = usePicked(`tags.${projectId}`);
  const [moveTo, setMoveTo] = useState<string>('');

  /** Only one of the two panes is open at a time; the selection lives in the URL (the tag filter stays). */
  const open = (next: StatusSearch) => void navigate({ search: { ...next, on: search.on }, replace: true });
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
    mutationFn: (variables: { ids: string[]; moveTo: string }) =>
      unwrap(client.projects[':projectId'].statuses.delete.$post({ param: { projectId }, json: variables })),
    onSuccess: (_result, variables) => {
      setRemoving(null);
      statusPicks.clear();
      if (search.status && variables.ids.includes(search.status)) close();
      toast.success(`상태 ${variables.ids.length}개를 삭제하고 대사를 옮겼습니다.`);
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
  const removeTags = useMutation({
    mutationFn: (ids: string[]) => unwrap(client.projects[':projectId'].tags.delete.$post({ param: { projectId }, json: { ids } })),
    onSuccess: (_result, ids) => {
      tagPicks.clear();
      if (search.tag && ids.includes(search.tag)) close();
      toast.success(`태그 ${ids.length}개를 삭제했습니다.`);
    },
    onError: fail,
  });
  const reorderTags = useMutation({
    mutationFn: (ids: string[]) => unwrap(client.projects[':projectId'].tags.order.$put({ param: { projectId }, json: { ids } })),
    onMutate: async (ids) => ({
      undo: await optimistic(queryClient, [
        { key: q.statuses(projectId).queryKey, update: (data: { tags: { id: string }[] }) => ({ ...data, tags: [...data.tags].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) }) },
      ]),
    }),
    onError: (error, _ids, context) => {
      context?.undo();
      fail(error);
    },
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
    { id: 'review', header: '검토함', meta: { width: 120 }, cell: ({ row }) => (row.original.inReview ? '표시' : <span className="text-muted-foreground">–</span>) },
    { id: 'units', header: '대사 수', meta: { width: 96, align: 'end' }, cell: ({ row }) => row.original.units.toLocaleString() },
  ];
  // One table: the built-in tags first (marks the app reads off, then tags the app puts on), then the person's own.
  type AnyTag = { id: string; mark?: AutoMark; tag?: TagRowData };
  const placesOf = (row: AnyTag) => normalizeTagScopes(row.mark ? AUTO_MARKS[row.mark].on : row.tag!.scope);
  const allTags: AnyTag[] | undefined = tags && [
    ...AUTO_MARK_IDS.map((mark) => ({ id: `mark:${mark}`, mark })),
    ...tags.filter((tag) => tag.role).map((tag) => ({ id: tag.id, tag })),
    ...tags.filter((tag) => !tag.role).map((tag) => ({ id: tag.id, tag })),
  ];
  const shownTags = allTags && search.on ? allTags.filter((row) => placesOf(row).includes(search.on!)) : allTags;
  const ownTag = (row: AnyTag) => Boolean(row.tag && !row.tag.role);
  const pickedTagIds = (shownTags ?? []).filter((row) => ownTag(row) && tagPicks.picked.has(row.id)).map((row) => row.id);
  const pickedStatuses = (statuses ?? []).filter((status) => statusPicks.picked.has(status.id));
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
      header: () => (
        <HeaderFilter
          label="붙는 곳"
          value={search.on}
          options={TAG_FILTER_PLACES.map((place) => ({ value: place, label: TAG_SCOPE_LABELS[place] }))}
          onChange={(on) => void navigate({ search: (previous) => ({ ...previous, on: on as TagFilterPlace | undefined }), replace: true })}
        />
      ),
      meta: { width: 140, label: '붙는 곳', className: 'text-muted-foreground' },
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
        count={statuses!.length}
        pending={update.isPending}
        onClose={close}
        onSave={(_form, changed) => update.mutate({ id: selectedStatus.id, json: changed })}
        onDelete={() => {
          setRemoving([selectedStatus]);
          setMoveTo('');
        }}
      />
    ) : search.tag === 'new' ? (
      <TagPane key="new" pending={createTag.isPending} onClose={close} onSave={(form) => createTag.mutate(form)} />
    ) : selectedTag ? (
      <TagPane key={selectedTag.id} tag={selectedTag} pending={updateTag.isPending} onClose={close} onSave={(_form, changed) => updateTag.mutate({ id: selectedTag.id, json: selectedTag.role ? { color: changed.color } : changed })} onDelete={() => removeTags.mutate([selectedTag.id])} />
    ) : null;

  return (
    <Page title="상태·태그" flush>
      <SplitPane id="settings-statuses" selectionKey={search.status ?? search.tag ?? search.mark} defaultWidth="384px" className="h-full" pane={pane}>
        <SettingsContent width="wide">
          <div className="space-y-8">
            <SettingsSection
              title="상태"
              headerActions={
                <>
                  {statuses && <span className="text-xs text-muted-foreground tabular-nums">{statuses.length}개</span>}
                  <Button variant="outline" onClick={() => open({ status: 'new' })}><Plus /> 추가</Button>
                </>
              }
            >
              <div className="overflow-hidden rounded-md border border-border bg-card">
                <DataTable
                  id="statuses"
                  className="flex-none"
                  columns={statusColumns}
                  rows={statuses}
                  rowId={(row) => row.id}
                  selected={search.status}
                  empty={<EmptyState noun="상태" />}
                  onRowClick={(row) => open({ status: row.id })}
                  picked={statusPicks.picked}
                  onPick={statusPicks.pick}
                  bulk={
                    <Button variant="outline" className="text-destructive" disabled={pickedStatuses.length >= (statuses?.length ?? 0)} title={pickedStatuses.length >= (statuses?.length ?? 0) ? '상태를 모두 지울 수는 없습니다' : undefined} onClick={() => { setRemoving(pickedStatuses); setMoveTo(''); }}>
                      <Trash2 /> 삭제
                    </Button>
                  }
                  onReorder={(ids) => reorder.mutate(ids)}
                  rowLabel={(row) => row.name}
                  rowContextMenu={(row) => {
                    const index = statuses?.indexOf(row) ?? -1;
                    const count = statuses?.length ?? 0;
                    return (
                      <>
                        <ContextMenuItem onClick={() => open({ status: row.id })}>상태 편집</ContextMenuItem>
                        {index > 0 && <ContextMenuItem onClick={() => move(row, -1)}>위로 이동</ContextMenuItem>}
                        {index >= 0 && index < count - 1 && <ContextMenuItem onClick={() => move(row, 1)}>아래로 이동</ContextMenuItem>}
                        {count >= 2 && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() => {
                                setRemoving(statusPicks.picked.has(row.id) && pickedStatuses.length > 1 ? pickedStatuses : [row]);
                                setMoveTo('');
                              }}
                            >
                              삭제
                            </ContextMenuItem>
                          </>
                        )}
                      </>
                    );
                  }}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              title="태그"
              headerActions={
                <>
                  {shownTags && <span className="text-xs text-muted-foreground tabular-nums">{shownTags.length}개</span>}
                  <Button variant="outline" onClick={() => open({ tag: 'new' })}><Plus /> 추가</Button>
                </>
              }
            >
              <div className="overflow-hidden rounded-md border border-border bg-card">
                <DataTable
                  id="tags"
                  className="flex-none"
                  columns={tagColumns}
                  rows={shownTags}
                  rowId={(row) => row.id}
                  selected={search.mark ? `mark:${search.mark}` : search.tag}
                  empty={<EmptyState noun="태그" filtered={Boolean(search.on)} />}
                  onRowClick={(row) => open(row.mark ? { mark: row.mark } : { tag: row.id })}
                  picked={tagPicks.picked}
                  onPick={tagPicks.pick}
                  canPick={ownTag}
                  bulk={
                    <Button variant="outline" className="text-destructive" disabled={!pickedTagIds.length || removeTags.isPending} onClick={() => removeTags.mutate(pickedTagIds)}>
                      <Trash2 /> 삭제
                    </Button>
                  }
                  // Only the person's own tags move, and only in the whole list (a filtered list would hide where they land).
                  onReorder={search.on ? undefined : (ids) => reorderTags.mutate(ids.filter((id) => tags?.some((tag) => tag.id === id && !tag.role)))}
                  reorderable={ownTag}
                  rowLabel={(row) => row.tag?.name ?? AUTO_MARKS[row.mark!].name}
                  rowContextMenu={(row) => (
                    <>
                      <ContextMenuItem onClick={() => open(row.mark ? { mark: row.mark } : { tag: row.id })}>
                        {row.mark ? '색상 편집' : '태그 편집'}
                      </ContextMenuItem>
                      {row.tag && !row.tag.role && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() => removeTags.mutate(tagPicks.picked.has(row.id) && pickedTagIds.length > 1 ? pickedTagIds : [row.tag!.id])}
                          >
                            삭제
                          </ContextMenuItem>
                        </>
                      )}
                    </>
                  )}
                />
              </div>
            </SettingsSection>
          </div>
        </SettingsContent>
      </SplitPane>

      <AlertDialog open={!!removing} onOpenChange={(next) => !next && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removing?.length === 1 ? `“${removing[0]!.name}” 상태를 삭제할까요?` : `상태 ${removing?.length ?? 0}개를 삭제할까요?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && removing.length > 1 ? `${removing.map((status) => status.name).join(', ')}의 ` : '이 상태의 '}대사 {(removing ?? []).reduce((sum, status) => sum + status.units, 0).toLocaleString()}개를 다른 상태로 옮깁니다. 지운 상태를 쓰는 워크플로 노드는 검증에 실패하므로 수정해야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={moveTo} onValueChange={setMoveTo}>
            <SelectTrigger className="w-full" aria-label="옮길 상태">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(statuses ?? [])
                .filter((status) => !removing?.some((gone) => gone.id === status.id))
                .map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    <StatusIcon status={status} /> {status.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button variant="destructive" disabled={!moveTo || remove.isPending} onClick={() => removing && remove.mutate({ ids: removing.map((status) => status.id), moveTo })}>
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

