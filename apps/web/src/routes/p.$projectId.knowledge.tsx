import { useMemo, useState, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Network, Play, Plus, Sparkles, Square, Table2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_KINDS, KNOWLEDGE_ORIGIN_LABELS, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, type KnowledgeOrigin, type SpeechLevel } from '@tw/shared';
import { Page } from '@/components/page';
import { RelationshipGraph } from '@/components/relationship-graph';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { DOCUMENT_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

const KINDS = { documents: '문서', characters: '인물', relationships: '관계', events: '사건', speechRules: '말투 규칙' } as const;
type Kind = keyof typeof KINDS;
type StatusView = 'candidate' | 'confirmed' | 'all';
interface KnowledgeSearch {
  tab?: Kind;
  status?: Exclude<StatusView, 'all'>;
  item?: string;
  /** Relationships drawn as a graph instead of a table. */
  view?: 'graph';
}

export const Route = createFileRoute('/p/$projectId/knowledge')({
  validateSearch: (raw: Record<string, unknown>): KnowledgeSearch => ({
    tab: typeof raw.tab === 'string' && raw.tab in KINDS ? (raw.tab as Kind) : undefined,
    status: raw.status === 'confirmed' || raw.status === 'candidate' ? raw.status : undefined,
    item: typeof raw.item === 'string' && raw.item ? raw.item : undefined,
    view: raw.view === 'graph' ? 'graph' : undefined,
  }),
  component: Knowledge,
});

/** Fields every draft row has, whatever its kind. */
interface Draft {
  id: string;
  status: 'candidate' | 'confirmed';
  origin: KnowledgeOrigin;
  evidence: string[];
}
type Value = string | boolean | string[] | null;
interface Field {
  name: string;
  label: string;
  type: 'text' | 'long' | 'list' | 'bool' | 'level' | 'key' | 'docKind' | 'character';
}
interface KindSpec {
  rows: (Draft & Record<string, unknown>)[];
  columns: { head: string; cell: (row: Draft & Record<string, unknown>) => ReactNode; className?: string }[];
  fields: Field[];
  label: (row: Draft & Record<string, unknown>) => string;
  save: (id: string, json: Record<string, Value>) => Promise<unknown>;
  /** Creates an empty item (a person's, confirmed) and returns its id; absent when it cannot be made yet. */
  create?: () => Promise<{ id: string }>;
  remove: (id: string) => Promise<unknown>;
  /** Shown under the fields (read-only facts such as relationship changes). */
  extra?: (row: Draft & Record<string, unknown>) => ReactNode;
}

const fail = (error: Error) => toast.error(error.message);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * The work's knowledge, one table per kind with a detail pane. "작품 분석" reads the whole script
 * and adds AI drafts here as candidates; only confirmed knowledge reaches AI context.
 */
function Knowledge() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? 'documents';
  const view: StatusView = search.status ?? 'all';
  const set = (next: Partial<KnowledgeSearch>, replace = true) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });

  const documents = useQuery(q.documents(projectId));
  const people = useQuery(q.characters(projectId));
  const storyEvents = useQuery(q.storyEvents(projectId));
  const rules = useQuery(q.speechRules(projectId));
  const nameOf = useMemo(() => new Map((people.data?.characters ?? []).map((c) => [c.id, c.name])), [people.data]);
  const api = client.projects[':projectId'];
  const param = (id: string) => ({ param: { projectId, id } });

  const specs: Record<Kind, KindSpec> = {
    documents: {
      rows: (documents.data ?? []) as KindSpec['rows'],
      columns: [
        { head: '제목', cell: (row) => text(row.title), className: 'font-medium' },
        { head: '종류', cell: (row) => DOCUMENT_KIND[row.kind as (typeof DOCUMENT_KINDS)[number]] },
        { head: '항상 포함', cell: (row) => (row.alwaysInclude ? <Badge variant="secondary">항상 포함</Badge> : null) },
        { head: '내용', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{text(row.body).replace(/[#*_>`]+/g, '').replace(/\s+/g, ' ')}</span> },
      ],
      fields: [
        { name: 'title', label: '제목', type: 'text' },
        { name: 'kind', label: '종류', type: 'docKind' },
        { name: 'alwaysInclude', label: '항상 포함 (모든 AI 요청에 전문을 넣음)', type: 'bool' },
        { name: 'body', label: '본문 (마크다운)', type: 'long' },
      ],
      create: () => unwrap(api.documents.$post({ param: { projectId }, json: { title: '새 문서', kind: 'note', body: '', alwaysInclude: false } })),
      label: (row) => text(row.title),
      save: (id, json) => unwrap(api.documents[':id'].$patch({ ...param(id), json: json as never })),
      remove: (id) => unwrap(api.documents[':id'].$delete(param(id))),
    },
    characters: {
      rows: (people.data?.characters ?? []) as KindSpec['rows'],
      columns: [
        { head: '이름', cell: (row) => <span className="font-medium">{text(row.name)}{row.player ? <Badge variant="outline" className="ml-2">플레이어</Badge> : null}</span> },
        { head: '별칭', cell: (row) => (row.aliases as string[]).join(', ') },
        { head: '프로필', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{text(row.profile)}</span> },
      ],
      fields: [
        { name: 'name', label: '이름', type: 'text' },
        { name: 'aliases', label: '별칭 (쉼표로 구분)', type: 'list' },
        { name: 'player', label: '플레이어 캐릭터', type: 'bool' },
        { name: 'profile', label: '프로필', type: 'long' },
        { name: 'speech', label: '말투 특징 (원문 관찰)', type: 'long' },
      ],
      label: (row) => text(row.name),
      save: (id, json) => unwrap(api.characters[':id'].$patch({ ...param(id), json: json as never })),
      create: () => unwrap(api.characters.$post({ param: { projectId }, json: { name: '새 인물' } as never })),
      remove: (id) => unwrap(api.characters[':id'].$delete(param(id))),
    },
    relationships: {
      rows: (people.data?.relationships ?? []) as KindSpec['rows'],
      columns: [
        { head: '인물', cell: (row) => `${nameOf.get(text(row.fromId)) ?? '?'} → ${nameOf.get(text(row.toId)) ?? '?'}`, className: 'font-medium' },
        { head: '관계', cell: (row) => text(row.kind) },
        { head: '변화', cell: (row) => ((row.changes as unknown[]).length ? `${(row.changes as unknown[]).length}번` : '—'), className: 'tabular-nums' },
        { head: '설명', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{text(row.description)}</span> },
      ],
      fields: [
        { name: 'fromId', label: '누가', type: 'character' },
        { name: 'toId', label: '누구에게', type: 'character' },
        { name: 'kind', label: '관계', type: 'text' },
        { name: 'mutual', label: '서로 같은 관계', type: 'bool' },
        { name: 'description', label: '설명', type: 'long' },
      ],
      label: (row) => `${nameOf.get(text(row.fromId)) ?? '?'} → ${nameOf.get(text(row.toId)) ?? '?'}`,
      save: (id, json) => unwrap(api.relationships[':id'].$patch({ ...param(id), json: json as never })),
      create:
        (people.data?.characters.length ?? 0) >= 2
          ? () => unwrap(api.relationships.$post({ param: { projectId }, json: { fromId: people.data!.characters[0].id, toId: people.data!.characters[1].id, kind: '관계' } as never }))
          : undefined,
      remove: (id) => unwrap(api.relationships[':id'].$delete(param(id))),
      extra: (row) => <RelationshipChanges projectId={projectId} changes={row.changes as { at: string; change: string; cause: string }[]} />,
    },
    events: {
      rows: (storyEvents.data ?? []) as KindSpec['rows'],
      columns: [
        { head: '사건', cell: (row) => text(row.title), className: 'font-medium' },
        { head: '관련 인물', cell: (row) => (row.participants as string[]).join(', ') },
        { head: '결과', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{text(row.outcome)}</span> },
      ],
      fields: [
        { name: 'title', label: '제목', type: 'text' },
        { name: 'summary', label: '요약', type: 'long' },
        { name: 'cause', label: '원인', type: 'long' },
        { name: 'outcome', label: '결과', type: 'long' },
        { name: 'participants', label: '관련 인물 (쉼표로 구분)', type: 'list' },
      ],
      label: (row) => text(row.title),
      save: (id, json) => unwrap(api.events[':id'].$patch({ ...param(id), json: json as never })),
      create: () => unwrap(api.events.$post({ param: { projectId }, json: { title: '새 사건' } as never })),
      remove: (id) => unwrap(api.events[':id'].$delete(param(id))),
    },
    speechRules: {
      rows: [...(rules.data ?? [])].sort((a, b) => a.fromName.localeCompare(b.fromName) || a.toName.localeCompare(b.toName)) as KindSpec['rows'],
      columns: [
        { head: '화자 → 청자', cell: (row) => `${text(row.fromName)} → ${text(row.toName)}`, className: 'font-medium' },
        { head: '말투', cell: (row) => SPEECH_LEVEL_LABELS[row.level as SpeechLevel] },
        { head: '호칭', cell: (row) => text(row.address) || '—' },
        { head: '시작', cell: (row) => (row.startKey ? <span className="font-mono text-xs">{text(row.startKey)}</span> : '처음부터') },
        { head: '이유', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{text(row.note)}</span> },
      ],
      fields: [
        { name: 'fromName', label: '화자', type: 'text' },
        { name: 'toName', label: '청자', type: 'text' },
        { name: 'level', label: '말투', type: 'level' },
        { name: 'address', label: '호칭', type: 'text' },
        { name: 'startKey', label: '시작 대사 키 (비우면 처음부터)', type: 'key' },
        { name: 'note', label: '이유·메모', type: 'long' },
      ],
      label: (row) => `${text(row.fromName)} → ${text(row.toName)}`,
      save: (id, json) => unwrap(api['speech-rules'][':id'].$patch({ ...param(id), json: json as never })),
      create: () => unwrap(api['speech-rules'].$post({ param: { projectId }, json: { fromName: '화자', toName: '청자', level: 'haeyo' } as never })),
      remove: (id) => unwrap(api['speech-rules'][':id'].$delete(param(id))),
    },
  };

  const spec = specs[tab];
  const rows = spec.rows.filter((row) => view === 'all' || row.status === view);
  const candidates = (kind: Kind) => specs[kind].rows.filter((row) => row.status === 'candidate').length;
  const selected = spec.rows.find((row) => row.id === search.item);
  useReportView('analysis', [selected && { kind: KINDS[tab], id: selected.id, label: spec.label(selected), detail: selected.status === 'candidate' ? 'AI 초안 (확정 전)' : undefined }]);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const visibleChecked = rows.filter((row) => checked.has(row.id) && row.status === 'candidate').map((row) => row.id);
  const decide = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: 'confirm' | 'discard' }) => unwrap(api.drafts.$post({ param: { projectId }, json: { kind: tab, ids, action } })),
    onSuccess: ({ changed }, { action }) => {
      setChecked(new Set());
      toast.success(action === 'confirm' ? `${changed}개를 확정했습니다.` : `${changed}개 초안을 버렸습니다.`);
    },
    onError: fail,
  });

  const create = useMutation({
    mutationFn: () => spec.create!(),
    onSuccess: (row) => set({ item: row.id, status: undefined }),
    onError: fail,
  });
  const characters = people.data?.characters ?? [];
  const graph = tab === 'relationships' && search.view === 'graph';

  return (
    <Page title="자료" flush meta={<JobStatus projectId={projectId} />} actions={<StartAnalysis projectId={projectId} />}>
      <div className="flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
            <Tabs className="max-w-full overflow-x-auto" value={tab} onValueChange={(value) => set({ tab: value as Kind, item: undefined }, false)}>
              <TabsList>
                {(Object.keys(KINDS) as Kind[]).map((kind) => (
                  <TabsTrigger key={kind} value={kind}>
                    {KINDS[kind]}
                    {candidates(kind) > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] text-amber-800 tabular-nums">{candidates(kind)}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(value) => value && set({ status: value === 'all' ? undefined : (value as KnowledgeSearch['status']), item: undefined })}>
              <ToggleGroupItem value="all">전체</ToggleGroupItem>
              <ToggleGroupItem value="candidate">후보</ToggleGroupItem>
              <ToggleGroupItem value="confirmed">확정</ToggleGroupItem>
            </ToggleGroup>
            {tab === 'relationships' && (
              <ToggleGroup type="single" variant="outline" size="sm" value={search.view ?? 'table'} onValueChange={(value) => value && set({ view: value === 'graph' ? 'graph' : undefined })}>
                <ToggleGroupItem value="table" aria-label="표로 보기">
                  <Table2 />
                </ToggleGroupItem>
                <ToggleGroupItem value="graph" aria-label="그래프로 보기">
                  <Network />
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <div className="ml-auto flex items-center gap-2">
              {visibleChecked.length > 0 && (
                <>
                  <span className="text-sm text-muted-foreground tabular-nums">{visibleChecked.length}개 선택</span>
                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ ids: visibleChecked, action: 'confirm' })}>
                    <Check /> 확정
                  </Button>
                  <DiscardButton count={visibleChecked.length} onConfirm={() => decide.mutate({ ids: visibleChecked, action: 'discard' })} />
                </>
              )}
              <Button size="sm" variant="outline" disabled={!spec.create || create.isPending} title={spec.create ? undefined : '인물이 둘 이상 있어야 관계를 만들 수 있습니다'} onClick={() => create.mutate()}>
                <Plus /> 추가
              </Button>
            </div>
          </div>
          {graph ? (
            <div className="min-h-0 flex-1">
              <RelationshipGraph
                characters={characters}
                relationships={rows as never}
                selectedRelationshipId={search.item}
                onSelectCharacter={(id) => set({ tab: 'characters', item: id, view: undefined }, false)}
                onSelectRelationship={(id) => set({ item: id })}
                onClear={() => set({ item: undefined })}
              />
            </div>
          ) : (
          <ScrollArea className="min-h-0 flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-6">
                    <Checkbox
                      aria-label="모든 후보 선택"
                      checked={rows.some((row) => row.status === 'candidate') && rows.filter((row) => row.status === 'candidate').every((row) => checked.has(row.id))}
                      onCheckedChange={(value) => setChecked(new Set(value ? rows.filter((row) => row.status === 'candidate').map((row) => row.id) : []))}
                    />
                  </TableHead>
                  {spec.columns.map((column) => (
                    <TableHead key={column.head}>{column.head}</TableHead>
                  ))}
                  <TableHead className="w-28">상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-state={row.id === search.item ? 'selected' : undefined} className="cursor-pointer" onClick={() => set({ item: row.id === search.item ? undefined : row.id })}>
                    <TableCell className="pl-6" onClick={(event) => event.stopPropagation()}>
                      {row.status === 'candidate' && (
                        <Checkbox
                          aria-label={`${spec.label(row)} 선택`}
                          checked={checked.has(row.id)}
                          onCheckedChange={(value) => setChecked((previous) => { const next = new Set(previous); if (value) next.add(row.id); else next.delete(row.id); return next; })}
                        />
                      )}
                    </TableCell>
                    {spec.columns.map((column) => (
                      <TableCell key={column.head} className={cn('max-w-80', column.className)}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                    <TableCell>
                      <StatusBadge row={row} />
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={spec.columns.length + 2} className="py-12 text-center text-muted-foreground">
                      {view === 'candidate' ? `검토할 ${KINDS[tab]} 초안이 없습니다. 위의 “작품 분석”으로 대본 전체를 읽혀 초안을 만드세요.` : `${KINDS[tab]} 항목이 없습니다. “추가”로 직접 만들거나 “작품 분석”으로 초안을 받으세요.`}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
          )}
        </div>
        {selected && (
          <div className="w-[420px] shrink-0 border-l">
            <DraftEditor key={selected.id} projectId={projectId} kind={tab} spec={spec} row={selected} characters={characters} onClose={() => set({ item: undefined })} onDecide={(action) => decide.mutate({ ids: [selected.id], action })} />
          </div>
        )}
      </div>
    </Page>
  );
}

function StatusBadge({ row }: { row: Draft }) {
  return row.status === 'candidate' ? (
    <Badge variant="outline" className="border-amber-300 text-amber-800">
      후보 · {KNOWLEDGE_ORIGIN_LABELS[row.origin]}
    </Badge>
  ) : (
    <span className="text-xs text-muted-foreground">확정 · {KNOWLEDGE_ORIGIN_LABELS[row.origin]}</span>
  );
}

function DiscardButton({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive">
          <Trash2 /> 버리기
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>초안 {count}개를 버릴까요?</AlertDialogTitle>
          <AlertDialogDescription>후보 상태인 초안만 지워집니다. 다시 분석하면 다시 제안될 수 있습니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>버리기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Right pane: edit the draft (unsaved edits survive navigation), see its evidence, confirm or discard it. */
function DraftEditor({ projectId, kind, spec, row, characters, onClose, onDecide }: { projectId: string; kind: Kind; spec: KindSpec; row: Draft & Record<string, unknown>; characters: { id: string; name: string }[]; onClose: () => void; onDecide: (action: 'confirm' | 'discard') => void }) {
  const saved = JSON.stringify(Object.fromEntries(spec.fields.map((field) => [field.name, row[field.name] ?? null])));
  const [draft, setDraft, clear] = useDraft(`knowledge.${kind}.${row.id}`, saved);
  const form = JSON.parse(draft) as Record<string, Value>;
  const dirty = draft !== saved;
  const update = (name: string, value: Value) => setDraft(JSON.stringify({ ...form, [name]: value }));
  const save = useMutation({
    mutationFn: () => spec.save(row.id, form),
    onSuccess: () => {
      clear();
      toast.success('저장했습니다.');
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => spec.remove(row.id), onSuccess: onClose, onError: fail });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{spec.label(row)}</h2>
          <StatusBadge row={row} />
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="닫기">
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {spec.fields.map((field) => (
            <FieldInput key={field.name} field={field} value={form[field.name]} characters={characters} onChange={(value) => update(field.name, value)} />
          ))}
          {spec.extra?.(row)}
          <Evidence projectId={projectId} keys={row.evidence} />
        </div>
      </ScrollArea>
      <div className="flex items-center gap-2 border-t p-3">
        {row.status === 'candidate' ? (
          <>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDecide('discard')}>
              <Trash2 /> 버리기
            </Button>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                저장
              </Button>
              <Button size="sm" disabled={dirty} title={dirty ? '먼저 저장하세요' : undefined} onClick={() => onDecide('confirm')}>
                <Check /> 확정
              </Button>
            </div>
          </>
        ) : (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive">
                  <Trash2 /> 삭제
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>확정된 항목을 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>“{spec.label(row)}”이(가) 사라지고 더 이상 AI 문맥에 쓰이지 않습니다.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" className="ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              저장
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function FieldInput({ field, value, characters, onChange }: { field: Field; value: Value; characters: { id: string; name: string }[]; onChange: (value: Value) => void }) {
  const id = `field-${field.name}`;
  if (field.type === 'bool')
    return (
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{field.label}</Label>
        <Switch id={id} checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    );
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      {field.type === 'long' ? (
        <Textarea id={id} rows={field.name === 'body' ? 16 : 4} className={field.name === 'body' ? 'font-mono text-xs' : undefined} value={text(value)} onChange={(event) => onChange(event.target.value)} />
      ) : field.type === 'docKind' || field.type === 'character' ? (
        <Select value={text(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.type === 'docKind' ? DOCUMENT_KINDS.map((kind) => ({ id: kind, name: DOCUMENT_KIND[kind] })) : characters).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'list' ? (
        <Input id={id} value={(value as string[] | null)?.join(', ') ?? ''} onChange={(event) => onChange(event.target.value.split(',').map((part) => part.trim()).filter(Boolean))} />
      ) : field.type === 'level' ? (
        <Select value={text(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEECH_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {SPEECH_LEVEL_LABELS[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input id={id} className={field.type === 'key' ? 'font-mono text-xs' : undefined} value={text(value)} onChange={(event) => onChange(field.type === 'key' ? event.target.value.trim() || null : event.target.value)} />
      )}
    </div>
  );
}

/** The lines a draft cites, opening in the script. Keys that are not lines were already dropped by the server. */
function Evidence({ projectId, keys }: { projectId: string; keys: string[] }) {
  const lines = useQuery(q.linesByKeys(projectId, keys.slice(0, 50)));
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-xs font-medium text-muted-foreground">근거 대사 {keys.length}개</h3>
      {keys.length === 0 && <p className="text-xs text-muted-foreground">근거로 든 대사가 없습니다.</p>}
      <ul className="space-y-1">
        {lines.data?.map((line) => (
          <li key={line.id}>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
              <span className="text-muted-foreground">{line.groupTitle} · </span>
              {line.speaker && <span className="font-medium">{line.speaker}: </span>}
              {line.source}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RelationshipChanges({ projectId, changes }: { projectId: string; changes: { at: string; change: string; cause: string }[] }) {
  const lines = useQuery(q.linesByKeys(projectId, changes.map((change) => change.at)));
  if (!changes.length) return null;
  const byKey = new Map(lines.data?.map((line) => [line.key, line]));
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">관계 변화</h3>
      <ul className="space-y-2">
        {changes.map((change) => {
          const line = byKey.get(change.at);
          return (
            <li key={`${change.at}-${change.change}`} className="rounded border p-2 text-xs">
              <p>{change.change}</p>
              {change.cause && <p className="text-muted-foreground">계기: {change.cause}</p>}
              {line && (
                <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="mt-1 block text-muted-foreground hover:underline">
                  {line.speaker && `${line.speaker}: `}
                  {line.source}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function JobStatus({ projectId }: { projectId: string }) {
  const jobs = useQuery(q.analysisJobs(projectId));
  const cancel = useMutation({ mutationFn: (jobId: string) => unwrap(client.projects[':projectId'].analysis[':jobId'].cancel.$post({ param: { projectId, jobId } })), onError: fail });
  const job = jobs.data?.[0];
  if (!job) return <span>작품 분석을 돌리면 대본 전체를 읽고 아래 다섯 가지 초안을 만듭니다.</span>;
  const when = new Date(job.finishedAt ?? job.createdAt).toLocaleString();
  if (job.status === 'running')
    return (
      <span className="flex items-center gap-2">
        <Sparkles className="size-4 animate-pulse" /> 대본 전체를 읽는 중 · {job.model} · {job.partsDone}/{job.partsTotal} 부분
        <Button size="sm" variant="ghost" className="h-7" onClick={() => cancel.mutate(job.id)}>
          <Square /> 중단
        </Button>
      </span>
    );
  if (job.status === 'failed') return <span className="text-destructive">분석 실패 ({when}): {job.error}</span>;
  if (job.status === 'cancelled') return <span>분석을 중단했습니다 ({when}).</span>;
  const result = job.result ?? {};
  const total = ['documents', 'characters', 'relationships', 'events', 'speechRules'].reduce((sum, kind) => sum + (result[kind] ?? 0), 0);
  return (
    <span>
      마지막 분석 {when} · {job.model} · 초안 {total}개{result.invalidEvidence ? ` · 대본에 없는 근거 ${result.invalidEvidence}개 제외` : ''}
    </span>
  );
}

function StartAnalysis({ projectId }: { projectId: string }) {
  const profiles = useQuery(q.profiles());
  const jobs = useQuery(q.analysisJobs(projectId));
  const [profileId, setProfileId] = useState<string>();
  const [open, setOpen] = useState(false);
  const start = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].analysis.$post({ param: { projectId }, json: { profileId: profileId! } })),
    onSuccess: () => {
      setOpen(false);
      toast.success('작품 분석을 시작했습니다. 끝나면 초안이 여기에 들어옵니다.');
    },
    onError: fail,
  });
  const running = jobs.data?.[0]?.status === 'running';
  const hasDrafts = (jobs.data ?? []).some((job) => job.status === 'completed');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={running}>
          <Sparkles /> {hasDrafts ? '작품 다시 분석' : '작품 분석'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">작품 분석</h3>
          <p className="text-xs text-muted-foreground">
            모델이 대본 전체를 한 번에 읽고 개요·인물·관계·사건·말투 규칙 초안을 근거와 함께 만듭니다. 번역과 상태는 바뀌지 않습니다. 긴 문맥 모델을 권장하고, 출력 한도가 작으면 답이 잘릴 수 있습니다.
            {hasDrafts && ' 다시 분석하면 확정하지 않은 AI 초안이 새 초안으로 바뀝니다.'}
          </p>
        </div>
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className="w-full" aria-label="모델 프로필">
            <SelectValue placeholder="모델 프로필 선택" />
          </SelectTrigger>
          <SelectContent>
            {profiles.data?.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name} · {profile.model} · 출력 {profile.maxOutputTokens.toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="w-full" disabled={!profileId || start.isPending} onClick={() => start.mutate()}>
          <Play /> 시작
        </Button>
      </PopoverContent>
    </Popover>
  );
}
