/** The knowledge tables: row types, cells, filters and bulk decisions shared by the knowledge, glossary and pairs screens. */
import { type ReactNode } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { InferResponseType } from 'hono/client';
import { AUTO_MARKS, markColor, type MarkColors, type AgeBand, type CharacterRole, type CharacterStyle, type Gender, type DOCUMENT_KINDS, type SpeechLevel, type AutoMark, KNOWLEDGE_MARK_IDS, knowledgeMarksOf, matchesMarks, KNOWLEDGE_SOURCES, KNOWLEDGE_STATUS_LABELS, SOURCE_LABELS, sourceOf, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus, type StatusBy } from '@tw/shared';
import { DataTable, type ColumnDef, type FilterChip, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, AiMark, Inline, Stack, StatusIcon, TagChip, Text } from '@loca/ui';
import { MarkChip } from '@/components/status';
import { HeaderFilter, MarkFilter, markTagGroups, togglePick, type FilterOption, type FilterPick } from '@/components/header-filter';
import type { client } from '@/lib/api';

export const KINDS = { documents: '노트', characters: '인물', relationships: '관계', events: '사건', speechRules: '말투 규칙' } as const;
export type Kind = keyof typeof KINDS;

/** Fields every knowledge row has, whatever its kind. */
export interface Draft {
  id: string;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  /** Who set the status. */
  statusBy: StatusBy;
  evidence: string[];
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
  gender: Gender;
  ageBand: AgeBand;
  role: CharacterRole;
  /** A palette hex, '' = none (a person's color). */
  color: string;
}
export type FieldType = keyof FieldValues;
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  /** How to fill it in, shown under the field. */
  description?: string;
  /** What it is, behind a ? beside the label. */
  help?: string;
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
  weight?: 'medium';
  tabular?: boolean;
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
  return <Text variant="caption" tone="muted">{SOURCE_LABELS[sourceOf(row)]}</Text>;
}

/** A candidate row: dashed left edge (not used as context until confirmed). */
export const candidateRow = (row: Draft) => (row.status === 'candidate' ? ('tentative' as const) : undefined);

export type SourceFilter = KnowledgeSource | undefined;
/** The 상태 filter (the `status` URL param): rejected items are never listed, so only these two. */
export type StatusFilter = 'candidate' | 'confirmed' | undefined;
export const parseStatusFilter = (raw: unknown): StatusFilter => (raw === 'candidate' || raw === 'confirmed' ? raw : undefined);
export const statusOptions: FilterOption[] = (['candidate', 'confirmed'] as const).map((value) => ({ value, label: KNOWLEDGE_STATUS_LABELS[value] }));
/** `marks` is the page's marks param (every picked mark must hold, see matchesMarks); `status` the 상태 param. */
export const matches = (row: Draft, source: SourceFilter, marks?: readonly AutoMark[], tags?: string[], status?: StatusFilter) =>
  (!source || sourceOf(row) === source) && (!status || row.status === status) && matchesMarks(knowledgeMarksOf(row), marks) && (tags ?? []).every((tag) => row.tags?.some((item) => item.id === tag));
/** 숨기기: an item carrying any hidden mark or tag is left out. */
export const isHidden = (marks: readonly AutoMark[], tagIds: readonly string[], hidden: { hideMarks?: readonly AutoMark[]; hideTags?: readonly string[] }) =>
  marks.some((mark) => hidden.hideMarks?.includes(mark)) || tagIds.some((id) => hidden.hideTags?.includes(id));
export const rowHidden = (row: Draft, hidden: { hideMarks?: readonly AutoMark[]; hideTags?: readonly string[] }) => isHidden(knowledgeMarksOf(row), (row.tags ?? []).map((tag) => tag.id), hidden);

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
    <Stack as="span" direction="row" wrap gap="tight">
      {marks?.map((mark) => (
        <MarkChip key={mark} mark={mark} />
      ))}
      {shown.map((item) => (
        <span key={item.id} title={item.note ?? undefined}>
          <TagChip tag={item.info} />
        </span>
      ))}
    </Stack>
  );
}

const sourceOptions: FilterOption[] = KNOWLEDGE_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }));

/** 상태 cell, drawn like a line's status (shape + colour + name): 확정 (used as context, ✦ when AI confirmed it) or 후보 (not yet). */
export function StateCell({ row }: { row: Draft }) {
  const candidate = row.status === 'candidate';
  return (
    <Inline as="span" inline gap="snug">
      <StatusIcon status={{ kind: candidate ? 'initial' : 'final', color: candidate ? 'var(--text-color-warning)' : 'var(--text-color-success)' }} />
      {KNOWLEDGE_STATUS_LABELS[candidate ? 'candidate' : 'confirmed']}
      {!candidate && <AiMark by={row.statusBy} />}
    </Inline>
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
  /** 상태 (the status param): 후보 or 확정. */
  status?: StatusFilter;
  /** Picked automatic marks (the marks URL param). */
  marks?: AutoMark[];
  /** Picked tag ids: items carrying all of them. */
  tags?: string[];
  /** 숨기기: items carrying any of these marks or tags are left out. */
  hideMarks?: AutoMark[];
  hideTags?: string[];
  /** The project's tags (lines' problem types left out): the 태그 column's chips and filter. */
  known: TagInfo[];
  onChange: (next: { source?: SourceFilter; status?: StatusFilter; marks?: AutoMark[]; tags?: string[]; hideMarks?: AutoMark[]; hideTags?: string[] }) => void;
}

/** The 태그 filter: the app's marks, then the tags; every pick narrows the rows. */
function TagFilter({ filters, marks = KNOWLEDGE_MARK_IDS }: { filters: KnowledgeFilterState; marks?: readonly AutoMark[] }) {
  const pickMark = (mark: AutoMark, mode: FilterPick) => {
    const next = togglePick(filters.marks, filters.hideMarks, mark, mode);
    filters.onChange({ marks: next.show, hideMarks: next.hide });
  };
  const pickTag = (id: string, mode: FilterPick) => {
    const next = togglePick(filters.tags, filters.hideTags, id, mode);
    filters.onChange({ tags: next.show, hideTags: next.hide });
  };
  return <MarkFilter label="태그" groups={markTagGroups({ marks, picked: filters.marks, hidden: filters.hideMarks, onMark: pickMark, tags: filters.known, pickedTags: filters.tags, hiddenTags: filters.hideTags, onTag: pickTag })} onClear={() => filters.onChange({ marks: undefined, tags: undefined, hideMarks: undefined, hideTags: undefined })} />;
}

export function metaColumns<T>(draftOf: (row: T) => Draft, filters: KnowledgeFilterState, marksOf: (row: T) => AutoMark[] = (row) => knowledgeMarksOf(draftOf(row))): ColumnDef<T, unknown>[] {
  return [
    {
      id: 'state',
      meta: { width: 88, label: '상태' },
      header: () => <HeaderFilter label="상태" value={filters.status} options={statusOptions} onChange={(value) => filters.onChange({ status: value as StatusFilter })} />,
      cell: ({ row }) => <StateCell row={draftOf(row.original)} />,
    },
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

/** The knowledge filters that are set, as removable chips for the toolbar. */
export function knowledgeFilterChips(filters: KnowledgeFilterState, markColors?: MarkColors): FilterChip[] {
  return [
    ...(filters.status ? [{ key: 'status', label: KNOWLEDGE_STATUS_LABELS[filters.status], clear: () => filters.onChange({ status: undefined }) }] : []),
    ...(filters.source ? [{ key: 'source', label: SOURCE_LABELS[filters.source], clear: () => filters.onChange({ source: undefined }) }] : []),
    ...(filters.marks ?? []).map((mark) => ({
      key: `mark:${mark}`,
      label: `#${AUTO_MARKS[mark].name}`,
      color: markColor(mark, markColors),
      clear: () => {
        const next = (filters.marks ?? []).filter((other) => other !== mark);
        filters.onChange({ marks: next.length ? next : undefined });
      },
    })),
    ...(filters.tags ?? []).map((id) => ({
      key: `tag:${id}`,
      label: `#${filters.known.find((tag) => tag.id === id)?.name ?? id}`,
      color: filters.known.find((tag) => tag.id === id)?.color,
      clear: () => {
        const next = (filters.tags ?? []).filter((other) => other !== id);
        filters.onChange({ tags: next.length ? next : undefined });
      },
    })),
    ...(filters.hideMarks ?? []).map((mark) => ({
      key: `hide-mark:${mark}`,
      label: `#${AUTO_MARKS[mark].name}`,
      color: markColor(mark, markColors),
      hidden: true,
      clear: () => filters.onChange({ hideMarks: togglePick(undefined, filters.hideMarks, mark, 'hide').hide }),
    })),
    ...(filters.hideTags ?? []).map((id) => ({
      key: `hide-tag:${id}`,
      label: `#${filters.known.find((tag) => tag.id === id)?.name ?? id}`,
      color: filters.known.find((tag) => tag.id === id)?.color,
      hidden: true,
      clear: () => filters.onChange({ hideTags: togglePick(undefined, filters.hideTags, id, 'hide').hide }),
    })),
  ];
}

/** 출처 and 상태 filters for displays without a table header (graph, timeline), in the toolbar. */
export function KnowledgeFilters(filters: KnowledgeFilterState) {
  return (
    <Inline gap="normal" variant="caption" tone="muted">
      <HeaderFilter label="상태" value={filters.status} options={statusOptions} onChange={(value) => filters.onChange({ status: value as StatusFilter })} />
      <TagFilter filters={filters} />
      <HeaderFilter label="출처" value={filters.source} options={sourceOptions} onChange={(value) => filters.onChange({ source: value as SourceFilter })} />
    </Inline>
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
      {picked > actionable.length && <Text variant="caption" tone="muted">사람이 정한 {picked - actionable.length}개는 건너뜁니다</Text>}
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
    ...spec.columns.map((column, index): ColumnDef<Row, unknown> => ({ id: column.head, header: column.head, meta: { width: column.width, weight: column.weight, tabular: column.tabular, hideable: index === 0 ? false : undefined }, cell: ({ row }) => column.cell(row.original) })),
    ...metaColumns<Row>((row) => row, filters),
  ];
  return <DataTable id={id} columns={columns} rows={rows} loading={loading} rowId={(row) => row.id} selected={selected} onRowClick={(row) => onOpen(row.id)} rowState={candidateRow} picked={picked} onPick={onPick} bulk={bulk} empty={empty} />;
}

function DiscardButton({ count, onConfirm, disabled }: { count: number; onConfirm: () => void; disabled?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" tone="danger" disabled={disabled}>
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
