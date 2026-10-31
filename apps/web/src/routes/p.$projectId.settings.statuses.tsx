import { useMemo, useState } from 'react';
import { StatusPane } from '@/components/settings/status-pane';
import { TagPane } from '@/components/settings/tag-pane';
import { scopeLabel, type StatusForm, type StatusRowData, type TagForm, type TagRowData } from '@/components/settings/status-types';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARK_IDS, AUTO_MARKS, markColor, markName, normalizeTagScopes, type MarkStyles, TAG_SCOPE_LABELS, TAG_SCOPES, type AutoMark } from '@tw/shared';
import { Box, EmptyState, Text, type ColumnDef, AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Select, SelectContent, SelectItem, SelectValue, StatusIcon, TagChip, ContextMenuItem, ContextMenuSeparator, SelectTrigger, Section, PageBody, SplitPane, DataTable, Inline } from '@loca/ui';
import { Page } from '@/components/page';
import { MarkChip } from '@/components/status';
import { MarkPane } from '@/components/settings/mark-pane';
import { client } from '@/lib/api';
import { sent } from '@/lib/collections';
import { reorderTaxonomy, useTaxonomy, useTaxonomyCounts } from '@/lib/knowledge';
import { STATUS_KIND } from '@/lib/labels';
import { useReportView } from '@/lib/view-context';
import { usePicked } from '@/lib/use-picked';
import { HeaderFilter } from '@/components/header-filter';
import { useProject, saveProject } from '@/lib/project';

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
  // The rows and their counts are the browser's collections (the counts kept apart: they change with every line).
  const taxonomy = useTaxonomy(projectId);
  const counts = useTaxonomyCounts(projectId);
  const statuses = useMemo<StatusRowData[] | undefined>(() => taxonomy.statuses?.map((status) => ({ ...status, units: counts.statuses.get(status.id) ?? 0 })), [taxonomy.statuses, counts]);
  const tags = useMemo<TagRowData[] | undefined>(() => taxonomy.tags?.map((tag) => ({ ...tag, units: 0, items: 0, ...counts.tags.get(tag.id) })), [taxonomy.tags, counts]);
  const [removing, setRemoving] = useState<StatusRowData[] | null>(null);
  const statusPicks = usePicked(`statuses.${projectId}`);
  const tagPicks = usePicked(`tags.${projectId}`);
  const [moveTo, setMoveTo] = useState<string>('');

  /** Only one of the two panes is open at a time; the selection lives in the URL (the tag filter stays). */
  const open = (next: StatusSearch) => void navigate({ search: { ...next, on: search.on }, replace: true });
  const close = () => open({});
  const selectedStatus = search.status && search.status !== 'new' ? statuses?.find((status) => status.id === search.status) : undefined;
  const selectedTag = search.tag && search.tag !== 'new' ? tags?.find((tag) => tag.id === search.tag) : undefined;
  const selectedMark = search.mark;
  const project = useProject(projectId);
  const markStyles = ((project.data as { markStyles?: MarkStyles } | undefined)?.markStyles ?? {}) as MarkStyles;

  useReportView('statuses', [
    selectedStatus && { kind: '상태', id: selectedStatus.id, label: selectedStatus.name },
    selectedTag && { kind: '태그', id: selectedTag.id, label: selectedTag.name },
  ]);
  const fail = (error: Error) => toast.error(error.message);
  // The row moves at once; a failure moves it back (reorderTaxonomy).
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderTaxonomy(projectId, 'statuses', ids),
    onError: fail,
  });
  const create = useMutation({
    mutationFn: (json: StatusForm) => sent(projectId, client.projects[':projectId'].statuses.$post({ param: { projectId }, json })),
    onSuccess: () => {
      close();
      toast.success('상태를 추가했습니다.');
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (variables: { id: string; json: Partial<StatusForm> }) =>
      sent(projectId, client.projects[':projectId'].statuses[':id'].$patch({ param: { projectId, id: variables.id }, json: variables.json })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (variables: { ids: string[]; moveTo: string }) =>
      sent(projectId, client.projects[':projectId'].statuses.delete.$post({ param: { projectId }, json: variables })),
    onSuccess: (_result, variables) => {
      setRemoving(null);
      statusPicks.clear();
      if (search.status && variables.ids.includes(search.status)) close();
      toast.success(`상태 ${variables.ids.length}개를 삭제하고 대사를 옮겼습니다.`);
    },
    onError: fail,
  });
  const createTag = useMutation({
    mutationFn: (json: TagForm) => sent(projectId, client.projects[':projectId'].tags.$post({ param: { projectId }, json })),
    onSuccess: () => {
      close();
      toast.success('태그를 추가했습니다.');
    },
    onError: fail,
  });
  // An automatic tag's name and colour for this project; what equals the app's default is not stored.
  const saveMarkStyle = useMutation({
    mutationFn: (variables: { mark: AutoMark; name: string; color: string }) => {
      const info = AUTO_MARKS[variables.mark];
      const own = { ...(variables.name !== info.name && { name: variables.name }), ...(variables.color !== info.color && { color: variables.color }) };
      const next: MarkStyles = { ...markStyles };
      if (Object.keys(own).length) next[variables.mark] = own;
      else delete next[variables.mark];
      return saveProject(projectId, { markStyles: next });
    },
    onSuccess: () => toast.success('저장했습니다.'),
    onError: fail,
  });
  const updateTag = useMutation({
    mutationFn: (variables: { id: string; json: Partial<TagForm> }) =>
      sent(projectId, client.projects[':projectId'].tags[':id'].$patch({ param: { projectId, id: variables.id }, json: variables.json })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: fail,
  });
  const removeTags = useMutation({
    mutationFn: (ids: string[]) => sent(projectId, client.projects[':projectId'].tags.delete.$post({ param: { projectId }, json: { ids } })),
    onSuccess: (_result, ids) => {
      tagPicks.clear();
      if (search.tag && ids.includes(search.tag)) close();
      toast.success(`태그 ${ids.length}개를 삭제했습니다.`);
    },
    onError: fail,
  });
  const reorderTags = useMutation({
    mutationFn: (ids: string[]) => reorderTaxonomy(projectId, 'tags', ids),
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
    { id: 'order', header: '순서', meta: { width: 56, tone: 'muted', tabular: true }, cell: ({ row }) => row.index + 1 },
    {
      id: 'name',
      header: '이름',
      meta: { hideable: false },
      cell: ({ row }) => (
        <Inline as="span" inline gap="condensed" weight="medium">
          <StatusIcon small status={row.original} />
          {row.original.name}
        </Inline>
      ),
    },
    { id: 'kind', header: '종류', meta: { width: 112, tone: 'muted' }, cell: ({ row }) => STATUS_KIND[row.original.kind] },
    { id: 'review', header: '검토함', meta: { width: 120 }, cell: ({ row }) => (row.original.inReview ? '표시' : <Text tone="muted">–</Text>) },
    { id: 'units', header: '대사 수', meta: { width: 96, align: 'end' }, cell: ({ row }) => row.original.units.toLocaleString() },
  ];
  // The project's tags, all of them a person's to change. The automatic tags (#AI 제안 대기…) have their own section below.
  type AnyTag = { id: string; tag: TagRowData };
  const placesOf = (row: AnyTag) => normalizeTagScopes(row.tag.scope);
  const allTags: AnyTag[] | undefined = tags?.map((tag) => ({ id: tag.id, tag }));
  const shownTags = allTags && search.on ? allTags.filter((row) => placesOf(row).includes(search.on!)) : allTags;
  const pickedTagIds = (shownTags ?? []).filter((row) => tagPicks.picked.has(row.id)).map((row) => row.id);
  const pickedStatuses = (statuses ?? []).filter((status) => statusPicks.picked.has(status.id));
  const tagColumns: ColumnDef<AnyTag, unknown>[] = [
    {
      id: 'name',
      header: '이름',
      meta: { width: 220, hideable: false },
      cell: ({ row }) => (
        <TagChip tag={row.original.tag} />
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
      meta: { width: 140, label: '붙는 곳', tone: 'muted' },
      cell: ({ row }) => scopeLabel(row.original.tag.scope),
    },
    {
      id: 'description',
      header: '설명',
      meta: { tone: 'muted' },
      cell: ({ row }) => row.original.tag.description ?? '',
    },
    { id: 'units', header: '붙은 수', meta: { width: 88, align: 'end' }, cell: ({ row }) => (row.original.tag.units + (row.original.tag.items ?? 0)).toLocaleString() },
  ];

  // The automatic tags: what the app reads off a line, a term or an item. Shown to be understood, not changed.
  const autoColumns: ColumnDef<{ id: AutoMark }, unknown>[] = [
    { id: 'name', header: '이름', meta: { width: 220 }, cell: ({ row }) => <MarkChip mark={row.original.id} /> },
    { id: 'on', header: '붙는 곳', meta: { width: 140, tone: 'muted' }, cell: ({ row }) => scopeLabel(AUTO_MARKS[row.original.id].on) },
    { id: 'description', header: '설명', meta: { tone: 'muted' }, cell: ({ row }) => AUTO_MARKS[row.original.id].description },
  ];
  const autoRows = (search.on ? AUTO_MARK_IDS.filter((id) => normalizeTagScopes(AUTO_MARKS[id].on).includes(search.on!)) : AUTO_MARK_IDS).map((id) => ({ id }));

  const pane =
    selectedMark ? (
      <MarkPane key={selectedMark} mark={selectedMark} style={{ name: markName(selectedMark, markStyles), color: markColor(selectedMark, markStyles) }} pending={saveMarkStyle.isPending} onClose={close} onSave={(style) => saveMarkStyle.mutate({ mark: selectedMark, ...style })} />
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
      <TagPane key={selectedTag.id} tag={selectedTag} pending={updateTag.isPending} onClose={close} onSave={(_form, changed) => updateTag.mutate({ id: selectedTag.id, json: changed })} onDelete={() => removeTags.mutate([selectedTag.id])} />
    ) : null;

  return (
    <Page title="상태·태그" flush>
      <SplitPane fill="height" id="settings-statuses" selectionKey={search.status ?? search.tag ?? search.mark} defaultWidth="384px" pane={pane}>
        <PageBody width="wide">
          <Box spaceY="wide">
            <Section variant="page"
              title="상태"
              actions={
                <>
                  {statuses && <Text variant="caption" tone="muted" tabular>{statuses.length}개</Text>}
                  <Button variant="outline" onClick={() => open({ status: 'new' })}><Plus /> 추가</Button>
                </>
              }
            >
              <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface">
                <DataTable compact
                  id="statuses"
                  columns={statusColumns}
                  rows={statuses}
                  rowId={(row) => row.id}
                  selected={search.status}
                  empty={<EmptyState noun="상태" />}
                  onRowClick={(row) => open({ status: row.id })}
                  picked={statusPicks.picked}
                  onPick={statusPicks.pick}
                  bulk={
                    <Button variant="outline" tone="danger" disabled={pickedStatuses.length >= (statuses?.length ?? 0)} title={pickedStatuses.length >= (statuses?.length ?? 0) ? '상태를 모두 지울 수는 없습니다' : undefined} onClick={() => { setRemoving(pickedStatuses); setMoveTo(''); }}>
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
              </Box>
            </Section>

            <Section variant="page"
              title="태그"
              description="모두 보통 태그입니다. 검사·검수 워크플로는 태그 붙이기 노드에서 고른 태그를 붙이고 떼며, 번역을 고쳐도 저절로 떨어지지 않습니다."
              actions={
                <>
                  {shownTags && <Text variant="caption" tone="muted" tabular>{shownTags.length}개</Text>}
                  <Button variant="outline" onClick={() => open({ tag: 'new' })}><Plus /> 추가</Button>
                </>
              }
            >
              <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface">
                <DataTable compact
                  id="tags"
                  columns={tagColumns}
                  rows={shownTags}
                  rowId={(row) => row.id}
                  selected={search.tag}
                  empty={<EmptyState noun="태그" filtered={Boolean(search.on)} />}
                  onRowClick={(row) => open({ tag: row.id })}
                  picked={tagPicks.picked}
                  onPick={tagPicks.pick}
                  bulk={
                    <Button variant="outline" tone="danger" disabled={!pickedTagIds.length || removeTags.isPending} onClick={() => removeTags.mutate(pickedTagIds)}>
                      <Trash2 /> 삭제
                    </Button>
                  }
                  // Only in the whole list (a filtered list would hide where they land).
                  onReorder={search.on ? undefined : (ids) => reorderTags.mutate(ids)}
                  rowLabel={(row) => row.tag.name}
                  rowContextMenu={(row) => (
                    <>
                      <ContextMenuItem onClick={() => open({ tag: row.id })}>태그 편집</ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => removeTags.mutate(tagPicks.picked.has(row.id) && pickedTagIds.length > 1 ? pickedTagIds : [row.tag.id])}
                      >
                        삭제
                      </ContextMenuItem>
                    </>
                  )}
                />
              </Box>
            </Section>

            <Section variant="page" title="자동 태그" actions={<Text variant="caption" tone="muted" tabular>{autoRows.length}개</Text>} description="앱이 상태를 보고 스스로 붙였다 떼는 태그입니다. 필터와 조건에서 고를 수 있고, 붙이거나 뗄 수는 없습니다.">
              <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface">
                <DataTable compact id="auto-tags" columns={autoColumns} rows={autoRows} rowId={(row) => row.id} selected={search.mark} onRowClick={(row) => open({ mark: row.id })} rowContextMenu={(row) => <ContextMenuItem onClick={() => open({ mark: row.id })}>태그 편집</ContextMenuItem>} />
              </Box>
            </Section>
          </Box>
        </PageBody>
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
            <SelectTrigger width="full" aria-label="옮길 상태">
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

