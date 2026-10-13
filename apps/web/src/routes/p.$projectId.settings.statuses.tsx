import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARK_IDS, AUTO_MARKS, markColor, REVIEW_TAG, STATUS_COLORS, type AutoMark, type MarkColors } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane, FieldRow, PaneSection } from '@/components/detail-pane';
import { Page } from '@/components/page';
import { SplitPane } from '@/components/split-pane';
import { chipStyle, MarkChip, StatusDot, TagChip } from '@/components/status';
import { Toolbar } from '@/components/toolbar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { STATUS_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { optimistic } from '@/lib/optimistic';
import { cn } from '@/lib/utils';

type StatusSearch = { status?: string; tag?: string; mark?: AutoMark };
const param = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const Route = createFileRoute('/p/$projectId/settings/statuses')({
  validateSearch: (raw: Record<string, unknown>): StatusSearch => ({ status: param(raw.status), tag: param(raw.tag), mark: AUTO_MARK_IDS.find((id) => id === raw.mark) }),
  component: StatusSettings,
});

type Kind = keyof typeof STATUS_KIND;
interface StatusRowData {
  id: string;
  name: string;
  color: string;
  kind: Kind;
  units: number;
  inReview: boolean;
  humanOnly: boolean;
}
interface TagRowData {
  id: string;
  name: string;
  color: string;
  units: number;
  role?: string | null;
}
const ON_LABELS = { lines: '대사', knowledge: '자료', terms: '용어집' } as const;
type StatusForm = { name: string; color: string; kind: Kind; inReview: boolean; humanOnly: boolean };

function Swatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="색상">
      {STATUS_COLORS.map((color) => (
        <Button
          key={color}
          type="button"
          variant="ghost"
          size="icon"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={cn(value === color && 'bg-muted ring-1 ring-foreground/40')}
        >
          <StatusDot color={color} className="size-4" />
        </Button>
      ))}
    </div>
  );
}

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
    mutationFn: (json: { name: string; color: string }) => unwrap(client.projects[':projectId'].tags.$post({ param: { projectId }, json })),
    onSuccess: () => {
      close();
      toast.success('태그를 추가했습니다.');
    },
    onError: fail,
  });
  const updateTag = useMutation({
    mutationFn: (variables: { id: string; json: { name?: string; color?: string } }) =>
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
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <StatusDot color={row.original.color} className="size-2.5" />
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
      meta: { width: 220 },
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
      cell: ({ row }) => (row.original.mark ? AUTO_MARKS[row.original.mark].on.map((where) => ON_LABELS[where]).join(' · ') : row.original.tag?.role === REVIEW_TAG.role ? '자료' : '대사'),
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
    { id: 'units', header: '붙은 수', meta: { width: 88, align: 'end' }, cell: ({ row }) => (row.original.tag ? row.original.tag.units.toLocaleString() : <span className="text-muted-foreground">–</span>) },
  ];

  const pane =
    selectedMark ? (
      <MarkPane key={selectedMark} mark={selectedMark} color={markColor(selectedMark, markColors)} pending={saveMarkColor.isPending} onClose={close} onSave={(color) => saveMarkColor.mutate({ mark: selectedMark, color })} />
    ) : search.status === 'new' ? (
      <StatusPane key="new" pending={create.isPending} onClose={close} onSave={(json) => create.mutate(json)} />
    ) : selectedStatus ? (
      <StatusPane
        key={selectedStatus.id}
        status={selectedStatus}
        index={statuses!.indexOf(selectedStatus)}
        count={statuses!.length}
        pending={update.isPending}
        reordering={reorder.isPending}
        onClose={close}
        onSave={(json) => update.mutate({ id: selectedStatus.id, json })}
        onMove={(delta) => move(selectedStatus, delta)}
        onDelete={() => {
          setRemoving(selectedStatus);
          setMoveTo('');
        }}
      />
    ) : search.tag === 'new' ? (
      <TagPane key="new" pending={createTag.isPending} onClose={close} onSave={(json) => createTag.mutate(json)} />
    ) : selectedTag ? (
      <TagPane key={selectedTag.id} tag={selectedTag} pending={updateTag.isPending} onClose={close} onSave={(json) => updateTag.mutate({ id: selectedTag.id, json })} onDelete={() => removeTag.mutate(selectedTag.id)} />
    ) : null;

  return (
    <Page title="상태·태그" flush>
      <SplitPane id="settings-statuses" defaultWidth="384px" className="h-full" pane={pane}>
        <div className="min-h-0 flex-1 overflow-auto">
          <Toolbar
            count={statuses ? `${statuses.length}개` : undefined}
            actions={
              <Button variant="outline" onClick={() => open({ status: 'new' })}>
                <Plus /> 추가
              </Button>
            }
          >
            <div>
              <h2 className="text-sm font-semibold">상태</h2>
              <p className="text-xs text-muted-foreground">‘검토함에 표시’를 켠 상태의 대사는 사람이 바꾸든 워크플로가 바꾸든 검토함에 모입니다. 검토함에서는 다른 상태 중 하나를 골라 옮기는 것으로 결정합니다.</p>
            </div>
          </Toolbar>
          <DataTable id="statuses"
            className="flex-none"
            columns={statusColumns}
            rows={statuses}
            rowId={(row) => row.id}
            selected={search.status}
            empty="상태가 없습니다."
            onRowClick={(row) => open({ status: row.id })}
          />
          <Toolbar
            className="mt-8 border-t"
            count={allTags ? `${allTags.length}개` : undefined}
            actions={
              <Button variant="outline" onClick={() => open({ tag: 'new' })}>
                <Plus /> 추가
              </Button>
            }
          >
            <div>
              <h2 className="text-sm font-semibold">태그</h2>
              <p className="text-xs text-muted-foreground">상태와 별개로 여러 개 붙는 표시입니다. 필터·실행 범위·워크플로 조건에서 고릅니다. ‘기본’은 앱이 붙이거나 읽어 내는 태그로, 지우거나 이름을 바꿀 수 없고 색만 바꿉니다. 내 태그(예: #재검토)는 대사를 골라 붙이거나 상태 변경 노드로 붙입니다.</p>
            </div>
          </Toolbar>
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
              <SelectValue placeholder="대사를 옮길 상태 선택" />
            </SelectTrigger>
            <SelectContent>
              {(statuses ?? [])
                .filter((status) => status.id !== removing?.id)
                .map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    <StatusDot color={status.color} /> {status.name}
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

/** Add or edit one status: its fields are a draft until saved; the order buttons act at once. */
function StatusPane({
  status,
  index = 0,
  count = 0,
  pending,
  reordering,
  onClose,
  onSave,
  onMove,
  onDelete,
}: {
  status?: StatusRowData;
  index?: number;
  count?: number;
  pending: boolean;
  reordering?: boolean;
  onClose: () => void;
  onSave: (form: StatusForm) => void;
  onMove?: (delta: number) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState<StatusForm>({ name: status?.name ?? '', color: status?.color ?? STATUS_COLORS[1], kind: status?.kind ?? 'normal', inReview: status?.inReview ?? false, humanOnly: status?.humanOnly ?? false });
  const dirty = !status || form.name !== status.name || form.color !== status.color || form.kind !== status.kind || form.inReview !== status.inReview || form.humanOnly !== status.humanOnly;
  return (
    <DetailPane
      kicker="상태"
      title={status ? status.name : '상태 추가'}
      subtitle={status ? `대사 ${status.units.toLocaleString()}개` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form)}>
            {status ? '저장' : '추가'}
          </Button>
          {onDelete && (
            <Button variant="outline" className="text-destructive" disabled={count < 2} onClick={onDelete}>
              <Trash2 /> 삭제
            </Button>
          )}
        </>
      }
    >
      <PaneSection title="설정">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="status-name">이름</FieldLabel>
            <Input id="status-name" value={form.name} placeholder="새 상태 이름" onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field>
            <FieldLabel>색상</FieldLabel>
            <Swatches value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </Field>
          <Field>
            <FieldLabel>종류</FieldLabel>
            <Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind: kind as Kind })}>
              <SelectTrigger className="w-full" aria-label="종류">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_KIND) as Kind[]).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {STATUS_KIND[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="status-review">검토함에 표시</FieldLabel>
            <Switch id="status-review" checked={form.inReview} onCheckedChange={(inReview) => setForm({ ...form, inReview })} />
          </Field>
          <FieldDescription>켜면 이 상태의 대사가 검토함에 모입니다.</FieldDescription>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="status-human">사람만 지정</FieldLabel>
            <Switch id="status-human" checked={form.humanOnly} onCheckedChange={(humanOnly) => setForm({ ...form, humanOnly })} />
          </Field>
          <FieldDescription>워크플로는 이 상태 대신 검토함으로 보냅니다.</FieldDescription>
        </FieldGroup>
      </PaneSection>
      {status && onMove && (
        <PaneSection title="순서">
          <FieldRow label={`${index + 1} / ${count}`}>
            <Button variant="outline" size="icon" disabled={index === 0 || reordering} onClick={() => onMove(-1)} aria-label={`${status.name} 위로`}>
              <ArrowUp />
            </Button>
            <Button variant="outline" size="icon" disabled={index === count - 1 || reordering} onClick={() => onMove(1)} aria-label={`${status.name} 아래로`}>
              <ArrowDown />
            </Button>
          </FieldRow>
        </PaneSection>
      )}
    </DetailPane>
  );
}

/** A built-in automatic tag: only its color is the project's to change. */
function MarkPane({ mark, color, pending, onClose, onSave }: { mark: AutoMark; color: string; pending: boolean; onClose: () => void; onSave: (color: string) => void }) {
  const [draft, setDraft] = useState(color);
  const info = AUTO_MARKS[mark];
  return (
    <DetailPane
      kicker="기본 태그"
      title={`#${info.name}`}
      subtitle={info.on.map((where) => ON_LABELS[where]).join(' · ')}
      onClose={onClose}
      footer={
        <>
          <Button disabled={draft === color || pending} onClick={() => onSave(draft)}>
            저장
          </Button>
          <Button variant="outline" disabled={draft === info.color} onClick={() => setDraft(info.color)}>
            기본 색으로
          </Button>
        </>
      }
    >
      <PaneSection title="설정">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>뜻</FieldLabel>
            <FieldDescription>{info.description}. 앱이 읽어 내므로 이름을 바꾸거나 지울 수 없습니다.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>색상</FieldLabel>
            <Swatches value={draft} onChange={setDraft} />
          </Field>
          <Field>
            <FieldLabel>미리보기</FieldLabel>
            <span>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" style={chipStyle(draft)}>
                #{info.name}
              </span>
            </span>
          </Field>
        </FieldGroup>
      </PaneSection>
    </DetailPane>
  );
}

function TagPane({ tag, pending, onClose, onSave, onDelete }: { tag?: TagRowData; pending: boolean; onClose: () => void; onSave: (form: { name: string; color: string }) => void; onDelete?: () => void }) {
  const [form, setForm] = useState({ name: tag?.name ?? '', color: tag?.color ?? STATUS_COLORS[2] });
  const dirty = !tag || form.name !== tag.name || form.color !== tag.color;
  return (
    <DetailPane
      kicker="태그"
      title={tag ? `#${tag.name}` : '태그 추가'}
      subtitle={tag ? `대사 ${tag.units.toLocaleString()}개` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form)}>
            {tag ? '저장' : '추가'}
          </Button>
          {tag && onDelete && !tag.role && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
                  <Trash2 /> 삭제
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>“#{tag.name}” 태그를 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>대사 {tag.units.toLocaleString()}개에서 이 태그가 제거됩니다. 이 태그를 쓰는 워크플로 노드는 수정해야 합니다.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>삭제</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </>
      }
    >
      <PaneSection title="설정">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="tag-name">이름</FieldLabel>
            <Input id="tag-name" value={form.name} placeholder="새 태그 이름" disabled={!!tag?.role} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field>
            <FieldLabel>색상</FieldLabel>
            <Swatches value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </Field>
        </FieldGroup>
      </PaneSection>
    </DetailPane>
  );
}
