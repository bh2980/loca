import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, GanttChart, Network, Plus, Table2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_KINDS, isSettled, KNOWLEDGE_SOURCES, listenerLabel, SPEECH_LEVEL_LABELS, type KnowledgeSource, type SpeechLevel } from '@tw/shared';
import { Page } from '@/components/page';
import { RelationshipGraph } from '@/components/relationship-graph';
import { hasAnalysis, JobStatus, StartAnalysis } from '@/components/knowledge/analysis-controls';
import { BulkDecide, DraftEditor, fail, KINDS, KnowledgeFilters, KnowledgeTable, matches, RelationshipChanges, RuleLines, SourceBadge, text, type Kind, type KindSpec, type Row } from '@/components/knowledge/draft-editor';
import { SplitPane } from '@/components/split-pane';
import { Toolbar } from '@/components/toolbar';
import { buildPairs, PairDetail, pairItems, pairMatches, pairSummary, PairTable, type Pair } from '@/components/knowledge/pairs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EventFlow, type FlowEvent } from '@/components/knowledge/event-flow';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client, unwrap } from '@/lib/api';
import { DOCUMENT_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

/** Tabs (the top bar's section tabs link to them). Relationships and speech rules share 인물·관계 because both describe speaker → listener pairs. */
const TABS = { documents: '문서', people: '인물·관계', events: '사건' } as const;
type Tab = keyof typeof TABS;
interface KnowledgeSearch {
  tab?: Tab;
  /** 출처 filter: AI / 정식. */
  source?: KnowledgeSource;
  /** 상태 filter: 확정 / 후보. */
  state?: 'confirmed' | 'candidate';
  /** Selected item id, or a pair key ("from→to") in 인물·관계 › 관계. */
  item?: string;
  /** Inside 인물·관계 shown as tables: people instead of pairs. */
  view?: 'characters';
  /** 인물·관계 as tables instead of the graph; 사건 as a timeline instead of the table. */
  /** '표' instead of the picture (relationship graph / event flow), which is the default for both. */
  display?: 'table';
}

export const Route = createFileRoute('/p/$projectId/knowledge')({
  validateSearch: (raw: Record<string, unknown>): KnowledgeSearch => ({
    tab: typeof raw.tab === 'string' && raw.tab in TABS ? (raw.tab as Tab) : undefined,
    source: typeof raw.source === 'string' && (KNOWLEDGE_SOURCES as readonly string[]).includes(raw.source) ? (raw.source as KnowledgeSource) : undefined,
    state: raw.state === 'confirmed' || raw.state === 'candidate' ? raw.state : undefined,
    item: typeof raw.item === 'string' && raw.item ? raw.item : undefined,
    view: raw.view === 'characters' ? 'characters' : undefined,
    display: raw.display === 'table' ? 'table' : undefined,
  }),
  component: Knowledge,
});

/**
 * The work's knowledge: documents, people with their speaker → listener pairs (relationship +
 * speech rules), and events. "작품 분석" fills it; every item shows whether it is an AI candidate,
 * AI-confirmed (used, unchecked) or official, and AI items can be promoted or discarded in bulk.
 */
function Knowledge() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: Tab = search.tab ?? 'documents';
  // 인물·관계 is one graph (people and their relationships) or two tables (pairs / people).
  const graph = tab === 'people' && search.display !== 'table';
  const pairsView = tab === 'people' && !graph && search.view !== 'characters';
  const timeline = tab === 'events' && search.display !== 'table';
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
        { head: '제목', cell: (row) => text(row.title), className: 'font-medium', width: 240 },
        { head: '종류', cell: (row) => DOCUMENT_KIND[row.kind as (typeof DOCUMENT_KINDS)[number]], width: 96 },
        { head: '번역 문맥', cell: (row) => (row.alwaysInclude ? <Badge variant="outline">넣음</Badge> : null), width: 96 },
        { head: '내용', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{text(row.body).replace(/[#*_>`]+/g, '').replace(/\s+/g, ' ')}</span> },
      ],
      fields: [
        { name: 'title', label: '제목', type: 'text' },
        { name: 'kind', label: '종류', type: 'docKind' },
        { name: 'alwaysInclude', label: '번역 문맥에 넣기 (‘작품 문서’를 켠 AI 노드에 전문이 들어감)', type: 'bool' },
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
        { head: '이름', cell: (row) => <span className="font-medium">{text(row.name)}{row.player ? <Badge variant="outline" className="ml-2">플레이어</Badge> : null}</span>, width: 220 },
        { head: '별칭', cell: (row) => (row.aliases as string[]).join(', '), width: 180 },
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
        { head: '인물', cell: (row) => `${nameOf.get(text(row.fromId)) ?? '?'} → ${nameOf.get(text(row.toId)) ?? '?'}`, className: 'font-medium', width: 240 },
        { head: '관계', cell: (row) => text(row.kind), width: 160 },
        { head: '변화', cell: (row) => ((row.changes as unknown[]).length ? `${(row.changes as unknown[]).length}번` : '—'), className: 'tabular-nums', width: 80 },
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
        { head: '사건', cell: (row) => text(row.title), className: 'font-medium', width: 260 },
        { head: '관련 인물', cell: (row) => (row.participants as string[]).join(', '), width: 200 },
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
        { head: '화자 → 청자', cell: (row) => `${text(row.fromName)} → ${listenerLabel(text(row.toName))}`, className: 'font-medium', width: 240 },
        { head: '말투', cell: (row) => SPEECH_LEVEL_LABELS[row.level as SpeechLevel], width: 96 },
        { head: '호칭', cell: (row) => text(row.address) || '—', width: 120 },
        { head: '시작', cell: (row) => (row.startKey ? <span className="font-mono text-xs">{text(row.startKey)}</span> : '처음부터'), width: 120 },
        { head: '이유', cell: (row) => <span className="line-clamp-1 text-muted-foreground">{text(row.note)}</span> },
      ],
      fields: [
        { name: 'fromName', label: '화자', type: 'text' },
        { name: 'toName', label: '청자 (여럿 group · 불특정 다수 public · 혼잣말 self)', type: 'text' },
        { name: 'level', label: '말투', type: 'level' },
        { name: 'address', label: '호칭', type: 'text' },
        { name: 'startKey', label: '시작 대사 키 (비우면 처음부터)', type: 'key' },
        { name: 'note', label: '이유·메모 (사람이 보는 설명, AI에 보내지 않음)', type: 'long' },
      ],
      label: (row) => `${text(row.fromName)} → ${listenerLabel(text(row.toName))}`,
      save: (id, json) => unwrap(api['speech-rules'][':id'].$patch({ ...param(id), json: json as never })),
      extra: (row) => <RuleLines projectId={projectId} ruleId={row.id} candidate={row.status === 'candidate'} />,
      create: () => unwrap(api['speech-rules'].$post({ param: { projectId }, json: { fromName: '화자', toName: '청자', level: 'haeyo' } as never })),
      remove: (id) => unwrap(api['speech-rules'][':id'].$delete(param(id))),
    },
  };

  const characters = people.data?.characters ?? [];
  const shown = (row: Row) => matches(row, search.source, search.state);
  const pairs = useMemo(() => buildPairs(characters, specs.relationships.rows, specs.speechRules.rows), [characters, specs.relationships.rows, specs.speechRules.rows]);
  const visiblePairs = pairs.filter((pair) => pairMatches(pair, search.source, search.state));
  // A link may name a relationship or rule id; it opens the pair holding it.
  const pair = pairsView || graph ? pairs.find((candidate) => candidate.key === search.item || pairItems(candidate).some((item) => item.row.id === search.item)) : undefined;

  const tableKind: Kind = tab === 'people' ? 'characters' : tab;
  const spec = specs[tableKind];
  const rows = spec.rows.filter(shown);
  const selected = !pairsView ? spec.rows.find((row) => row.id === search.item) : undefined;
  const unofficial = (kind: Kind) => specs[kind].rows.filter((row) => !isSettled(row)).length;
  const unofficialHere = tab === 'people' ? unofficial('characters') + unofficial('relationships') + unofficial('speechRules') : unofficial(tab);
  useReportView('knowledge', [
    selected && { kind: KINDS[tableKind], id: selected.id, label: spec.label(selected), detail: !isSettled(selected) ? `${selected.status === 'candidate' ? '후보' : '확정'} · AI가 넣은 항목` : undefined },
    pair && { kind: '관계·말투', id: pair.key, label: `${pair.from} → ${pair.to}` },
  ]);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Picks belong to one list: leave it and they go.
  useEffect(() => setChecked(new Set()), [tab, search.display, search.view]);
  const pick = (ids: string[], on: boolean) =>
    setChecked((previous) => {
      const next = new Set(previous);
      for (const id of ids) if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const decide = useMutation({
    mutationFn: async ({ items, action }: { items: { kind: Kind; ids: string[] }[]; action: 'confirm' | 'discard' }) => {
      let changed = 0;
      for (const { kind, ids } of items) if (ids.length) changed += (await unwrap(api.drafts.$post({ param: { projectId }, json: { kind, ids, action } }))).changed;
      return changed;
    },
    onSuccess: (changed, { action }) => {
      setChecked(new Set());
      toast.success(action === 'confirm' ? `${changed}개를 정식으로 올렸습니다.` : `${changed}개 AI 항목을 버렸습니다.`);
    },
    onError: fail,
  });
  // Bulk actions over the checked rows (pairs expand to their relationship and rules).
  const checkedItems = (): { kind: Kind; ids: string[] }[] => {
    if (!pairsView) return [{ kind: tableKind, ids: rows.filter((row) => checked.has(row.id) && !isSettled(row)).map((row) => row.id) }];
    const items = visiblePairs.filter((candidate) => checked.has(candidate.key)).flatMap(pairItems).filter((item) => !isSettled(item.row));
    return (['relationships', 'speechRules'] as const).map((kind) => ({ kind, ids: items.filter((item) => item.kind === kind).map((item) => item.row.id) }));
  };
  const checkedCount = checkedItems().reduce((sum, item) => sum + item.ids.length, 0);

  const create = useMutation({
    mutationFn: () => spec.create!(),
    onSuccess: (row) => set({ item: row.id, source: undefined, state: undefined }),
    onError: fail,
  });
  // Pair-specific creation: a relationship between the pair's people, a speech rule for its names.
  const pairSpecs = (pair: Pair) => ({
    relationships: { ...specs.relationships, create: pair.fromId && pair.toId ? () => unwrap(api.relationships.$post({ param: { projectId }, json: { fromId: pair.fromId!, toId: pair.toId!, kind: '관계' } as never })) : undefined },
    speechRules: { ...specs.speechRules, create: () => unwrap(api['speech-rules'].$post({ param: { projectId }, json: { fromName: pair.from, toName: pair.to, level: 'haeyo' } as never })) },
  });
  const edges = useMemo(
    () =>
      visiblePairs
        .filter((candidate) => candidate.fromId && candidate.toId)
        .map((candidate) => ({ id: candidate.key, fromId: candidate.fromId!, toId: candidate.toId!, kind: candidate.relationship ? String(candidate.relationship.kind) : '', mutual: false, dashed: pairSummary(candidate).status === 'candidate' })),
    [visiblePairs],
  );

  const jobs = useQuery(q.analysisJobs(projectId));
  const analysed = hasAnalysis(jobs.data);
  const pending = tab === 'documents' ? documents.isPending : tab === 'events' ? storyEvents.isPending : people.isPending || rules.isPending;
  const filters = { source: search.source, status: search.state, onChange: (next: { source?: KnowledgeSource; status?: 'confirmed' | 'candidate' }) => set({ ...('source' in next && { source: next.source }), ...('status' in next && { state: next.status }), item: undefined }) };
  const filtered = Boolean(search.source || search.state);
  const bulk = <BulkDecide picked={checked.size} actionable={checkedCount} pending={decide.isPending} onConfirm={() => decide.mutate({ items: checkedItems(), action: 'confirm' })} onDiscard={() => decide.mutate({ items: checkedItems(), action: 'discard' })} />;
  const total = graph ? `인물 ${characters.length.toLocaleString()}명 · 관계 ${visiblePairs.length.toLocaleString()}쌍` : pairsView ? `${visiblePairs.length.toLocaleString()}쌍` : `${rows.length.toLocaleString()}${tab === 'people' ? '명' : '개'}`;
  const count = pending ? undefined : `${total}${unofficialHere > 0 ? ` · 확인 필요 ${unofficialHere.toLocaleString()}` : ''}`;
  const empty = filtered ? `조건에 맞는 ${KINDS[tableKind]} 항목이 없습니다.` : `${KINDS[tableKind]} 항목이 없습니다. “추가”로 직접 만들거나 “작품 분석”으로 초안을 받으세요.`;

  return (
    <Page title="자료" flush>
      <SplitPane
        id="knowledge"
        defaultWidth="440px"
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
              onClose={() => set({ item: undefined })}
              onDecide={(kind, ids, action) => decide.mutate({ items: [{ kind, ids }], action })}
            />
          ) : null
        }
      >
        <Toolbar
          count={count}
          actions={
            <>
              <StartAnalysis projectId={projectId} variant={analysed ? 'outline' : 'default'} />
              {!pairsView && (
                <Button variant={analysed ? 'default' : 'outline'} disabled={!spec.create || create.isPending} onClick={() => create.mutate()}>
                  <Plus /> 추가
                </Button>
              )}
            </>
          }
        >
          {tab === 'people' && (
            <ViewSwitch
              label="보기"
              value={graph ? 'graph' : 'table'}
              onChange={(value) => set({ display: value === 'table' ? 'table' : undefined, view: undefined, item: undefined }, false)}
              items={[
                { value: 'graph', label: '그래프', icon: <Network /> },
                { value: 'table', label: '표', icon: <Table2 /> },
              ]}
            />
          )}
          {tab === 'people' && !graph && (
            <ViewSwitch
              label="표 종류"
              value={search.view ?? 'pairs'}
              onChange={(value) => set({ view: value === 'characters' ? 'characters' : undefined, item: undefined }, false)}
              items={[
                { value: 'pairs', label: '관계', icon: <ArrowLeftRight /> },
                { value: 'characters', label: '인물', icon: <Users /> },
              ]}
            />
          )}
          {tab === 'events' && (
            <ViewSwitch
              label="보기"
              value={timeline ? 'timeline' : 'table'}
              onChange={(value) => set({ display: value === 'table' ? 'table' : undefined })}
              items={[
                { value: 'timeline', label: '흐름', icon: <GanttChart /> },
                { value: 'table', label: '표', icon: <Table2 /> },
              ]}
            />
          )}
          {(graph || timeline) && <KnowledgeFilters source={search.source} status={search.state} onChange={filters.onChange} />}
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            <JobStatus projectId={projectId} />
          </div>
        </Toolbar>
        {graph ? (
          <div className="min-h-0 flex-1">
            {people.isPending ? (
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
                events={rows.map((row) => ({ ...(row as unknown as FlowEvent), title: text(row.title), summary: text(row.summary), participants: row.participants as string[] }))}
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

/** A view switch (그래프 | 표, 흐름 | 표): the picture first, labelled in words. */
function ViewSwitch({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: { value: string; label: string; icon: ReactNode }[] }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(next) => next && onChange(next)} aria-label={label}>
      {items.map((item) => (
        <ToggleGroupItem key={item.value} value={item.value} className="gap-1.5 px-2.5">
          {item.icon}
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
