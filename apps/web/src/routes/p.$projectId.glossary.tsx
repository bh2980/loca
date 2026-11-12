import { useMemo, useState } from 'react';
import { AiConfirmNote } from '@/components/settings/ai-confirm';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Plus, Play, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, type ColumnDef, EmptyState, TagMenu, FilterChips, SearchField, FilterBar, ActionBar, type FilterChip, Button, Text, useRevealDock, ContextMenuItem, ContextMenuSeparator, Spinner, SplitPane, ConfirmDialog } from '@loca/ui';
import { HeaderFilter, MarkFilter, markTagGroups, togglePick, type FilterPick } from '@/components/header-filter';
import { NEW_TERM, NewTermPane, TermEditor } from '@/components/glossary/term-pane';
import { RunDialog } from '@/components/workflow/run-dialog';
import { HeaderActions, Page } from '@/components/page';
import { AiNamed, BulkDecide, itemFilterParams, StateFilter, SourceBadge, StateCell, TagCell } from '@/components/knowledge/table';
import { param, searchParams, type SearchOf } from '@/lib/search';
import { markColor, markName, type AutoMark, isSettled, parseMarks, TERM_MARK_IDS, termMarksOf, KNOWLEDGE_SOURCES, KNOWLEDGE_STATUS_LABELS, SOURCE_LABELS, type KnowledgeSource, aiDecided, DECIDED_BY_LABELS, type DecidedBy, termMatches, type TermFilter } from '@tw/shared';
import { tagsIn, useMarkStyles } from '@/lib/queries';
import { useListScreen } from '@/lib/list-screen';
import { useTerms, withDuplicate, type Term, discoverTerms, deleteTerm, tagTerms } from '@/lib/terms';
import { decideItems, useTaxonomy } from '@/lib/knowledge';

const glossarySearchParams = {
  /** The open inspector's tab (lib/inspector-tab.ts). */
  pane: param.text,
  q: param.text,
  term: param.text,
  ...itemFilterParams(TERM_MARK_IDS),
  /** 번역 비어 있음 (true) or 있음 (false). */
  emptyTarget: param.bool,
};
type GlossarySearch = SearchOf<typeof glossarySearchParams>;

export const Route = createFileRoute('/p/$projectId/glossary')({
  validateSearch: searchParams(glossarySearchParams),
  component: Glossary,
});

function Glossary() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const terms = useTerms(projectId);
  const [runOpen, setRunOpen] = useState(false);
  const discover = useMutation({
    mutationFn: () => discoverTerms(projectId),
    // The found terms come with the row feed.
    onSuccess: ({ found, added, updated }) => {
      toast.success(`대본에서 용어 후보 ${found.toLocaleString()}개를 찾았습니다 (추가 ${added}개, 갱신 ${updated}개).`);
    },
    onError: (error) => toast.error(error.message),
  });
  // Who wrote a term (출처) and who set its status (✦ when AI confirmed it and no person has looked yet).
  const asDraft = (term: Term) => ({ ...term, evidence: [] });
  const marksOf = (term: Term) => termMarksOf(withDuplicate(term, terms.duplicates));
  // The glossary's filters, the same ones loca terms and the chat's list_terms use (termMatches).
  const filter: TermFilter = { source: search.source, status: search.status && [search.status], decidedBy: search.decidedBy, emptyTarget: search.emptyTarget, marks: search.marks, hideMarks: search.hideMarks, tags: search.tags, hideTags: search.hideTags };
  const all = (terms.data ?? []).filter((term) => termMatches(term, filter, terms.duplicates.has(term)));
  // The table changes at once (decideItems); the feed brings the saved rows, and a failure puts them back.
  const decide = useMutation({
    mutationFn: ({ ids, accept }: { ids: string[]; accept: boolean }) => decideItems(projectId, [{ kind: 'terms', ids }], accept ? 'confirm' : 'discard'),
    onSuccess: (changed, { accept }) => toast.success(accept ? `${changed}개를 정식 용어로 올렸습니다.` : `${changed}개 후보를 버렸습니다.`),
    onError: (error) => toast.error(error.message),
  });
  const needle = search.q?.toLowerCase();
  const filtered = needle || search.ids ? all.filter((term) => termMatches(term, { text: search.q, ids: search.ids })) : all;
  // Candidates first, the most frequent on top; settled terms follow by source.
  const rows = [...filtered].sort((a, b) => Number(isSettled(a)) - Number(isSettled(b)) || (!isSettled(a) ? (b.lines ?? -1) - (a.lines ?? -1) : 0));
  const creating = search.term === NEW_TERM;
  const selected = creating ? undefined : all.find((term) => term.id === search.term);
  const { setSearch: setFilter, open: select, toggle, picked, pick, clearPicked } = useListScreen({
    search,
    navigate,
    selection: 'term',
    picks: `glossary.${projectId}`,
    report: ['glossary-term', [selected && { kind: '용어', id: selected.id, label: `${selected.source} → ${selected.target}` }]],
  });
  const revealDock = useRevealDock();
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await deleteTerm(projectId, id);
      }
    },
    onSuccess: () => {
      clearPicked();
      toast.success('용어를 삭제했습니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  const taxonomy = useTaxonomy(projectId);
  const markStyles = useMarkStyles(projectId);
  const knownTags = tagsIn(taxonomy.tags, 'terms');
  const pickedTags = search.tags ?? [];
  const pickMark = (mark: AutoMark, mode: FilterPick) => {
    const next = togglePick(search.marks, search.hideMarks, mark, mode);
    setFilter({ marks: next.show, hideMarks: next.hide });
  };
  const pickTag = (id: string, mode: FilterPick) => {
    const next = togglePick(search.tags, search.hideTags, id, mode);
    setFilter({ tags: next.show, hideTags: next.hide });
  };
  const tag = useMutation({
    mutationFn: ({ ids, tagId, add }: { ids: string[]; tagId: string; add: boolean }) => tagTerms(projectId, ids, tagId, add),
    onError: (error) => toast.error(error.message),
  });

  // Picked undecided terms: a candidate without a Korean form cannot be confirmed (it would put an empty target in every prompt).
  const pickedTerms = useMemo(() => rows.filter((term) => picked.has(term.id)), [rows, picked]);
  const promotable = pickedTerms.filter((term) => !isSettled(term) && term.target.trim());
  const discardable = pickedTerms.filter((term) => !isSettled(term));
  const afterBulk = { onSuccess: clearPicked };
  const chips: FilterChip[] = [
    ...(search.ids ? [{ key: 'ids', label: `실행 범위 ${search.ids.length}`, clear: () => setFilter({ ids: undefined }) }] : []),
    ...(search.status ? [{ key: 'status', label: KNOWLEDGE_STATUS_LABELS[search.status], clear: () => setFilter({ status: undefined }) }] : []),
    ...(search.decidedBy ? [{ key: 'decidedBy', label: `정한 쪽: ${DECIDED_BY_LABELS[search.decidedBy]}`, clear: () => setFilter({ decidedBy: undefined }) }] : []),
    ...(search.emptyTarget !== undefined ? [{ key: 'emptyTarget', label: search.emptyTarget ? '번역: 비어 있음' : '번역: 있음', clear: () => setFilter({ emptyTarget: undefined }) }] : []),
    ...(search.source ? [{ key: 'source', label: SOURCE_LABELS[search.source], clear: () => setFilter({ source: undefined }) }] : []),
    ...(search.marks ?? []).map((mark) => ({ key: `mark:${mark}`, label: `#${markName(mark, markStyles)}`, color: markColor(mark, markStyles), clear: () => pickMark(mark, 'show') })),
    ...(search.hideMarks ?? []).map((mark) => ({ key: `hide-mark:${mark}`, label: `#${markName(mark, markStyles)}`, color: markColor(mark, markStyles), hidden: true, clear: () => pickMark(mark, 'hide') })),
    ...pickedTags.map((id) => {
      const known = knownTags.find((tag) => tag.id === id);
      return { key: `tag:${id}`, label: `#${known?.name ?? id}`, color: known?.color, clear: () => pickTag(id, 'show') };
    }),
    ...(search.hideTags ?? []).map((id) => {
      const known = knownTags.find((tag) => tag.id === id);
      return { key: `hide-tag:${id}`, label: `#${known?.name ?? id}`, color: known?.color, hidden: true, clear: () => pickTag(id, 'hide') };
    }),
  ];
  // Every filter shows as a chip, so the chips (and the search box) say whether the list is narrowed: the empty state and the run's scope read this one answer.
  const narrowed = Boolean(needle) || chips.length > 0;
  // A run on terms takes the picked terms, else on what the filters leave; with neither, on the terms its own 대상 picks.
  const runTermIds = pickedTerms.length ? pickedTerms.map((term) => term.id) : narrowed ? rows.map((term) => term.id) : undefined;

  const columns: ColumnDef<Term, unknown>[] = [
    { id: 'source', header: '원문', meta: { hideable: false }, cell: ({ row }) => <Text weight="medium"><AiNamed row={row.original}>{row.original.source}</AiNamed></Text> },
    {
      id: 'target',
      header: () => <HeaderFilter label="번역" value={search.emptyTarget === undefined ? undefined : search.emptyTarget ? 'empty' : 'filled'} options={[{ value: 'empty', label: '비어 있음' }, { value: 'filled', label: '있음' }]} onChange={(value) => setFilter({ emptyTarget: value === undefined ? undefined : value === 'empty' })} />,
      meta: { label: '번역' },
      cell: ({ row }) => row.original.target || <Text tone="muted">—</Text>,
    },
    { id: 'lines', header: "등장", meta: { width: 72 }, cell: ({ row }) => row.original.lines ?? <Text tone="muted">—</Text> },
    { id: 'note', header: '메모', meta: { tone: 'muted' }, cell: ({ row }) => row.original.note },
    {
      id: 'state',
      header: () => <StateFilter status={search.status} decidedBy={search.decidedBy} onChange={setFilter} />,
      meta: { width: 80, label: '상태' },
      cell: ({ row }) => <StateCell row={asDraft(row.original)} />,
    },
    {
      id: 'origin',
      header: () => (
        <HeaderFilter label="출처" value={search.source} options={KNOWLEDGE_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }))} onChange={(source) => setFilter({ source: source as KnowledgeSource | undefined })} />
      ),
      meta: { width: 96, label: '출처', hiddenByDefault: true },
      cell: ({ row }) => <SourceBadge row={asDraft(row.original)} />,
    },
    {
      id: 'tags',
      header: () => (
        <MarkFilter
          label="태그"
          groups={markTagGroups({ marks: TERM_MARK_IDS, picked: search.marks, hidden: search.hideMarks, onMark: pickMark, tags: knownTags, pickedTags, hiddenTags: search.hideTags, onTag: pickTag })}
          onClear={() => setFilter({ marks: undefined, tags: undefined, hideMarks: undefined, hideTags: undefined })}
        />
      ),
      meta: { width: 150, label: '태그' },
      cell: ({ row }) => <TagCell tags={row.original.tags} known={knownTags} marks={marksOf(row.original)} />,
    },
  ];

  return (
    <Page title="용어집" flush>
      <SplitPane fill="height"
        id="glossary" selectionKey={creating ? "new" : selected?.id}
        defaultWidth="380px"
        pane={
          creating ? (
            <NewTermPane key="new" projectId={projectId} onClose={() => select(undefined)} onCreated={(id) => select(id)} />
          ) : (
            selected && (
              <TermEditor
                key={selected.id}
                projectId={projectId}
                term={selected}
                onClose={() => select(undefined)}
                onDecide={(accept) => decide.mutate({ ids: [selected.id], accept }, { onSuccess: () => !accept && select(undefined) })}
                deciding={decide.isPending}
              />
            )
          )
        }
      >
        <HeaderActions>
          <Button onClick={() => select(NEW_TERM)}><Plus /> 용어</Button>
          <ActionBar aria-label="용어집 동작" items={[
            {
              id: 'discover',
              label: '대본에서 찾기',
              icon: discover.isPending ? <Spinner /> : <ScanSearch />,
              disabled: discover.isPending,
              priority: 10,
              overflow: 'never',
              onSelect: () => discover.mutate(),
            },
            {
              id: 'run',
              label: pickedTerms.length ? `선택 ${pickedTerms.length}개로 워크플로 실행` : narrowed ? '보이는 용어로 워크플로 실행' : '워크플로 실행',
              icon: <Play />,
              priority: 9,
              onSelect: () => setRunOpen(true),
            },
          ]} />
        </HeaderActions>
        <RunDialog projectId={projectId} subject="terms" termIds={runTermIds} hideTrigger open={runOpen} onOpenChange={setRunOpen} />
        <FilterBar end={terms.data && <><AiConfirmNote projectId={projectId} /><Text variant="micro" weight="medium" tone="subtle" tabular>{rows.length.toLocaleString()}개{needle ? ` / 전체 ${all.length.toLocaleString()}개` : ''}</Text></>}>
          <SearchField value={search.q} placeholder="원문·번역·메모 검색" onChange={(value) => void navigate({ search: (previous) => ({ ...previous, q: value }), replace: true })} />
          <FilterChips chips={chips} />
        </FilterBar>
        <DataTable
          id="glossary"
          columns={columns}
          rows={terms.data && rows}
          rowId={(term) => term.id}
          // The cells read their term, the project's tags and the term's #번역어 중복: a row is drawn again only when one of these changed.
          rowDeps={[taxonomy.tags]}
          rowKey={(term) => terms.duplicates.has(term)}
          loading={terms.isLoading}
          empty={<EmptyState noun="용어" filtered={narrowed} />}
          selected={selected?.id}
          onRowClick={(term) => toggle(term.id)}
          picked={picked}
          onPick={pick}
          rowContextMenu={(row) => {
            const isMulti = picked.has(row.id) && picked.size > 1;
            const targetIds = isMulti ? [...picked] : [row.id];
            const targetCount = targetIds.length;
            const isCandidateOrAi = aiDecided(row) || row.status === 'candidate';
            const hasTarget = Boolean(row.target.trim());

            return (
              <>
                <ContextMenuItem onClick={() => { select(row.id); revealDock?.(); }}>
                  상세
                </ContextMenuItem>
                {isCandidateOrAi && (
                  <ContextMenuItem
                    disabled={!hasTarget && !isMulti}
                    onClick={() => decide.mutate({ ids: isMulti ? promotable.map((t) => t.id) : [row.id], accept: true }, afterBulk)}
                  >
                    {isMulti ? `${targetCount}개 확정` : '확정'}
                  </ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => { void navigator.clipboard.writeText(row.source); toast.success('원문을 복사했습니다.'); }}>
                  원문 복사
                </ContextMenuItem>
                {hasTarget && (
                  <ContextMenuItem onClick={() => { void navigator.clipboard.writeText(row.target); toast.success('번역어를 복사했습니다.'); }}>
                    번역 복사
                  </ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { q: row.source } })}>
                  대사 보기
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => decide.mutate({ ids: targetIds, accept: false }, afterBulk)}
                >
                  {isMulti ? `${targetCount}개 거절` : "거절"}
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => setDeleteTarget(isMulti ? { ids: targetIds, label: `${targetCount}개` } : { ids: [row.id], label: `“${row.source}”` })}
                >
                  {isMulti ? `${targetCount}개 삭제` : '삭제'}
                </ContextMenuItem>
              </>
            );
          }}
          bulk={
            <>
              {/* A candidate without a Korean form cannot be confirmed (it would put an empty target in every prompt). */}
              <BulkDecide
                picked={pickedTerms.length}
                actionable={discardable.map(asDraft)}
                confirmable={promotable.map(asDraft)}
                pending={decide.isPending}
                confirmTitle={promotable.length < discardable.length ? '번역이 빈 후보는 번역을 채운 뒤 확정할 수 있습니다.' : undefined}
                onConfirm={() => decide.mutate({ ids: promotable.map((term) => term.id), accept: true }, afterBulk)}
                onDiscard={() => decide.mutate({ ids: discardable.map((term) => term.id), accept: false }, afterBulk)}
              />
              <TagMenu
                tags={knownTags}
                heading="태그"
                state={(tagId) => {
                  const on = pickedTerms.filter((term) => term.tags?.some((item) => item.id === tagId)).length;
                  return on === 0 ? 'none' : on === pickedTerms.length ? 'all' : 'some';
                }}
                onToggle={(tagId, add) => tag.mutate({ ids: pickedTerms.map((term) => term.id), tagId, add })}
              />
            </>
          }
        />
      </SplitPane>
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="용어를 삭제할까요?"
        description={`${deleteTarget?.label} 용어가 용어집에서 사라집니다. 이미 번역된 대사는 바뀌지 않습니다.`}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.ids)}
      />
    </Page>
  );
}

