import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { AppDefaults, TemplateStatus, TemplateTag } from '@tw/shared';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Box, Button, ContextMenuItem, DataTable, EmptyState, Inline, PageBody, Section, SplitPane, StatusIcon, TagChip, Text, type ColumnDef } from '@loca/ui';
import { Page } from '@/components/page';
import { StatusPane } from '@/components/settings/status-pane';
import { TagPane } from '@/components/settings/tag-pane';
import { scopeLabel, type StatusForm, type TagForm } from '@/components/settings/status-types';
import { client, unwrap } from '@/lib/api';
import { STATUS_KIND } from '@/lib/labels';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

type StatusSearch = { status?: string; tag?: string };
const param = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const Route = createFileRoute('/settings/defaults/statuses')({
  validateSearch: (raw: Record<string, unknown>): StatusSearch => ({ status: param(raw.status), tag: param(raw.tag) }),
  component: AppStatusSettings,
});

type Patch = Partial<Pick<AppDefaults, 'statuses' | 'tags'>>;

/** The statuses and the person's own tags a new project starts with. Each edit saves the whole list; the server says what is wrong with it. */
function AppStatusSettings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const defaults = useQuery(q.appDefaults());
  const statuses = defaults.data?.statuses as TemplateStatus[] | undefined;
  const tags = defaults.data?.tags as TemplateTag[] | undefined;
  const [removing, setRemoving] = useState<TemplateStatus | null>(null);

  const open = (next: StatusSearch) => void navigate({ search: next, replace: true });
  const close = () => open({});
  const selectedStatus = search.status && search.status !== 'new' ? statuses?.find((status) => status.id === search.status) : undefined;
  const selectedTag = search.tag && search.tag !== 'new' ? tags?.find((tag) => tag.id === search.tag) : undefined;

  useReportView('settings-default-statuses', [
    selectedStatus && { kind: '기본 상태', id: selectedStatus.id, label: selectedStatus.name },
    selectedTag && { kind: '기본 태그', id: selectedTag.id, label: selectedTag.name },
  ]);

  const save = useMutation({
    mutationFn: (patch: Patch) => unwrap(client.app.defaults.$patch({ json: patch as never })),
    onMutate: async (patch) => ({ undo: await optimistic(queryClient, [{ key: q.appDefaults().queryKey, update: (old: object) => ({ ...old, ...patch }) }]) }),
    onError: (error, _patch, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
  const saved = (message: string, after?: () => void) => ({
    onSuccess: () => {
      toast.success(message);
      after?.();
    },
  });

  const statusList = statuses ?? [];
  const tagList = tags ?? [];
  const sorted = <T extends { id: string }>(list: T[], ids: string[]) => [...list].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const moveStatus = (status: TemplateStatus, delta: number) => {
    const ids = statusList.map((item) => item.id);
    const index = ids.indexOf(status.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    save.mutate({ statuses: sorted(statusList, ids) });
  };

  const addStatus = (form: StatusForm) => save.mutate({ statuses: [...statusList, { id: crypto.randomUUID(), ...form }] }, saved('상태를 추가했습니다.', close));
  const updateStatus = (id: string, changed: Partial<StatusForm>) => save.mutate({ statuses: statusList.map((status) => (status.id === id ? { ...status, ...changed } : status)) }, saved('저장했습니다.'));
  const removeStatus = (id: string) => save.mutate({ statuses: statusList.filter((status) => status.id !== id) }, saved('상태를 삭제했습니다.', () => { setRemoving(null); if (search.status === id) close(); }));
  const addTag = (form: TagForm) => save.mutate({ tags: [...tagList, { id: crypto.randomUUID(), ...form }] }, saved('태그를 추가했습니다.', close));
  const updateTag = (id: string, changed: Partial<TagForm>) => save.mutate({ tags: tagList.map((tag) => (tag.id === id ? { ...tag, ...changed } : tag)) }, saved('저장했습니다.'));
  const removeTag = (id: string) => save.mutate({ tags: tagList.filter((tag) => tag.id !== id) }, saved('태그를 삭제했습니다.', () => search.tag === id && close()));

  const statusColumns: ColumnDef<TemplateStatus, unknown>[] = [
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
  ];
  const tagColumns: ColumnDef<TemplateTag, unknown>[] = [
    { id: 'name', header: '이름', meta: { width: 220, hideable: false }, cell: ({ row }) => <TagChip tag={row.original} /> },
    { id: 'on', header: '붙는 곳', meta: { width: 160, tone: 'muted' }, cell: ({ row }) => scopeLabel(row.original.scope) },
    { id: 'description', header: '설명', meta: { tone: 'muted' }, cell: ({ row }) => row.original.description },
  ];

  const pane =
    search.status === 'new' ? (
      <StatusPane key="new" pending={save.isPending} onClose={close} onSave={addStatus} />
    ) : selectedStatus ? (
      <StatusPane key={selectedStatus.id} status={selectedStatus} count={statusList.length} pending={save.isPending} onClose={close} onSave={(_form, changed) => updateStatus(selectedStatus.id, changed)} onDelete={() => setRemoving(selectedStatus)} />
    ) : search.tag === 'new' ? (
      <TagPane key="new" pending={save.isPending} onClose={close} onSave={addTag} />
    ) : selectedTag ? (
      <TagPane key={selectedTag.id} tag={selectedTag} pending={save.isPending} onClose={close} onSave={(_form, changed) => updateTag(selectedTag.id, changed)} onDelete={() => removeTag(selectedTag.id)} />
    ) : null;

  return (
    <Page title="기본 상태·태그" flush>
      <SplitPane fill="height" id="settings-default-statuses" selectionKey={search.status ?? search.tag} defaultWidth="384px" pane={pane}>
        <PageBody width="wide">
          <Box spaceY="wide">
            <Text as="p" tone="muted">새 프로젝트가 처음 가지는 상태와 태그입니다. 바꿔도 이미 있는 프로젝트는 그대로입니다. 시작·최종 상태가 하나씩은 있어야 합니다.</Text>
            <Section
              variant="page"
              title="상태"
              actions={
                <>
                  {statuses && <Text variant="caption" tone="muted" tabular>{statuses.length}개</Text>}
                  <Button variant="outline" onClick={() => open({ status: 'new' })}><Plus /> 추가</Button>
                </>
              }
            >
              <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface">
                <DataTable
                  compact
                  id="default-statuses"
                  columns={statusColumns}
                  rows={statuses}
                  rowId={(row) => row.id}
                  selected={search.status}
                  empty={<EmptyState noun="상태" />}
                  onRowClick={(row) => open({ status: row.id === search.status ? undefined : row.id })}
                  onReorder={(ids) => save.mutate({ statuses: sorted(statusList, ids) })}
                  rowLabel={(row) => row.name}
                  rowContextMenu={(row) => {
                    const index = statusList.indexOf(row);
                    return (
                      <>
                        <ContextMenuItem onClick={() => open({ status: row.id })}>상태 편집</ContextMenuItem>
                        {index > 0 && <ContextMenuItem onClick={() => moveStatus(row, -1)}>위로 이동</ContextMenuItem>}
                        {index >= 0 && index < statusList.length - 1 && <ContextMenuItem onClick={() => moveStatus(row, 1)}>아래로 이동</ContextMenuItem>}
                      </>
                    );
                  }}
                />
              </Box>
            </Section>

            <Section
              variant="page"
              title="태그"
              description="사람이 만든 태그만 담깁니다. AI 실패 같은 앱의 태그는 프로젝트마다 자동으로 생깁니다."
              actions={
                <>
                  {tags && <Text variant="caption" tone="muted" tabular>{tags.length}개</Text>}
                  <Button variant="outline" onClick={() => open({ tag: 'new' })}><Plus /> 추가</Button>
                </>
              }
            >
              <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface">
                <DataTable
                  compact
                  id="default-tags"
                  columns={tagColumns}
                  rows={tags}
                  rowId={(row) => row.id}
                  selected={search.tag}
                  empty={<EmptyState noun="태그" />}
                  onRowClick={(row) => open({ tag: row.id === search.tag ? undefined : row.id })}
                  onReorder={(ids) => save.mutate({ tags: sorted(tagList, ids) })}
                  rowLabel={(row) => row.name}
                />
              </Box>
            </Section>
          </Box>
        </PageBody>
      </SplitPane>

      <AlertDialog open={!!removing} onOpenChange={(next) => !next && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>“{removing?.name}” 상태를 기본값에서 지울까요?</AlertDialogTitle>
            <AlertDialogDescription>새로 만드는 프로젝트가 이 상태를 받지 않습니다. 이미 있는 프로젝트는 그대로입니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button variant="destructive" disabled={save.isPending} onClick={() => removing && removeStatus(removing.id)}>
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
