import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ArrowLeftRight, GanttChart, Network, Plus, Sparkles, Table2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { CHARACTER_ROLE_LABELS, OTHERS_LISTENER, parseMarks, type AutoMark, styleNames, isSettled, KNOWLEDGE_SOURCES, listenerLabel, REVIEW_TAG, SPEECH_LEVEL_LABELS, type KnowledgeSource, personLabel } from '@tw/shared';
import { EmptyState, TagMenu, SplitPane, FilterChips, FilterBar, ActionBar, ViewSwitch, Separator, Badge, Button, Skeleton, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { HeaderActions, Page, StatusBarItem } from '@/components/page';
import { RelationshipGraph } from '@/components/relationship-graph';
import { hasAnalysis, JobStatus, StartAnalysis } from '@/components/knowledge/analysis-controls';
import { DraftEditor } from '@/components/knowledge/editor';
import { RelationshipChanges, RuleLines } from '@/components/knowledge/evidence';
import { BulkDecide, fail, KINDS, KnowledgeFilters, knowledgeFilterChips, KNOWLEDGE_MARK_IDS, KnowledgeTable, matches, type KnowledgeFilterState, SourceBadge, type Kind, type KindSpec, type Row, type SourceFilter, defineKind } from '@/components/knowledge/table';
import { pairKey, buildPairs, PairDetail, pairItems, pairMatches, pairSummary, PairTable, type Pair, type SpeechRuleCreate } from '@/components/knowledge/pairs';
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
  const tab: Tab = search.tab ?? 'documents';
  // 인물·관계 is one graph (people and their relationships) or two tables (pairs / people).
  const graph = tab === 'people' && !search.display;
  const pairsView = tab === 'people' && search.display === 'table';
  const timeline = tab === 'events' && search.display !== 'table';
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
        { head: '번역 문맥', cell: (row) => (row.alwaysInclude ? <Badge variant="outline">넣음</Badge> : null), width: 96 },
        { head: '내용', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{row.body.replace(/[#*_>`]+/g, '').replace(/\s+/g, ' ')}</span> },
      ],
      fields: [
        { name: 'title', label: '제목', type: 'text' },
        { name: 'kind', label: '종류', type: 'docKind' },
        { name: 'alwaysInclude', label: '번역 문맥에 넣기 (‘작품 문서’를 켠 AI 노드에 전문이 들어감)', type: 'bool' },
        { name: 'body', label: '본문 (마크다운)', type: 'long' },
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
        { name: 'player', label: '플레이어 캐릭터', type: 'bool' },
        { name: 'gender', label: '성별 (그 외: 안드로이드·무성 등, 자세한 건 프로필에)', type: 'gender' },
        { name: 'ageBand', label: '나이대', type: 'ageBand' },
        { name: 'role', label: '역할', type: 'role' },
        { name: 'profile', label: '프로필', type: 'long' },
        { name: 'speech', label: '말투 특징 (원문 관찰)', type: 'long' },
        { name: 'style', label: '문체 (이 인물 대사의 번역에 지시로 들어감)', type: 'style' },
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
        { name: 'mutual', label: '서로 같은 관계', type: 'bool' },
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
        { name: 'toName', label: '청자 (여럿 group · 불특정 다수 public · 혼잣말 self · 그 밖의 사람 others)', type: 'text' },
        { name: 'level', label: '말투', type: 'level' },
        { name: 'address', label: '호칭', type: 'chips', suggestions: (rules.data ?? []).flatMap((rule) => splitList(rule.address)) },
        { name: 'startKey', label: '시작 대사 키 (비우면 처음부터)', type: 'key' },
        { name: 'note', label: '이유·메모 (사람이 보는 설명, AI에 보내지 않음)', type: 'long' },
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
    selected && { kind: KINDS[tableKind], id: selected.id, label: spec.label(selected), detail: !isSettled(selected) ? (selected.status === 'candidate' ? '후보' : '확정 · AI가 정함, 아직 사람이 확인 안 함') : undefined },
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

  const jobs = useQuery(q.analysisJobs(projectId));
  const analysed = hasAnalysis(jobs.data);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const pending = tab === 'documents' ? documents.isPending : tab === 'events' ? storyEvents.isPending : people.isPending || rules.isPending;
  // Only the tags that belong on knowledge items (자료).
  const knowledgeTags = tagsIn(statuses.data?.tags, 'knowledge');
  const filters: KnowledgeFilterState = {
    source: search.source,
    marks: search.marks,
    tags: search.tags,
    known: knowledgeTags,
    onChange: (next) => set({ ...('source' in next && { source: next.source }), ...('marks' in next && { marks: next.marks }), ...('tags' in next && { tags: next.tags }), item: undefined }),
  };
  const filtered = Boolean(search.source || search.marks?.length || search.tags?.length || search.ids);
  const chips = [...knowledgeFilterChips(filters), ...(search.ids ? [{ key: 'ids', label: `이번 실행 범위 ${search.ids.length}개`, clear: () => set({ ids: undefined, item: undefined }) }] : [])];
  const bulk = (
    <>
      <BulkDecide picked={checked.size} actionable={checkedRows} pending={decide.isPending} onConfirm={() => decide.mutate({ items: checkedItems(), action: 'confirm' })} onDiscard={() => decide.mutate({ items: checkedItems(), action: 'discard' })} />
      {/* A person's tags only: the app's own (확인 권장) come off when a person decides. */}
      <TagMenu
        tags={knowledgeTags.filter((item) => !item.role)}
        heading={`고른 ${checked.size}개의 태그`}
        state={(tagId) => {
          const on = pickedRows().filter(({ row }) => row.tags?.some((item) => item.id === tagId)).length;
          return on === 0 ? 'none' : on === pickedRows().length ? 'all' : 'some';
        }}
        onToggle={(tagId, add) => tag.mutate({ items: pickedRows(), tagId, add })}
      />
    </>
  );
  const total = graph ? `인물 ${characters.length.toLocaleString()}명 · 관계 ${visiblePairs.length.toLocaleString()}쌍` : pairsView ? `${visiblePairs.length.toLocaleString()}쌍` : `${rows.length.toLocaleString()}${tab === 'people' ? '명' : '개'}`;
  const count = pending ? undefined : `${total}${unofficialHere > 0 ? ` · 확인 필요 ${unofficialHere.toLocaleString()}` : ''}`;
  const empty = <EmptyState noun={`${KINDS[tableKind]} 항목`} filtered={filtered} />;

  return (
    <Page title="자료" flush>
      <SplitPane
        id="knowledge"
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
                { value: 'characters', label: '인물 표', icon: <Users /> },
                { value: 'table', label: '관계 표', icon: <ArrowLeftRight /> },
              ] : [{ value: 'timeline', label: '흐름', icon: <GanttChart /> }, { value: 'table', label: '표', icon: <Table2 />}]} />
            <Separator orientation="vertical" className="mx-1 h-4" />
          </>}
          {!pairsView && spec.create && <Button disabled={create.isPending} onClick={() => create.mutate()}><Plus /> {KINDS[tableKind]}</Button>}
          <ActionBar aria-label="작품 지식 동작" items={[{ id: 'analysis', label: analysed ? '작품 다시 분석' : '작품 분석', icon: <Sparkles />, disabled: jobs.data?.[0]?.status === 'running', overflow: 'always', onSelect: () => setAnalysisOpen(true) }]} />
        </HeaderActions>
        <StartAnalysis projectId={projectId} hideTrigger open={analysisOpen} onOpenChange={setAnalysisOpen} />
        <FilterBar end={<span className="text-2xs font-medium text-subtle-foreground tabular-nums">{count}</span>}>
          {(graph || timeline) && <KnowledgeFilters {...filters} />}
          <FilterChips chips={chips} />
        </FilterBar>
        <StatusBarItem><div className="min-w-0 truncate"><JobStatus projectId={projectId} /></div></StatusBarItem>
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
                projectId={projectId}
                filtered={filtered}
                events={specs.events.rows.filter(shown)}
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
          <KnowledgeTable
            id={`knowledge-${tableKind}`}
            spec={spec}
            rows={pending ? undefined : rows}
            loading={pending}
            selected={search.item}
            onOpen={(id) => set({ item: id === search.item ? undefined : id })}
            picked={checked}
            onPick={pick}
            bulk={bulk}
            empty={empty}
            filters={filters}
          />
        )}
      </SplitPane>
    </Page>
  );
}

