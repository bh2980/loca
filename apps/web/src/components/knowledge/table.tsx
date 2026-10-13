/** The knowledge tables: row types, cells, filters and bulk decisions shared by the knowledge, glossary and pairs screens. */
import { type ReactNode } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { InferResponseType } from 'hono/client';
import { AUTO_MARKS, type CharacterStyle, type DOCUMENT_KINDS, type SpeechLevel, type AutoMark, KNOWLEDGE_MARK_IDS, knowledgeMarksOf, matchesMarks, KNOWLEDGE_SOURCES, KNOWLEDGE_STATUS_LABELS, SOURCE_LABELS, sourceOf, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus, type StatusBy } from '@tw/shared';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { AiMark, MarkChip, TagChip } from '@/components/status';
import { DataTable, type ColumnDef } from '@/components/data-table';
import type { FilterChip } from '@/components/toolbar';
import { HeaderFilter, MarkFilter, markTagGroups, type FilterOption } from '@/components/header-filter';
import type { client } from '@/lib/api';

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
/** A knowledge row as the shared table and editor see it: the common fields, the rest by name. */
export type Row = Draft & Record<string, unknown>;

type KnowledgeApi = (typeof client.projects)[':projectId'];
type CharactersList = InferResponseType<KnowledgeApi['characters']['$get'], 200>;
/** Each kind's rows as its list endpoint returns them. */
export type DocumentRow = InferResponseType<KnowledgeApi['documents']['$get'], 200>[number];
export type CharacterRow = CharactersList['characters'][number];
export type RelationshipRow = CharactersList['relationships'][number];
export type EventRow = InferResponseType<KnowledgeApi['events']['$get'], 200>[number];
export type SpeechRuleRow = InferResponseType<KnowledgeApi['speech-rules']['$get'], 200>[number];

/** The value each field type edits: what its input shows and what it writes back. */
interface FieldValues {
  text: string;
  long: string;
  /** Several values as an array. */
  list: string[];
  /** Several values kept as one comma-separated string (forms of address). */
  chips: string;
  bool: boolean;
  level: SpeechLevel;
  /** A line key; empty is null. */
  key: string | null;
  docKind: (typeof DOCUMENT_KINDS)[number];
  /** A character id. */
  character: string;
  style: CharacterStyle;
}
export type FieldType = keyof FieldValues;
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  /** Values offered while typing a 'list' or 'chips' field. */
  suggestions?: string[];
}
/**
 * A field of rows R: `name` is one of R's keys and `type` one whose value is exactly that key's
 * type, so the input can show the row's value and what it writes back is a valid value again.
 */
export type FieldOf<R> = {
  [K in keyof R & string]: { [T in FieldType]: [R[K]] extends [FieldValues[T]] ? ([FieldValues[T]] extends [R[K]] ? Field & { name: K; type: T } : never) : never }[FieldType];
}[keyof R & string];
/** What the editor saves for these fields: each field's value, under its name. */
export type FormOf<R, F extends Field> = { [K in F['name'] & keyof R]: R[K] };

interface Column<R> {
  head: string;
  cell(row: R): ReactNode;
  className?: string;
  /** Fixed px width; columns without one share the rest. */
  width?: number;
}
/**
 * One kind as the shared table and editor use it. Write it with `defineKind`, which checks the
 * fields against the kind's rows and the saved form against its API; this is the same spec seen
 * without its row type, so a screen can hold any kind. Its callbacks are methods on purpose: a
 * method may take a narrower row than Row (TypeScript checks method parameters both ways), and a
 * kind's callbacks are only ever given its own rows and its own form.
 */
export interface KindSpec<R extends Draft = Row, F extends Field = Field> {
  rows: R[];
  columns: Column<R>[];
  fields: readonly F[];
  label(row: R): string;
  save(id: string, json: FormOf<R, F>): Promise<unknown>;
  /** Creates an empty item (a person's, official) and returns its id; absent when it cannot be made yet. */
  create?(): Promise<{ id: string }>;
  remove(id: string): Promise<unknown>;
  /** Shown under the fields (read-only facts such as relationship changes, a rule's lines). */
  extra?(row: R): ReactNode;
}
/**
 * A kind's spec, typed by its rows (inferred from `rows`) and fields. `save` is checked here as a
 * plain function (not a method), so a save that cannot take this kind's form fails to compile.
 */
export const defineKind = <R extends Row, const F extends FieldOf<R>>(spec: KindSpec<R, F> & { save: (id: string, json: FormOf<R, F>) => Promise<unknown> }): KindSpec<R, F> => spec;

export const fail = (error: Error) => toast.error(error.message);
export const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** 출처: who wrote the content (작품 분석, 워크플로·채팅, 대본에서 찾음, 가져오기, 사람). */
export function SourceBadge({ row }: { row: Draft }) {
  return <span className="text-xs text-muted-foreground">{SOURCE_LABELS[sourceOf(row)]}</span>;
}

/** A candidate row: dashed left edge (not used as context until confirmed). */
export const candidateRow = (row: Draft) => (row.status === 'candidate' ? '[&>td:first-child]:border-l-2 [&>td:first-child]:border-dashed [&>td:first-child]:border-l-warning' : undefined);

export type SourceFilter = KnowledgeSource | undefined;
/** `marks` is the page's marks param: rules of matchesMarks (#후보 and #AI가 정함 together mean either). */
export const matches = (row: Draft, source: SourceFilter, marks?: readonly AutoMark[], tags?: string[]) =>
  (!source || sourceOf(row) === source) && matchesMarks(knowledgeMarksOf(row), marks) && (tags ?? []).every((tag) => row.tags?.some((item) => item.id === tag));

/** The marks a knowledge item can be filtered by. */
export { KNOWLEDGE_MARK_IDS };

/** An item's automatic marks then its tags, all as colored chips; the app's reason for a tag (확인 권장) shows on hover. */
export function TagCell({ tags, known, marks }: { tags?: ItemTag[]; known: TagInfo[]; marks?: AutoMark[] }) {
  const shown = (tags ?? []).flatMap((item) => {
    const info = known.find((tag) => tag.id === item.id);
    return info ? [{ ...item, info }] : [];
  });
  if (!shown.length && !marks?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {marks?.map((mark) => (
        <MarkChip key={mark} mark={mark} />
      ))}
      {shown.map((item) => (
        <span key={item.id} title={item.note ?? undefined}>
          <TagChip tag={item.info} />
        </span>
      ))}
    </span>
  );
}

const sourceOptions: FilterOption[] = KNOWLEDGE_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }));

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

/** 출처 and 태그 as the last two columns of a table; both filter through their header. */
export interface KnowledgeFilterState {
  source: SourceFilter;
  /** Picked automatic marks (the marks URL param). */
  marks?: AutoMark[];
  /** Picked tag ids: items carrying all of them. */
  tags?: string[];
  /** The project's tags (lines' problem types left out): the 태그 column's chips and filter. */
  known: TagInfo[];
  onChange: (next: { source?: SourceFilter; marks?: AutoMark[]; tags?: string[] }) => void;
}

/** The 태그 filter: the app's marks, then the tags; every pick narrows the rows (marks of one field widen, see matchesMarks). */
function TagFilter({ filters, marks = KNOWLEDGE_MARK_IDS }: { filters: KnowledgeFilterState; marks?: readonly AutoMark[] }) {
  const toggle = (id: string, on: boolean) => {
    const picked = filters.tags ?? [];
    const next = on ? [...picked, id] : picked.filter((other) => other !== id);
    filters.onChange({ tags: next.length ? next : undefined });
  };
  const toggleMark = (key: AutoMark, on: boolean) => {
    const picked = filters.marks ?? [];
    const next = on ? [...picked, key] : picked.filter((other) => other !== key);
    filters.onChange({ marks: next.length ? next : undefined });
  };
  return <MarkFilter label="태그" groups={markTagGroups({ marks, picked: filters.marks, onToggle: toggleMark, tags: filters.known, pickedTags: filters.tags, onToggleTag: toggle })} onClear={() => filters.onChange({ marks: undefined, tags: undefined })} />;
}

export function metaColumns<T>(draftOf: (row: T) => Draft, filters: KnowledgeFilterState, marksOf: (row: T) => AutoMark[] = (row) => knowledgeMarksOf(draftOf(row))): ColumnDef<T, unknown>[] {
  return [
    {
      id: 'tags',
      meta: { width: 150, label: '태그' },
      header: () => <TagFilter filters={filters} />,
      cell: ({ row }) => <TagCell tags={draftOf(row.original).tags} known={filters.known} marks={marksOf(row.original)} />,
    },
    {
      id: 'source',
      meta: { width: 88, label: '출처' },
      header: () => <HeaderFilter label="출처" value={filters.source} options={sourceOptions} onChange={(value) => filters.onChange({ source: value as SourceFilter })} />,
      cell: ({ row }) => <SourceBadge row={draftOf(row.original)} />,
    },
  ];
}

const tagLabel = (known: TagInfo[], id: string) => {
  const tag = known.find((item) => item.id === id);
  return tag ? <TagChip tag={tag} /> : `#${id}`;
};

/** The knowledge filters that are set, as removable chips for the toolbar. */
export function knowledgeFilterChips(filters: KnowledgeFilterState): FilterChip[] {
  return [
    ...(filters.source ? [{ key: 'source', label: SOURCE_LABELS[filters.source], clear: () => filters.onChange({ source: undefined }) }] : []),
    ...(filters.marks ?? []).map((mark) => ({
      key: `mark:${mark}`,
      label: <MarkChip mark={mark} />,
      name: AUTO_MARKS[mark].name,
      clear: () => {
        const next = (filters.marks ?? []).filter((other) => other !== mark);
        filters.onChange({ marks: next.length ? next : undefined });
      },
    })),
    ...(filters.tags ?? []).map((id) => ({
      key: `tag:${id}`,
      label: tagLabel(filters.known, id),
      name: `#${filters.known.find((tag) => tag.id === id)?.name ?? id}`,
      clear: () => {
        const next = (filters.tags ?? []).filter((other) => other !== id);
        filters.onChange({ tags: next.length ? next : undefined });
      },
    })),
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
 * The actions for picked items a person has not decided: confirm them (후보 → 확정, AI 확정 →
 * 확인함; the status stays and a person now holds it) or throw them away (always through a
 * confirmation). Items a person decided are skipped. `confirmable` narrows what confirm acts on
 * (terms without a translation cannot be confirmed).
 */
export function BulkDecide({ picked, actionable, confirmable = actionable, pending, confirmTitle, onConfirm, onDiscard }: { picked: number; actionable: Draft[]; confirmable?: Draft[]; pending: boolean; confirmTitle?: string; onConfirm: () => void; onDiscard: () => void }) {
  return (
    <>
      <Button variant="outline" disabled={confirmable.length === 0 || pending} title={confirmTitle} onClick={onConfirm}>
        <Check /> {confirmLabel(confirmable)}
      </Button>
      <DiscardButton count={actionable.length} disabled={actionable.length === 0 || pending} onConfirm={onDiscard} />
      {picked > actionable.length && <span className="text-xs text-muted-foreground">사람이 정한 {picked - actionable.length}개는 건너뜁니다</span>}
    </>
  );
}

/** The table of one knowledge kind (documents, people, events) with 출처 and 태그 columns. */
export function KnowledgeTable({ id, spec, rows, loading, selected, onOpen, picked, onPick, bulk, empty, filters }: {
  /** Keeps the column widths per kind (see DataTable). */
  id?: string;
  spec: KindSpec;
  rows: Row[] | undefined;
  loading: boolean;
  selected?: string;
  onOpen: (id: string) => void;
  picked: ReadonlySet<string>;
  onPick: (ids: string[], on: boolean) => void;
  bulk: ReactNode;
  empty: ReactNode;
  filters: KnowledgeFilterState;
}) {
  const columns: ColumnDef<Row, unknown>[] = [
    ...spec.columns.map((column, index): ColumnDef<Row, unknown> => ({ id: column.head, header: column.head, meta: { width: column.width, className: column.className, hideable: index === 0 ? false : undefined }, cell: ({ row }) => column.cell(row.original) })),
    ...metaColumns<Row>((row) => row, filters),
  ];
  return <DataTable id={id} columns={columns} rows={rows} loading={loading} rowId={(row) => row.id} selected={selected} onRowClick={(row) => onOpen(row.id)} rowClassName={candidateRow} picked={picked} onPick={onPick} bulk={bulk} empty={empty} />;
}

function DiscardButton({ count, onConfirm, disabled }: { count: number; onConfirm: () => void; disabled?: boolean }) {
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
