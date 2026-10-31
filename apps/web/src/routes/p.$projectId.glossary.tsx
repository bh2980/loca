import { useMemo, useState } from 'react';
import { AiConfirmNote } from '@/components/settings/ai-confirm';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, type ColumnDef, EmptyState, TagMenu, FilterChips, SearchField, FilterBar, ActionBar, type FilterChip, Button, Text, useRevealDock, ContextMenuItem, ContextMenuSeparator, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Spinner, SplitPane } from '@loca/ui';
import { HeaderFilter, MarkFilter, markTagGroups, togglePick, type FilterPick } from '@/components/header-filter';
import { NEW_TERM, NewTermPane, TermEditor, type Term } from '@/components/glossary/term-pane';
import { RunDialog } from '@/components/workflow/run-dialog';
import { HeaderActions, Page } from '@/components/page';
import { BulkDecide, matches, parseStatusFilter, parseDecidedBy, StateFilter, SourceBadge, StateCell, statusOptions, type StatusFilter, TagCell } from '@/components/knowledge/table';
import { AUTO_MARKS, markColor, markName, type AutoMark, isSettled, matchesMarks, parseMarks, TERM_MARK_IDS, termMarksOf, KNOWLEDGE_SOURCES, KNOWLEDGE_STATUS_LABELS, SOURCE_LABELS, type KnowledgeSource, aiDecided, DECIDED_BY_LABELS, type DecidedBy } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { q, tagsIn, useMarkStyles } from '@/lib/queries';
import { usePicked } from '@/lib/use-picked';
import { useReportView } from '@/lib/view-context';

export const Route = createFileRoute('/p/$projectId/glossary')({
  validateSearch: (raw: Record<string, unknown>): GlossarySearch => ({
    q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
    source: typeof raw.source === 'string' && (KNOWLEDGE_SOURCES as readonly string[]).includes(raw.source) ? (raw.source as KnowledgeSource) : undefined,
    status: parseStatusFilter(raw.status),
    decidedBy: parseDecidedBy(raw.decidedBy),
    emptyTarget: raw.emptyTarget === true || raw.emptyTarget === 'true' ? true : raw.emptyTarget === false || raw.emptyTarget === 'false' ? false : undefined,
    marks: parseMarks(raw.marks, TERM_MARK_IDS),
    term: typeof raw.term === 'string' && raw.term ? raw.term : undefined,
    ids: Array.isArray(raw.ids) && raw.ids.length && raw.ids.every((id) => typeof id === 'string') ? (raw.ids as string[]) : undefined,
    tags: Array.isArray(raw.tags) && raw.tags.length && raw.tags.every((id) => typeof id === 'string') ? (raw.tags as string[]) : undefined,
    hideMarks: parseMarks(raw.hideMarks, TERM_MARK_IDS),
    hideTags: Array.isArray(raw.hideTags) && raw.hideTags.length && raw.hideTags.every((id) => typeof id === 'string') ? (raw.hideTags as string[]) : undefined,
  }),
  component: Glossary,
});

interface GlossarySearch {
  q?: string;
  term?: string;
  source?: KnowledgeSource;
  /** 상태 filter (the status URL param): 후보 or 확정; rejected terms are never listed. */
  status?: StatusFilter;
  /** 정한 쪽: confirmed by AI (✦) or by a person. */
  decidedBy?: DecidedBy;
  /** 번역 비어 있음 (true) or 있음 (false). */
  emptyTarget?: boolean;
  /** Automatic marks (the marks URL param): terms carrying all of them. */
  marks?: AutoMark[];
  /** Tag ids: terms carrying all of them. */
  tags?: string[];
  /** 숨기기: terms carrying any of these marks or tags are left out. */
  hideMarks?: AutoMark[];
  hideTags?: string[];
  /** Only these terms (a run's scope, from the run dialog's readiness list); a removable chip, combined with the other filters. */
  ids?: string[];
}

function Glossary() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const terms = useQuery(q.terms(projectId));
  const { picked, pick, clear: clearPicked } = usePicked(`glossary.${projectId}`);
  const [runOpen, setRunOpen] = useState(false);
  const discover = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.discover.$post({ param: { projectId } })),
    onSuccess: ({ found, added, updated }) => {
      queryClient.invalidateQueries({ queryKey: q.terms(projectId).queryKey });
      toast.success(`대본에서 용어 후보 ${found.toLocaleString()}개를 찾았습니다 (추가 ${added}개, 갱신 ${updated}개).`);
    },
    onError: (error) => toast.error(error.message),
  });
  // Who wrote a term (출처) and who set its status (✦ when AI confirmed it and no person has looked yet).
  const asDraft = (term: Term) => ({ ...term, evidence: [] });
  const hidden = (term: Term) => termMarksOf(term).some((mark) => search.hideMarks?.includes(mark)) || Boolean(term.tags?.some((tag) => search.hideTags?.includes(tag.id)));
  const all = (terms.data ?? []).filter((term) => matches(asDraft(term), search.source, undefined, search.tags, search.status, search.decidedBy) && (search.emptyTarget === undefined || !term.target.trim() === search.emptyTarget) && matchesMarks(termMarksOf(term), search.marks) && !hidden(term));
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: ({ ids, accept }: { ids: string[]; accept: boolean }) => unwrap(client.projects[':projectId'].drafts.$post({ param: { projectId }, json: { kind: 'terms', ids, action: accept ? 'confirm' : 'discard' } })),
    // The table changes at once; the server's terms event brings the saved rows, and a failure puts them back.
    onMutate: async ({ ids, accept }) => {
      const key = q.terms(projectId).queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData(key);
      const picked = new Set(ids);
      // Discarded terms leave the list (the server does not send rejected ones); confirmed ones become official.
      queryClient.setQueryData(key, (list) => (accept ? list?.map((term) => (picked.has(term.id) ? { ...term, status: 'confirmed' as const, statusBy: 'human' as const } : term)) : list?.filter((term) => !picked.has(term.id))));
      return { before };
    },
    onSuccess: ({ changed }, { accept }) => toast.success(accept ? `${changed}개를 정식 용어로 올렸습니다.` : `${changed}개 후보를 버렸습니다.`),
    onError: (error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(q.terms(projectId).queryKey, context.before);
      toast.error(error.message);
    },
  });
  const needle = search.q?.toLowerCase();
  const scoped = search.ids ? all.filter((term) => search.ids!.includes(term.id)) : all;
  const filtered = needle ? scoped.filter((term) => [term.source, term.target, term.note].some((text) => text.toLowerCase().includes(needle))) : scoped;
  // Candidates first, the most frequent on top; settled terms follow by source.
  const rows = [...filtered].sort((a, b) => Number(isSettled(a)) - Number(isSettled(b)) || (!isSettled(a) ? (b.lines ?? -1) - (a.lines ?? -1) : 0));
  const creating = search.term === NEW_TERM;
  const selected = creating ? undefined : all.find((term) => term.id === search.term);
  const revealDock = useRevealDock();
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await unwrap(client.projects[':projectId'].terms[':id'].$delete({ param: { projectId, id } }));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: q.terms(projectId).queryKey });
      clearPicked();
      toast.success('용어를 삭제했습니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  useReportView('glossary-term', [selected && { kind: '용어', id: selected.id, label: `${selected.source} → ${selected.target}` }]);

  const select = (id?: string) => void navigate({ search: (previous) => ({ ...previous, term: id }), replace: true });
  const setFilter = (next: Partial<GlossarySearch>) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });
  const statuses = useQuery(q.statuses(projectId));
  const markStyles = useMarkStyles(projectId);
  const knownTags = tagsIn(statuses.data?.tags, 'terms');
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
    mutationFn: ({ ids, tagId, add }: { ids: string[]; tagId: string; add: boolean }) => unwrap(client.projects[':projectId']['knowledge-tags'].$post({ param: { projectId }, json: { kind: 'terms', ids, tagId, add } })),
    onError: (error) => toast.error(error.message),
  });

  // Picked undecided terms: a candidate without a Korean form cannot be confirmed (it would put an empty target in every prompt).
  const pickedTerms = useMemo(() => rows.filter((term) => picked.has(term.id)), [rows, picked]);
  const promotable = pickedTerms.filter((term) => !isSettled(term) && term.target.trim());
  const discardable = pickedTerms.filter((term) => !isSettled(term));
  const afterBulk = { onSuccess: clearPicked };
  // A run on terms takes the picked terms, else on what the filters leave; with neither, on the terms its own 대상 picks.
  const narrowed = Boolean(needle || search.ids || search.source || search.status || search.decidedBy || search.emptyTarget !== undefined || search.marks?.length || search.tags?.length || search.hideMarks?.length || search.hideTags?.length);
  const runTermIds = pickedTerms.length ? pickedTerms.map((term) => term.id) : narrowed ? rows.map((term) => term.id) : undefined;

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

  const columns: ColumnDef<Term, unknown>[] = [
    { id: 'source', header: '원문', meta: { hideable: false }, cell: ({ row }) => <Text weight="medium">{row.original.source}</Text> },
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
      meta: { width: 96, label: '출처' },
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
      cell: ({ row }) => <TagCell tags={row.original.tags} known={knownTags} marks={termMarksOf(row.original)} />,
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
          loading={terms.isLoading}
          empty={<EmptyState noun="용어" filtered={Boolean(needle || search.ids || search.source || search.status || search.marks?.length || search.tags?.length)} />}
          selected={selected?.id}
          onRowClick={(term) => select(term.id === search.term ? undefined : term.id)}
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
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>용어를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.label} 용어가 용어집에서 사라집니다. 이미 번역된 대사는 바뀌지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTarget) { remove.mutate(deleteTarget.ids); setDeleteTarget(null); } }}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

