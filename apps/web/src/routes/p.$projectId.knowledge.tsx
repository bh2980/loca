import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ArrowLeftRight, GanttChart, Network, Plus, Table2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { CHARACTER_ROLE_LABELS, OTHERS_LISTENER, PALETTE, parseMarks, type AutoMark, styleNames, isSettled, aiDecided, KNOWLEDGE_SOURCES, listenerLabel, REVIEW_TAG, SPEECH_LEVEL_LABELS, type KnowledgeSource, type TagScope, personLabel } from '@tw/shared';
import {
  EmptyState,
  TagMenu,
  SplitPane,
  FilterChips,
  FilterBar,
  ViewSwitch,
  CanvasDirectionControl,
  Separator,
  Badge,
  Button,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  DataTable,
  type ColumnDef,
  ContextMenuItem,
  ContextMenuSeparator,
  useRevealDock,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@loca/ui';
import { HeaderActions, Page, StatusBarItem } from '@/components/page';
import { RelationshipGraph } from '@/components/relationship-graph';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Play } from 'lucide-react';
import { DraftEditor } from '@/components/knowledge/editor';
import { RelationshipChanges, RuleLines } from '@/components/knowledge/evidence';
import { BulkDecide, fail, KINDS, KnowledgeFilters, knowledgeFilterChips, KNOWLEDGE_MARK_IDS, matches, type KnowledgeFilterState, SourceBadge, type Kind, type KindSpec, type Row, type SourceFilter, defineKind, metaColumns, candidateRow } from '@/components/knowledge/table';
import { pairKey, buildPairs, PairDetail, pairItems, pairMatches, pairSummary, PairTable, type Pair, type SpeechRuleCreate } from '@/components/knowledge/pairs';
import { AddPairPopover } from '@/components/knowledge/add-pair-popover';
import { EventFlow } from '@/components/knowledge/event-flow';
import { splitList } from '@/components/chip-input';
import { client, unwrap } from '@/lib/api';
import { DOCUMENT_KIND } from '@/lib/labels';
import { q, tagsIn, useReviewTagId } from '@/lib/queries';
import { usePicked } from '@/lib/use-picked';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

/** Tabs (the top bar's section tabs link to them). Relationships and speech rules share 인물·관계 because both describe speaker → listener pairs. */
const TABS = { documents: '문서', people: '인물·관계', events: '사건' } as const;
type Tab = keyof typeof TABS;
interface KnowledgeSearch {
  tab?: Tab;
  /** 출처 filter: who wrote it (작품 분석, 워크플로·채팅, 대본에서 찾음, 가져오기, 사람). */
  source?: KnowledgeSource;
  /** Automatic marks (#후보, #AI가 정함, #근거 없음): items carrying them; the first two together mean either (see matchesMarks). */
  marks?: AutoMark[];
  /** 태그 filter: project tag ids (확인 권장, a person's own); items carrying all of them. */
  tags?: string[];
  /** Only these items (a run's scope, from the run dialog's readiness list); shown as a removable chip, combined with the other filters. In 인물·관계 tables the pairs holding them. */
  ids?: string[];
  /** Selected item id, or a pair key ("from→to") in 인물·관계 › 관계. */
  item?: string;
  /** Presentation. Default is the picture (relationship graph / event flow); 'table' is the table instead (인물·관계: pairs), 'characters' the people table in 인물·관계. */
  display?: 'table' | 'characters';
  direction?: 'vertical' | 'horizontal';
}

export const Route = createFileRoute('/p/$projectId/knowledge')({
  validateSearch: (raw: Record<string, unknown>): KnowledgeSearch => ({
    tab: typeof raw.tab === 'string' && raw.tab in TABS ? (raw.tab as Tab) : undefined,
    source: typeof raw.source === 'string' && (KNOWLEDGE_SOURCES as readonly string[]).includes(raw.source) ? (raw.source as KnowledgeSource) : undefined,
    marks: parseMarks(raw.marks, KNOWLEDGE_MARK_IDS),
    tags: Array.isArray(raw.tags) && raw.tags.length && raw.tags.every((id) => typeof id === 'string') ? (raw.tags as string[]) : undefined,
    ids: Array.isArray(raw.ids) && raw.ids.length && raw.ids.every((id) => typeof id === 'string') ? (raw.ids as string[]) : undefined,
    item: typeof raw.item === 'string' && raw.item ? raw.item : undefined,
    display: raw.display === 'table' || raw.display === 'characters' ? raw.display : undefined,
    direction: raw.direction === 'horizontal' || raw.direction === 'vertical' ? raw.direction : undefined,
  }),
  component: Knowledge,
});

/**
 * The work's knowledge: documents, people with their speaker → listener pairs (relationship +
 * speech rules), and events. "작품 분석" fills it; every item shows who wrote it (출처) and whether it
 * is a candidate, confirmed by AI (✦, used but unchecked) or decided by a person; undecided items can be
 * confirmed (확정 / 확인함) or discarded in bulk.
 */
function Knowledge() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const revealDock = useRevealDock();
  const tab: Tab = search.tab ?? 'documents';
  // 인물·관계 is one graph (people and their relationships) or two tables (pairs / people).
  const graph = tab === 'people' && !search.display;
  const pairsView = tab === 'people' && search.display === 'table';
  const timeline = tab === 'events' && search.display !== 'table';
  const direction = search.direction ?? 'vertical';
  const set = (next: Partial<KnowledgeSearch>, replace = true) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });

  const statuses = useQuery(q.statuses(projectId));
  const reviewTag = useReviewTagId(projectId);
  const documents = useQuery(q.documents(projectId));
  const people = useQuery(q.characters(projectId));
  const storyEvents = useQuery(q.storyEvents(projectId));
  const rules = useQuery(q.speechRules(projectId));
  const nameOf = useMemo(() => new Map((people.data?.characters ?? []).map((c) => [c.id, c.name])), [people.data]);
  const api = client.projects[':projectId'];
  const param = (id: string) => ({ param: { projectId, id } });
  // Saves a kind's form through its PATCH endpoint. A form key the endpoint does not take fails to
  // compile here: the server's schema would drop it and the edit would vanish without an error.
  const patchTo =
    <P, T extends Response & { json(): Promise<unknown> }>(patch: (args: { param: { projectId: string; id: string }; json: P }) => Promise<T>) =>
    <J extends P>(id: string, json: J & Record<Exclude<keyof J, keyof P>, never>) =>
      unwrap(patch({ ...param(id), json }));

  // Each kind typed by its rows: a field must name a key of the row with a matching type, and
  // the form it saves must be what the endpoint accepts (no casts; see defineKind).
  const specs = {
    documents: defineKind({
      rows: documents.data ?? [],
      columns: [
        { head: '제목', cell: (row) => row.title, className: 'font-medium', width: 240 },
        { head: '종류', cell: (row) => DOCUMENT_KIND[row.kind], width: 96 },
        { head: '문맥', cell: (row) => (row.alwaysInclude ? <Badge variant="outline">넣음</Badge> : null), width: 96 },
        { head: '내용', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.body.replace(/[#*_>`]+/g, '').replace(/\s+/g, ' ')}</span> },
      ],
      fields: [
        { name: 'title', label: '제목', type: 'text' },
        { name: 'kind', label: '종류', type: 'docKind' },
        { name: 'alwaysInclude', label: '문맥에 넣기', type: 'bool' },
        { name: 'body', label: '본문', type: 'long' },
      ],
      create: () => unwrap(api.documents.$post({ param: { projectId }, json: { title: '새 문서', kind: 'note', body: '', alwaysInclude: false } })),
      label: (row) => row.title,
      save: patchTo(api.documents[':id'].$patch),
      remove: (id) => unwrap(api.documents[':id'].$delete(param(id))),
    }),
    characters: defineKind({
      rows: people.data?.characters ?? [],
      columns: [
        { head: '이름', cell: (row) => <span className="font-medium">{row.name}{row.player ? <Badge variant="outline" className="ml-2">플레이어</Badge> : null}</span>, width: 220 },
        { head: '별칭', cell: (row) => row.aliases.join(', '), width: 180 },
        { head: '성별·나이', cell: (row) => <span className="text-muted-foreground">{personLabel(row)}</span>, width: 120 },
        { head: '역할', cell: (row) => row.role === 'unknown' ? null : CHARACTER_ROLE_LABELS[row.role], width: 90 },
        { head: '프로필', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.profile}</span> },
        { head: '문체', cell: (row) => <span className="text-muted-foreground">{styleNames(row.style).join(' · ')}</span>, width: 180 },
      ],
      fields: [
        { name: 'name', label: '이름', type: 'text' },
        { name: 'aliases', label: '별칭', type: 'list' },
        { name: 'player', label: '플레이어', type: 'bool' },
        { name: 'gender', label: '성별', type: 'gender' },
        { name: 'ageBand', label: '나이대', type: 'ageBand' },
        { name: 'role', label: '역할', type: 'role' },
        { name: 'profile', label: '프로필', type: 'long' },
        { name: 'speech', label: '말버릇', type: 'long' },
        { name: 'style', label: '문체', type: 'style' },
      ],
      label: (row) => row.name,
      save: patchTo(api.characters[':id'].$patch),
      create: () => unwrap(api.characters.$post({ param: { projectId }, json: { name: '새 인물' } })),
      remove: (id) => unwrap(api.characters[':id'].$delete(param(id))),
    }),
    relationships: defineKind({
      rows: people.data?.relationships ?? [],
      columns: [
        { head: '인물', cell: (row) => `${nameOf.get(row.fromId) ?? '?'} → ${nameOf.get(row.toId) ?? '?'}`, className: 'font-medium', width: 240 },
        { head: '관계', cell: (row) => row.kind, width: 160 },
        { head: '변화', cell: (row) => (row.changes.length ? `${row.changes.length}번` : '—'), className: 'tabular-nums', width: 80 },
        { head: '설명', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.description}</span> },
      ],
      fields: [
        { name: 'fromId', label: '누가', type: 'character' },
        { name: 'toId', label: '누구에게', type: 'character' },
        { name: 'kind', label: '관계', type: 'text' },
        { name: 'mutual', label: '쌍방', type: 'bool' },
        { name: 'description', label: '설명', type: 'long' },
      ],
      label: (row) => `${nameOf.get(row.fromId) ?? '?'} → ${nameOf.get(row.toId) ?? '?'}`,
      save: patchTo(api.relationships[':id'].$patch),
      create:
        (people.data?.characters.length ?? 0) >= 2
          ? () => unwrap(api.relationships.$post({ param: { projectId }, json: { fromId: people.data!.characters[0].id, toId: people.data!.characters[1].id, kind: '관계' } }))
          : undefined,
      remove: (id) => unwrap(api.relationships[':id'].$delete(param(id))),
      extra: (row) => <RelationshipChanges projectId={projectId} changes={row.changes} />,
    }),
    events: defineKind({
      rows: storyEvents.data ?? [],
      columns: [
        { head: '사건', cell: (row) => row.title, className: 'font-medium', width: 260 },
        { head: '관련 인물', cell: (row) => row.participants.join(', '), width: 200 },
        { head: '결과', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.outcome}</span> },
      ],
      fields: [
        { name: 'title', label: '제목', type: 'text' },
        { name: 'summary', label: '요약', type: 'long' },
        { name: 'cause', label: '원인', type: 'long' },
        { name: 'outcome', label: '결과', type: 'long' },
        { name: 'participants', label: '관련 인물', type: 'list', suggestions: (people.data?.characters ?? []).map((c) => c.name) },
      ],
      label: (row) => row.title,
      save: patchTo(api.events[':id'].$patch),
      create: () => unwrap(api.events.$post({ param: { projectId }, json: { title: '새 사건' } })),
      remove: (id) => unwrap(api.events[':id'].$delete(param(id))),
    }),
    speechRules: defineKind({
      rows: [...(rules.data ?? [])].sort((a, b) => a.fromName.localeCompare(b.fromName) || a.toName.localeCompare(b.toName)),
      columns: [
        { head: '화자 → 청자', cell: (row) => `${row.fromName} → ${listenerLabel(row.toName)}`, className: 'font-medium', width: 240 },
        { head: '말투', cell: (row) => SPEECH_LEVEL_LABELS[row.level], width: 96 },
        { head: '호칭', cell: (row) => row.address || '—', width: 120 },
        { head: '시작', cell: (row) => (row.startKey ? <span className="font-mono text-xs">{row.startKey}</span> : '처음부터'), width: 120 },
        { head: '이유', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.note}</span> },
      ],
      fields: [
        { name: 'fromName', label: '화자', type: 'text' },
        { name: 'toName', label: '청자', description: '여럿: group · 불특정 다수: public · 혼잣말: self · 그 밖의 사람: others', type: 'text' },
        { name: 'level', label: '말투', type: 'level' },
        { name: 'address', label: '호칭', type: 'chips', suggestions: (rules.data ?? []).flatMap((rule) => splitList(rule.address)) },
        { name: 'startKey', label: '시작 대사', type: 'key' },
        { name: 'note', label: '메모', type: 'long' },
      ],
      label: (row) => `${row.fromName} → ${listenerLabel(row.toName)}`,
      save: patchTo(api['speech-rules'][':id'].$patch),
      extra: (row) => <RuleLines projectId={projectId} ruleId={row.id} candidate={row.status === 'candidate'} />,
      create: () => unwrap(api['speech-rules'].$post({ param: { projectId }, json: { fromName: '화자', toName: '청자', level: 'haeyo' } })),
      remove: (id) => unwrap(api['speech-rules'][':id'].$delete(param(id))),
    }),
  } satisfies Record<Kind, KindSpec>;
  /** A new speech stretch from a picked line (the pair pane). */
  const addRule = (json: SpeechRuleCreate) => unwrap(api['speech-rules'].$post({ param: { projectId }, json }));

  const characters = people.data?.characters ?? [];
  const inScope = (id: string) => !search.ids || search.ids.includes(id);
  const shown = (row: Row) => inScope(row.id) && matches(row, search.source, search.marks, search.tags);
  const pairs = useMemo(() => buildPairs(characters, specs.relationships.rows, specs.speechRules.rows), [characters, specs.relationships.rows, specs.speechRules.rows]);
  const visiblePairs = pairs.filter((pair) => pairMatches(pair, search.source, search.marks, search.tags) && (!search.ids || pairItems(pair).some((item) => inScope(item.row.id))));
  // A link may name a relationship or rule id; it opens the pair holding it.
  const pair = pairsView || graph ? pairs.find((candidate) => candidate.key === search.item || pairItems(candidate).some((item) => item.row.id === search.item)) : undefined;

  const tableKind: Kind = tab === 'people' ? 'characters' : tab;
  const spec: KindSpec = specs[tableKind];
  const rows = spec.rows.filter(shown);
  const selected = !pairsView ? spec.rows.find((row) => row.id === search.item) : undefined;
  const unofficial = (kind: Kind) => specs[kind].rows.filter((row) => !isSettled(row)).length;
  const unofficialHere = tab === 'people' ? unofficial('characters') + unofficial('relationships') + unofficial('speechRules') : unofficial(tab);
  useReportView('knowledge', [
    selected && { kind: KINDS[tableKind], id: selected.id, label: spec.label(selected), detail: !isSettled(selected) ? (selected.status === 'candidate' ? '후보' : '확정 · AI 초안') : undefined },
    pair && { kind: '관계·말투', id: pair.key, label: `${pair.from} → ${pair.to}` },
  ]);

  // Picks belong to one list (tab + presentation): each keeps its own, and Back brings them back.
  const { picked: checked, pick, clear: clearChecked } = usePicked(`knowledge.${projectId}.${tab}.${search.display ?? 'picture'}`);
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: async ({ items, action }: { items: { kind: Kind; ids: string[] }[]; action: 'confirm' | 'discard' }) => {
      let changed = 0;
      for (const { kind, ids } of items) if (ids.length) changed += (await unwrap(api.drafts.$post({ param: { projectId }, json: { kind, ids, action } }))).changed;
      return changed;
    },
    // Shown at once: the rows turn confirmed (or go) in the cached lists before the server answers;
    // the refetch that the change sets off (knowledge, then lines and counts) only catches up.
    onMutate: async ({ items, action }) => {
      const touched: { key: QueryKey; before: unknown }[] = [];
      const edit = async (key: QueryKey, update: (old: unknown) => unknown) => {
        await queryClient.cancelQueries({ queryKey: key });
        touched.push({ key, before: queryClient.getQueryData(key) });
        queryClient.setQueryData(key, (old: unknown) => (old === undefined ? old : update(old)));
      };
      const decided = (ids: Set<string>) => (rows: { id: string }[]) =>
        action === 'discard' ? rows.filter((row) => !ids.has(row.id)) : rows.map((row) => (ids.has(row.id) ? { ...row, status: 'confirmed', statusBy: 'human', tags: (row as Row).tags?.filter((item) => item.id !== reviewTag) } : row));
      for (const { kind, ids } of items) {
        if (!ids.length) continue;
        const apply = decided(new Set(ids));
        if (kind === 'characters' || kind === 'relationships')
          await edit(q.characters(projectId).queryKey, (old) => {
            const data = old as { characters: { id: string }[]; relationships: { id: string; fromId: string; toId: string }[] };
            return kind === 'characters' ? { ...data, characters: apply(data.characters) } : { ...data, relationships: apply(data.relationships) };
          });
        else await edit((kind === 'documents' ? q.documents(projectId) : kind === 'events' ? q.storyEvents(projectId) : q.speechRules(projectId)).queryKey, (old) => apply(old as { id: string }[]));
      }
      return { touched };
    },
    onSuccess: (changed, { action }) => {
      clearChecked();
      toast.success(action === 'confirm' ? `${changed}개를 확정·확인했습니다.` : `${changed}개를 버렸습니다.`);
    },
    onError: (error, _vars, context) => {
      for (const { key, before } of context?.touched ?? []) queryClient.setQueryData(key, before);
      fail(error);
    },
  });
  // Bulk actions over the checked rows (pairs expand to their relationship and rules).
  const checkedItems = (): { kind: Kind; ids: string[] }[] => {
    if (!pairsView) return [{ kind: tableKind, ids: rows.filter((row) => checked.has(row.id) && !isSettled(row)).map((row) => row.id) }];
    const items = visiblePairs.filter((candidate) => checked.has(candidate.key)).flatMap(pairItems).filter((item) => !isSettled(item.row));
    return (['relationships', 'speechRules'] as const).map((kind) => ({ kind, ids: items.filter((item) => item.kind === kind).map((item) => item.row.id) }));
  };
  // Every picked item with its kind (pairs expand to their relationship and rules), for tagging.
  const pickedRows = (): { kind: Kind; row: Row }[] =>
    pairsView ? visiblePairs.filter((candidate) => checked.has(candidate.key)).flatMap(pairItems) : rows.filter((row) => checked.has(row.id)).map((row) => ({ kind: tableKind, row }));
  const tag = useMutation({
    mutationFn: async ({ items, tagId, add }: { items: { kind: Kind; row: Row }[]; tagId: string; add: boolean }) => {
      for (const [kind, list] of Map.groupBy(items, (item) => item.kind)) await unwrap(api['knowledge-tags'].$post({ param: { projectId }, json: { kind, ids: list.map((item) => item.row.id), tagId, add } }));
    },
    onError: fail,
  });
  // The undecided rows among the picks, for the confirm button's label (확정 / 확인함).
  const checkedRows: Row[] = pairsView ? visiblePairs.filter((candidate) => checked.has(candidate.key)).flatMap(pairItems).map((item) => item.row).filter((row) => !isSettled(row)) : rows.filter((row) => checked.has(row.id) && !isSettled(row));

  const create = useMutation({
    mutationFn: () => spec.create!(),
    onSuccess: (row) => set({ item: row.id, source: undefined, marks: undefined }),
    onError: fail,
  });
  // Pair-specific creation: a relationship between the pair's people, a speech rule for its names.
  const pairSpecs = (pair: Pair) => ({
    relationships: { ...specs.relationships, create: pair.fromId && pair.toId ? () => unwrap(api.relationships.$post({ param: { projectId }, json: { fromId: pair.fromId!, toId: pair.toId!, kind: '관계' } })) : undefined },
    speechRules: specs.speechRules,
    addRule,
  });
  const edges = useMemo(
    () =>
      visiblePairs
        .filter((candidate) => candidate.fromId && candidate.toId)
        .map((candidate) => ({ id: candidate.key, fromId: candidate.fromId!, toId: candidate.toId!, kind: candidate.relationship?.kind ?? '', mutual: false, dashed: pairSummary(candidate).status === 'candidate' })),
    [visiblePairs],
  );

  const pending = tab === 'documents' ? documents.isPending : tab === 'events' ? storyEvents.isPending : people.isPending || rules.isPending;
  const tabScope: TagScope = tab === 'documents' ? 'documents' : tab === 'events' ? 'events' : 'people';
  const knowledgeTags = tagsIn(statuses.data?.tags, tabScope);
  const filters: KnowledgeFilterState = {
    source: search.source,
    marks: search.marks,
    tags: search.tags,
    known: knowledgeTags,
    onChange: (next) => set({ ...('source' in next && { source: next.source }), ...('marks' in next && { marks: next.marks }), ...('tags' in next && { tags: next.tags }), item: undefined }),
  };
  const filtered = Boolean(search.source || search.marks?.length || search.tags?.length || search.ids);
  const chips = [...knowledgeFilterChips(filters), ...(search.ids ? [{ key: 'ids', label: `실행 범위 ${search.ids.length}`, clear: () => set({ ids: undefined, item: undefined }) }] : [])];
  const bulk = (
    <>
      <BulkDecide picked={checked.size} actionable={checkedRows} pending={decide.isPending} onConfirm={() => decide.mutate({ items: checkedItems(), action: 'confirm' })} onDiscard={() => decide.mutate({ items: checkedItems(), action: 'discard' })} />
      {/* A person's tags only: the app's own (확인 권장) come off when a person decides. */}
      <TagMenu
        tags={knowledgeTags.filter((item) => !item.role)}
        heading="태그"
        state={(tagId) => {
          const on = pickedRows().filter(({ row }) => row.tags?.some((item) => item.id === tagId)).length;
          return on === 0 ? 'none' : on === pickedRows().length ? 'all' : 'some';
        }}
        onToggle={(tagId, add) => tag.mutate({ items: pickedRows(), tagId, add })}
        onCreate={async (name) => {
          try {
            const color = (PALETTE[knowledgeTags.length % PALETTE.length] as any).light ?? PALETTE[knowledgeTags.length % PALETTE.length].hex;
            const res = await unwrap(api.tags.$post({
              param: { projectId },
              json: { name, color, scope: [tabScope] },
            }));
            await tag.mutateAsync({ items: pickedRows(), tagId: res.id, add: true });
            queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
            toast.success(`'${name}' 태그를 만들고 고른 항목에 붙였습니다.`);
          } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
          }
        }}
      />
    </>
  );
  const total = graph ? `인물 ${characters.length.toLocaleString()}명 · 관계 ${visiblePairs.length.toLocaleString()}쌍` : pairsView ? `${visiblePairs.length.toLocaleString()}쌍` : `${rows.length.toLocaleString()}${tab === 'people' ? '명' : '개'}`;
  const count = pending ? undefined : `${total}${unofficialHere > 0 ? ` · 확인 필요 ${unofficialHere.toLocaleString()}` : ''}`;
  const empty = <EmptyState noun={`${KINDS[tableKind]} 항목`} filtered={filtered} />;

  const [deletingIds, setDeletingIds] = useState<string[] | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await spec.remove(id);
      }
    },
    onSuccess: (_data, ids) => {
      if (search.item && ids.includes(search.item)) {
        set({ item: undefined });
      }
      clearChecked();
      queryClient.invalidateQueries({ queryKey: [tableKind, projectId] });
      if (tableKind === 'characters') {
        queryClient.invalidateQueries({ queryKey: q.characters(projectId).queryKey });
      } else if (tableKind === 'documents') {
        queryClient.invalidateQueries({ queryKey: q.documents(projectId).queryKey });
      } else if (tableKind === 'events') {
        queryClient.invalidateQueries({ queryKey: q.storyEvents(projectId).queryKey });
      }
      toast.success(ids.length > 1 ? `${ids.length}개 항목을 삭제했습니다.` : '항목을 삭제했습니다.');
      setDeletingIds(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '삭제하지 못했습니다.');
      setDeletingIds(null);
    },
  });

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      ...spec.columns.map(
        (column, index): ColumnDef<Row, unknown> => ({
          id: column.head,
          header: column.head,
          meta: { width: column.width, className: column.className, hideable: index === 0 ? false : undefined },
          cell: ({ row }) => column.cell(row.original),
        })
      ),
      ...metaColumns<Row>((row) => row, filters),
    ],
    [spec.columns, filters]
  );

  const renderRowContextMenu = (row: Row) => {
    const isCandidateOrAi = aiDecided(row) || row.status === 'candidate';
    return (
      <>
        <ContextMenuItem
          onClick={() => {
            set({ item: row.id });
            revealDock?.();
          }}
        >
          상세 편집
        </ContextMenuItem>
        {isCandidateOrAi && (
          <ContextMenuItem
            onClick={() => {
              decide.mutate({ items: [{ kind: tableKind, ids: [row.id] }], action: 'confirm' });
            }}
          >
            확정 / 확인함
          </ContextMenuItem>
        )}
        {tab === 'documents' && (
          <ContextMenuItem
            onClick={async () => {
              const doc = row as typeof specs.documents.rows[number];
              try {
                await unwrap(api.documents[':id'].$patch({ param: { projectId, id: row.id }, json: { alwaysInclude: !doc.alwaysInclude } }));
                queryClient.invalidateQueries({ queryKey: q.documents(projectId).queryKey });
                toast.success(!doc.alwaysInclude ? '번역 문맥에 항상 포함하도록 변경했습니다.' : '관련될 때만 포함하도록 변경했습니다.');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : '문맥 설정을 변경하지 못했습니다.');
              }
            }}
          >
            {(row as any).alwaysInclude ? '관련될 때만' : '항상 포함'}
          </ContextMenuItem>
        )}
        {tab === 'people' && search.display === 'characters' && (
          <ContextMenuItem
            onClick={() => {
              void navigate({
                to: '/p/$projectId/script',
                params: { projectId },
                search: { speaker: (row as any).name } as any,
              });
            }}
          >
            대사 보기
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => {
            const ids = checked.has(row.id) && checked.size > 1 ? [...checked] : [row.id];
            setDeletingIds(ids);
          }}
        >
          삭제
        </ContextMenuItem>
      </>
    );
  };

  return (
    <Page title="자료" flush>
      <SplitPane
        id="knowledge" selectionKey={search.item}
        defaultWidth="500px"
        className="h-full"
        pane={
          selected ? (
            <DraftEditor
              key={selected.id}
              projectId={projectId}
              kind={tableKind}
              spec={spec}
              row={selected}
              characters={characters}
              onClose={() => set({ item: undefined })}
              onDecide={(action) => decide.mutate({ items: [{ kind: tableKind, ids: [selected.id] }], action })}
            />
          ) : pair ? (
            <PairDetail
              key={pair.key}
              projectId={projectId}
              pair={pair}
              {...pairSpecs(pair)}
              characters={characters}
              others={pairs.find((other) => other.key === pairKey(pair.from, OTHERS_LISTENER))}
              onOpenPair={(key) => set({ item: key })}
              onClose={() => set({ item: undefined })}
              onDecide={(kind, ids, action) => decide.mutate({ items: [{ kind, ids }], action })}
            />
          ) : null
        }
      >
        <HeaderActions>
          {(tab === 'people' || tab === 'events') && <>
            <ViewSwitch label="보기" value={tab === 'people' ? graph ? 'graph' : search.display === 'characters' ? 'characters' : 'table' : timeline ? 'timeline' : 'table'}
              onChange={(value) => set({ display: tab === 'people' ? value === 'graph' ? undefined : value === 'characters' ? 'characters' : 'table' : value === 'table' ? 'table' : undefined, item: undefined }, false)}
              items={tab === 'people' ? [
                { value: 'graph', label: '그래프', icon: <Network /> },
                { value: 'characters', label: '인물', icon: <Users /> },
                { value: 'table', label: '관계', icon: <ArrowLeftRight /> },
              ] : [{ value: 'timeline', label: '흐름', icon: <GanttChart /> }, { value: 'table', label: '표', icon: <Table2 />}]} />
            <Separator orientation="vertical" className="mx-1 h-4" />
          </>}
          {timeline && <>
            <CanvasDirectionControl direction={direction} onDirectionChange={(next) => set({ direction: next }, false)} disabled={storyEvents.isPending} />
            <Separator orientation="vertical" className="mx-1 h-4" />
          </>}
          {(pairsView || graph) && <AddPairPopover projectId={projectId} characters={characters} pairs={pairs} onCreated={(key) => set({ item: key, source: undefined, marks: undefined, ids: undefined })} />}
          {/* One primary action: in the graph, adding a pair leads and adding a person steps back. */}
          {!pairsView && spec.create && <Button variant={graph ? 'outline' : 'default'} disabled={create.isPending} onClick={() => create.mutate()}><Plus /> {KINDS[tableKind]}</Button>}
          <RunDialog projectId={projectId} trigger={<Button variant="ghost"><Play /> 워크플로 실행</Button>} />
        </HeaderActions>
        <FilterBar end={<span className="text-2xs font-medium text-subtle-foreground tabular-nums">{count}</span>}>
          {(graph || timeline) && <KnowledgeFilters {...filters} />}
          <FilterChips chips={chips} />
        </FilterBar>
        {graph ? (
          <div className="min-h-0 flex-1">
            {/* Pairs come from speech rules too: laying out before they arrive would lay out twice. */}
            {people.isPending || rules.isPending ? (
              <Skeleton className="m-4 h-64" />
            ) : (
              <RelationshipGraph
                storageKey={`tw.relationships.${projectId}`}
                characters={characters}
                relationships={edges}
                selectedCharacterId={selected?.id}
                selectedRelationshipId={pair?.key}
                onSelectCharacter={(id) => set({ item: id })}
                onSelectRelationship={(key) => set({ item: key })}
                onClear={() => set({ item: undefined })}
              />
            )}
          </div>
        ) : timeline ? (
          <div className="min-h-0 flex-1">
            {pending ? (
              <Skeleton className="m-4 h-40" />
            ) : (
              <EventFlow
                key={direction}
                projectId={projectId}
                filtered={filtered}
                events={specs.events.rows.filter(shown)}
                direction={direction}
                selected={search.item}
                onOpen={(id) => set({ item: id })}
                badge={(event) => <SourceBadge row={rows.find((row) => row.id === event.id)!} />}
              />
            )}
          </div>
        ) : pairsView ? (
          <PairTable
            pairs={pending ? undefined : visiblePairs}
            loading={pending}
            selected={pair?.key}
            picked={checked}
            onPick={pick}
            onOpen={(key) => set({ item: key === pair?.key ? undefined : key })}
            bulk={bulk}
            filters={filters}
          />
        ) : (
          <DataTable
            id={`knowledge-${tableKind}`}
            columns={columns}
            rows={pending ? undefined : rows}
            loading={pending}
            rowId={(row) => row.id}
            selected={search.item}
            onRowClick={(row) => set({ item: row.id === search.item ? undefined : row.id })}
            rowClassName={candidateRow}
            picked={checked}
            onPick={pick}
            bulk={bulk}
            empty={empty}
            rowContextMenu={renderRowContextMenu}
          />
        )}
      </SplitPane>
      <AlertDialog open={Boolean(deletingIds)} onOpenChange={(open) => !open && setDeletingIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletingIds && deletingIds.length > 1 ? `${deletingIds.length}개 항목을 삭제할까요?` : '항목을 삭제할까요?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              삭제한 항목은 사라지고 더 이상 AI 문맥에 쓰이지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deletingIds) {
                  deleteMutation.mutate(deletingIds);
                }
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

