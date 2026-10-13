import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Play, Tags, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { aiDecided, DOCUMENT_KINDS, STYLE_AXES, type StyleAxis, SPEECH_FIX_WORKFLOW, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, isSettled, KNOWLEDGE_SOURCES, KNOWLEDGE_STATUS_LABELS, SOURCE_LABELS, sourceOf, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus, type SpeechLevel, type StatusBy } from '@tw/shared';
import { RunDialog } from '@/components/workflow/run-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChipInput, joinList, splitList } from '@/components/chip-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useDraft } from '@/lib/drafts';
import { AiMark, TagChip } from '@/components/status';
import { DOCUMENT_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { HeaderFilter, MarkFilter, type FilterOption } from '@/components/header-filter';

export const KINDS = { documents: '문서', characters: '인물', relationships: '관계', events: '사건', speechRules: '말투 규칙' } as const;
export type Kind = keyof typeof KINDS;

/** Fields every knowledge row has, whatever its kind. */
export interface Draft {
  id: string;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  /** Who set the status (docs/DESIGN.md 3.5). */
  statusBy: StatusBy;
  evidence: string[];
  /** The work analysis that put it in, if any. */
  jobId?: string | null;
  /** Project tags on it; `note` says why the app put one there (확인 권장). */
  tags?: ItemTag[];
}
export interface ItemTag {
  id: string;
  note: string | null;
}
/** A project tag as the knowledge screens show and filter it. */
export interface TagInfo {
  id: string;
  name: string;
  color: string;
  role?: string | null;
}
export type Row = Draft & Record<string, unknown>;
export type Value = string | boolean | string[] | Record<string, string> | null;
export interface Field {
  name: string;
  label: string;
  /** 'chips' is several values kept as one comma-separated string (forms of address); 'list' an array. */
  type: 'text' | 'long' | 'list' | 'chips' | 'bool' | 'level' | 'key' | 'docKind' | 'character' | 'style';
  /** Values offered while typing a 'list' or 'chips' field. */
  suggestions?: string[];
}
export interface KindSpec {
  rows: Row[];
  columns: { head: string; cell: (row: Row) => ReactNode; className?: string; /** Fixed px width; columns without one share the rest. */ width?: number }[];
  fields: Field[];
  label: (row: Row) => string;
  save: (id: string, json: Record<string, Value>) => Promise<unknown>;
  /** Creates an empty item (a person's, official) and returns its id; absent when it cannot be made yet. */
  create?: () => Promise<{ id: string }>;
  /** Creates an item with these fields (a new speech stretch from a picked line). */
  createWith?: (json: Record<string, Value>) => Promise<{ id: string }>;
  remove: (id: string) => Promise<unknown>;
  /** Shown under the fields (read-only facts such as relationship changes, a rule's lines). */
  extra?: (row: Row) => ReactNode;
}

export const fail = (error: Error) => toast.error(error.message);
export const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** 출처: who wrote the content (작품 분석, 워크플로·채팅, 대본에서 찾음, 가져오기, 사람). */
export function SourceBadge({ row }: { row: Draft }) {
  return <span className="text-xs text-muted-foreground">{SOURCE_LABELS[sourceOf(row)]}</span>;
}

/** A candidate row: dashed left edge (not used as context until confirmed). */
export const candidateRow = (row: Draft) => (row.status === 'candidate' ? '[&>td:first-child]:border-l-2 [&>td:first-child]:border-dashed [&>td:first-child]:border-l-warning' : undefined);

export type SourceFilter = KnowledgeSource | undefined;
/** 'ai': confirmed by AI and not looked at yet (✦), the 'AI가 정한 것만' filter. */
export type StatusFilter = 'confirmed' | 'ai' | 'candidate' | undefined;
/** Marks the app reads off a knowledge item, offered with the tags in the 태그 filter. */
export const KNOWLEDGE_MARKS = { candidate: '후보', ai: 'AI가 정함', bare: '근거 없음' } as const;

export const matches = (row: Draft, source: SourceFilter, status: StatusFilter, tags?: string[], bare?: boolean) =>
  (!source || sourceOf(row) === source) &&
  (!status || (status === 'ai' ? aiDecided(row) : row.status === status)) &&
  (tags ?? []).every((tag) => row.tags?.some((item) => item.id === tag)) &&
  (!bare || !row.evidence.length);

/** An item's tags as chips; the app's reason for one (확인 권장) shows on hover. */
export function TagCell({ tags, known }: { tags?: ItemTag[]; known: TagInfo[] }) {
  const shown = (tags ?? []).flatMap((item) => {
    const info = known.find((tag) => tag.id === item.id);
    return info ? [{ ...item, info }] : [];
  });
  if (!shown.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <span key={item.id} title={item.note ?? undefined}>
          <TagChip tag={item.info} />
        </span>
      ))}
    </span>
  );
}

export const sourceOptions: FilterOption[] = KNOWLEDGE_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }));
export const statusOptions: FilterOption[] = [
  { value: 'confirmed', label: KNOWLEDGE_STATUS_LABELS.confirmed },
  { value: 'ai', label: 'AI가 정한 것만 (확정 ✦)' },
  { value: 'candidate', label: KNOWLEDGE_STATUS_LABELS.candidate },
];

/** 상태 cell: 확정 (used as context, ✦ when AI confirmed it) or 후보 (not yet). */
export function StateCell({ row }: { row: Draft }) {
  if (row.status === 'candidate') return <span className="text-warning">{KNOWLEDGE_STATUS_LABELS.candidate}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {KNOWLEDGE_STATUS_LABELS.confirmed}
      <AiMark by={row.statusBy} />
    </span>
  );
}

/** What the confirm button does to the picks: candidates become 확정, AI-confirmed ones are marked 확인함. */
export function confirmLabel(rows: Draft[]) {
  const candidates = rows.some((row) => row.status === 'candidate');
  const checked = rows.some((row) => row.status !== 'candidate' && row.statusBy === 'ai');
  return candidates && checked ? '확정·확인함' : candidates ? '확정' : '확인함';
}

/** 출처 and 상태 as the last two columns of a table; both filter through their header. */
export interface KnowledgeFilterState {
  source: SourceFilter;
  /** 상태 as marks: #후보 (candidate) or #AI가 정함 (ai); 'confirmed' is still accepted from links. */
  status: StatusFilter;
  /** Picked tag ids: items carrying all of them. */
  tags?: string[];
  /** #근거 없음: items citing no line. */
  bare?: boolean;
  /** The project's tags (lines' problem types left out): the 태그 column's chips and filter. */
  known: TagInfo[];
  onChange: (next: { source?: SourceFilter; status?: StatusFilter; tags?: string[]; bare?: boolean }) => void;
}

/** The 태그 filter: the app's marks, then the tags; every pick narrows the rows. */
export function TagFilter({ filters, marks = ['candidate', 'ai', 'bare'] }: { filters: KnowledgeFilterState; marks?: (keyof typeof KNOWLEDGE_MARKS)[] }) {
  const picked = filters.tags ?? [];
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...picked, id] : picked.filter((other) => other !== id);
    filters.onChange({ tags: next.length ? next : undefined });
  };
  const mark = (key: keyof typeof KNOWLEDGE_MARKS) =>
    key === 'bare'
      ? { key, label: `#${KNOWLEDGE_MARKS[key]}`, checked: Boolean(filters.bare), onChange: (on: boolean) => filters.onChange({ bare: on || undefined }) }
      : { key, label: `#${KNOWLEDGE_MARKS[key]}`, checked: filters.status === key, onChange: (on: boolean) => filters.onChange({ status: on ? key : undefined }) };
  return (
    <MarkFilter
      label="태그"
      groups={[
        { heading: '자동 표시', options: marks.map(mark) },
        { heading: '태그', options: filters.known.map((tag) => ({ key: tag.id, label: <TagChip tag={tag} />, checked: picked.includes(tag.id), onChange: (on: boolean) => toggle(tag.id, on) })) },
      ]}
      onClear={() => filters.onChange({ status: undefined, tags: undefined, bare: undefined })}
    />
  );
}

export function metaColumns<T>(draftOf: (row: T) => Draft, filters: KnowledgeFilterState): ColumnDef<T, unknown>[] {
  return [
    {
      id: 'tags',
      meta: { width: 120 },
      header: () => <TagFilter filters={filters} />,
      cell: ({ row }) => <TagCell tags={draftOf(row.original).tags} known={filters.known} />,
    },
    {
      id: 'source',
      meta: { width: 88 },
      header: () => <HeaderFilter label="출처" value={filters.source} options={sourceOptions} onChange={(value) => filters.onChange({ source: value as SourceFilter })} />,
      cell: ({ row }) => <SourceBadge row={draftOf(row.original)} />,
    },
    {
      id: 'state',
      meta: { width: 80 },
      // Filtered through the 태그 column's marks (#후보, #AI가 정함), not twice.
      header: '상태',
      cell: ({ row }) => <StateCell row={draftOf(row.original)} />,
    },
  ];
}

/** 출처 and 상태 filters for displays without a table header (graph, timeline), in the toolbar. */
export function KnowledgeFilters(filters: KnowledgeFilterState) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <TagFilter filters={filters} />
      <HeaderFilter label="출처" value={filters.source} options={sourceOptions} onChange={(value) => filters.onChange({ source: value as SourceFilter })} />
    </div>
  );
}

/**
 * The bar for picked items a person has not decided: confirm them (후보 → 확정, AI 확정 → 확인함;
 * the status stays and a person now holds it) or throw them away. Items a person decided are skipped.
 */
export function BulkDecide({ picked, actionable, pending, onConfirm, onDiscard }: { picked: number; actionable: Draft[]; pending: boolean; onConfirm: () => void; onDiscard: () => void }) {
  return (
    <>
      <Button disabled={actionable.length === 0 || pending} onClick={onConfirm}>
        <Check /> {confirmLabel(actionable)}
      </Button>
      <DiscardButton count={actionable.length} disabled={actionable.length === 0} onConfirm={onDiscard} />
      {picked > actionable.length && <span className="text-xs text-muted-foreground">사람이 정한 {picked - actionable.length}개는 건너뜁니다</span>}
    </>
  );
}

/** The table of one knowledge kind (documents, people, events) with 출처 and 상태 columns. */
/**
 * A person's tags on the picked items (the same project tags as lines): one check per tag, '일부'
 * when only some carry it. The app's own tags (확인 권장) are not offered: a decision takes those off.
 */
export function TagMenu({ tags, rows, onChange }: { tags: TagInfo[]; rows: Draft[]; onChange: (tagId: string, add: boolean) => void }) {
  const own = tags.filter((tag) => !tag.role);
  if (!own.length || !rows.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="bg-background">
          <Tags /> 태그
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">고른 {rows.length}개의 태그</DropdownMenuLabel>
        {own.map((tag) => {
          const on = rows.filter((row) => row.tags?.some((item) => item.id === tag.id)).length;
          return (
            <DropdownMenuCheckboxItem key={tag.id} checked={on === rows.length} onSelect={(event) => event.preventDefault()} onCheckedChange={() => onChange(tag.id, on !== rows.length)}>
              <TagChip tag={tag} />
              {on > 0 && on < rows.length && <span className="ml-auto text-xs text-muted-foreground">일부</span>}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function KnowledgeTable({ spec, rows, loading, selected, onOpen, picked, onPick, bulk, empty, filters }: {
  spec: KindSpec;
  rows: Row[] | undefined;
  loading: boolean;
  selected?: string;
  onOpen: (id: string) => void;
  picked: Set<string>;
  onPick: (ids: string[], on: boolean) => void;
  bulk: ReactNode;
  empty: ReactNode;
  filters: KnowledgeFilterState;
}) {
  const columns: ColumnDef<Row, unknown>[] = [
    ...spec.columns.map((column): ColumnDef<Row, unknown> => ({ id: column.head, header: column.head, meta: { width: column.width, className: column.className }, cell: ({ row }) => column.cell(row.original) })),
    ...metaColumns<Row>((row) => row, filters),
  ];
  return <DataTable columns={columns} rows={rows} loading={loading} rowId={(row) => row.id} selected={selected} onRowClick={(row) => onOpen(row.id)} rowClassName={candidateRow} picked={picked} onPick={onPick} bulk={bulk} empty={empty} />;
}

export function DiscardButton({ count, onConfirm, disabled }: { count: number; onConfirm: () => void; disabled?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-destructive" disabled={disabled}>
          <Trash2 /> 버리기
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{count}개를 버릴까요?</AlertDialogTitle>
          <AlertDialogDescription>사람이 아직 정하지 않은 항목(후보, AI가 확정한 것)만 버립니다. 버린 항목은 다시 분석해도 다시 제안되지 않습니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>버리기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Edit one item (unsaved edits survive navigation), see its evidence, and make it official or
 * discard it while it is AI's. As a right-hand pane, or embedded in another pane (a pair's detail).
 */
export function DraftEditor({ projectId, kind, spec, row, characters, onClose, onDecide, embedded }: {
  projectId: string;
  kind: Kind;
  spec: KindSpec;
  row: Row;
  characters: { id: string; name: string }[];
  onClose?: () => void;
  onDecide: (action: 'confirm' | 'discard') => void;
  embedded?: boolean;
}) {
  const saved = JSON.stringify(Object.fromEntries(spec.fields.map((field) => [field.name, row[field.name] ?? null])));
  const [draft, setDraft, clearDraft] = useDraft(`knowledge.${kind}.${row.id}`, saved);
  // What the item was when editing began: if it changes elsewhere meanwhile (a chat proposal
  // accepted, another window), the unsaved edit must not quietly hide the new value.
  const [base, setBase, clearBase] = useDraft(`knowledge-base.${kind}.${row.id}`, '');
  const form = JSON.parse(draft) as Record<string, Value>;
  const dirty = draft !== saved;
  const changedElsewhere = dirty && Boolean(base) && base !== saved;
  const clear = () => {
    clearDraft();
    clearBase();
  };
  const update = (name: string, value: Value) => {
    if (!dirty) setBase(saved);
    setDraft(JSON.stringify({ ...form, [name]: value }));
  };
  const save = useMutation({
    mutationFn: () => spec.save(row.id, form),
    onSuccess: () => {
      clear();
      toast.success('저장했습니다. 사람이 고친 항목이라 다시 분석해도 바뀌지 않습니다.');
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => spec.remove(row.id), onSuccess: onClose, onError: fail });
  const official = isSettled(row);

  const body = (
    <>
      {changedElsewhere && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
          <span className="text-warning">고치는 동안 이 항목이 다른 곳에서 바뀌었습니다. 아래는 아직 저장하지 않은 내 수정입니다.</span>
          <span className="ml-auto flex gap-1">
            <Button variant="outline" size="inline" className="px-2" onClick={clear}>
              바뀐 내용 불러오기
            </Button>
            <Button variant="ghost" size="inline" className="px-2" onClick={() => setBase(saved)}>
              내 수정 유지
            </Button>
          </span>
        </div>
      )}
      <PaneSection title="내용">
        <div className="flex flex-col gap-4">
          {spec.fields.map((field) => (
            <FieldInput key={field.name} field={field} value={form[field.name]} characters={characters} onChange={(value) => update(field.name, value)} />
          ))}
        </div>
      </PaneSection>
      {/* The folded lists (a rule's lines, the evidence) read as one block. */}
      <div className="space-y-1">
        {spec.extra?.(row)}
        <Evidence projectId={projectId} keys={row.evidence} />
      </div>
    </>
  );
  const actions = !official ? (
    <>
      <Button variant="ghost" className="text-destructive" onClick={() => onDecide('discard')}>
        <Trash2 /> 버리기
      </Button>
      {dirty && (
        <span className="ml-auto flex items-center gap-1 text-xs text-warning">
          저장 안 된 수정
          <Button variant="ghost" size="inline" className="text-muted-foreground" onClick={clear}>
            되돌리기
          </Button>
        </span>
      )}
      <Button variant="outline" className={dirty ? undefined : 'ml-auto'} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
        저장
      </Button>
      <Button disabled={dirty} title={dirty ? '먼저 저장하세요' : row.status === 'candidate' ? '이대로 확정해 문맥에 씁니다' : '상태는 그대로 두고 사람이 확인한 것으로 표시합니다'} onClick={() => onDecide('confirm')}>
        <Check /> {confirmLabel([row])}
      </Button>
    </>
  ) : (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" className="text-destructive">
            <Trash2 /> 삭제
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>사람이 정한 항목을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>“{spec.label(row)}”이(가) 사라지고 더 이상 AI 문맥에 쓰이지 않습니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dirty && (
        <span className="ml-auto flex items-center gap-1 text-xs text-warning">
          저장 안 된 수정
          <Button variant="ghost" size="inline" className="text-muted-foreground" onClick={clear}>
            되돌리기
          </Button>
        </span>
      )}
      <Button className={dirty ? undefined : 'ml-auto'} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
        저장
      </Button>
    </>
  );
  if (embedded)
    return (
      <div className="space-y-6">
        {body}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    );
  return (
    <DetailPane
      kicker={KINDS[kind]}
      title={spec.label(row)}
      subtitle={
        <span className="flex items-center gap-1.5">
          <SourceBadge row={row} />
          <span>·</span>
          {row.status === 'candidate' ? <span>후보</span> : <span className="inline-flex items-center gap-1">확정 <AiMark by={row.statusBy} /></span>}
        </span>
      }
      onClose={onClose}
      footer={actions}
    >
      {body}
    </DetailPane>
  );
}

const NORMAL = '__normal';

export function FieldInput({ field, value, characters, onChange }: { field: Field; value: Value; characters: { id: string; name: string }[]; onChange: (value: Value) => void }) {
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
        <ChipInput id={id} value={(value as string[] | null) ?? []} onChange={onChange} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />
      ) : field.type === 'chips' ? (
        <ChipInput id={id} value={splitList(value)} onChange={(chips) => onChange(joinList(chips))} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />
      ) : field.type === 'style' ? (
        // One pick per axis; 보통 leaves the axis out of the prompt.
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(STYLE_AXES) as StyleAxis[]).map((axis) => {
            const current = (value as Record<string, string> | null)?.[axis] ?? NORMAL;
            return (
              <div key={axis} className="space-y-1">
                <span className="text-xs text-muted-foreground">{STYLE_AXES[axis].label}</span>
                <Select
                  value={current}
                  onValueChange={(next) => {
                    const { [axis]: _dropped, ...rest } = (value as Record<string, string> | null) ?? {};
                    onChange(next === NORMAL ? rest : { ...rest, [axis]: next });
                  }}
                >
                  <SelectTrigger id={axis === 'length' ? id : undefined} className="w-full" aria-label={STYLE_AXES[axis].label}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NORMAL}>보통</SelectItem>
                    {Object.entries(STYLE_AXES[axis].options).map(([option, { name }]) => (
                      <SelectItem key={option} value={option}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
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
/** A list that stays folded until asked for (evidence, a rule's lines): the pane shows what to decide first. */
function Fold({ label, children, actions }: { label: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex min-h-7 items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="inline" className="-ml-1 text-muted-foreground">
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> {label}
          </Button>
        </CollapsibleTrigger>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      <CollapsibleContent className="mt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function Evidence({ projectId, keys }: { projectId: string; keys: string[] }) {
  const lines = useQuery(q.linesByKeys(projectId, keys.slice(0, 50)));
  if (!keys.length) return <p className="text-xs text-muted-foreground">근거로 든 대사가 없습니다.</p>;
  return (
    <Fold label={`근거 대사 ${keys.length}개`}>
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
    </Fold>
  );
}

/** Lines the rule governs and what their translations end in; after fixing the rule, re-run just these. */
export function RuleLines({ projectId, ruleId, candidate }: { projectId: string; ruleId: string; candidate: boolean }) {
  const lines = useQuery(q.ruleLines(projectId, ruleId));
  const levels = Object.entries(lines.data?.levels ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <PaneSection
      title={`${candidate ? '확정하면 적용될' : '이 규칙이 적용되는'} 대사 ${lines.data?.count ?? '…'}개`}
      actions={
        lines.data?.translatedIds.length && !candidate ? (
          <RunDialog
            projectId={projectId}
            unitIds={lines.data.translatedIds}
            defaultIgnoreStatus
            preferWorkflow={SPEECH_FIX_WORKFLOW}
            trigger={
              <Button variant="ghost" title={`“${SPEECH_FIX_WORKFLOW}” 워크플로로 번역된 줄의 어미·호칭만 이 규칙에 맞춥니다`}>
                <Play /> 번역된 {lines.data.translatedIds.length.toLocaleString()}줄 말투 맞추기
              </Button>
            }
          />
        ) : undefined
      }
    >
      <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {lines.data && !lines.data.translatedIds.length
          ? '아직 번역된 줄이 없습니다. 이 줄들을 번역할 때 이 규칙이 들어갑니다.'
          : `규칙을 고쳤다면 “말투 맞추기”로 이미 번역된 줄의 어미·호칭만 다시 맞춥니다. 뜻과 표현은 그대로 둡니다.`}
      </p>
      {!!lines.data?.routeDependent && (
        <p className="text-xs text-warning">
          이 중 {lines.data.routeDependent.toLocaleString()}개는 구간 시작을 거쳤는지가 루트에 따라 달라, 대본 순서로 이 규칙을 골랐습니다. 번역은 한 줄에 하나라 루트 하나에만 맞을 수 있으니 확인하세요.
        </p>
      )}
      {levels.length > 0 && (
        <p className="text-xs">
          지금 번역의 말투(어미 추정):{' '}
          {levels.map(([level, count]) => `${level === 'unknown' ? '판단 불가·번역 없음' : SPEECH_LEVEL_LABELS[level as SpeechLevel]} ${count}`).join(' · ')}
        </p>
      )}
      <Fold label="대사 보기">
      <ul className="max-h-60 space-y-1 overflow-auto">
        {lines.data?.rows.map((line) => (
          <li key={line.id}>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
              <span className="text-muted-foreground">{line.groupTitle} · </span>
              {line.source}
              {line.translation && <span className="block text-muted-foreground">{line.translation}</span>}
            </Link>
          </li>
        ))}
      </ul>
      </Fold>
      </div>
    </PaneSection>
  );
}

export function RelationshipChanges({ projectId, changes }: { projectId: string; changes: { at: string; change: string; cause: string }[] }) {
  const lines = useQuery(q.linesByKeys(projectId, changes.map((change) => change.at)));
  if (!changes.length) return null;
  const byKey = new Map(lines.data?.map((line) => [line.key, line]));
  return (
    <PaneSection title="관계 변화">
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
    </PaneSection>
  );
}
