import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CircleStop, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { HeaderFilter, MarkFilter, markTagGroups } from '@/components/header-filter';
import { MarkChip, TagChip } from '@/components/status';
import { EmptyState } from '@/components/empty-state';
import { TagMenu } from '@/components/tag-menu';
import { FillDialog } from '@/components/glossary/fill-dialog';
import { NEW_TERM, NewTermPane, TermEditor, type Term } from '@/components/glossary/term-pane';
import { Page } from '@/components/page';
import { SplitPane } from '@/components/split-pane';
import { JobProgress } from '@/components/job-progress';
import { FilterChips, SearchInput, Toolbar, type FilterChip } from '@/components/toolbar';
import { Button } from '@/components/ui/button';
import { BulkDecide, matches, SourceBadge, TagCell } from '@/components/knowledge/table';
import { AUTO_MARKS, type AutoMark, isSettled, matchesMarks, parseMarks, TERM_MARK_IDS, termMarksOf, KNOWLEDGE_SOURCES, SOURCE_LABELS, type KnowledgeSource } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { q, tagsIn } from '@/lib/queries';
import { usePicked } from '@/lib/use-picked';
import { useReportView } from '@/lib/view-context';

export const Route = createFileRoute('/p/$projectId/glossary')({
  validateSearch: (raw: Record<string, unknown>): GlossarySearch => ({
    q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
    source: typeof raw.source === 'string' && (KNOWLEDGE_SOURCES as readonly string[]).includes(raw.source) ? (raw.source as KnowledgeSource) : undefined,
    marks: parseMarks(raw.marks, TERM_MARK_IDS),
    term: typeof raw.term === 'string' && raw.term ? raw.term : undefined,
    ids: Array.isArray(raw.ids) && raw.ids.length && raw.ids.every((id) => typeof id === 'string') ? (raw.ids as string[]) : undefined,
    tags: Array.isArray(raw.tags) && raw.tags.length && raw.tags.every((id) => typeof id === 'string') ? (raw.tags as string[]) : undefined,
  }),
  component: Glossary,
});

interface GlossarySearch {
  q?: string;
  term?: string;
  source?: KnowledgeSource;
  /** Automatic marks (the marks URL param): #후보 and #AI가 정함 together mean either, the rest all hold (see matchesMarks). */
  marks?: AutoMark[];
  /** Tag ids: terms carrying all of them. */
  tags?: string[];
  /** Only these terms (a run's scope, from the run dialog's readiness list); a removable chip, combined with the other filters. */
  ids?: string[];
}

function Glossary() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const terms = useQuery(q.terms(projectId));
  const { picked, pick, clear: clearPicked } = usePicked(`glossary.${projectId}`);
  const suggest = useQuery(q.termSuggest(projectId));
  const fill = suggest.data?.state;
  const cancelFill = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.suggest.cancel.$post({ param: { projectId } })),
    onError: (error) => toast.error(error.message),
  });
  const discover = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.discover.$post({ param: { projectId } })),
    onSuccess: ({ found, added, updated }) => {
      queryClient.invalidateQueries({ queryKey: q.terms(projectId).queryKey });
      toast.success(`대본에서 용어 후보 ${found.toLocaleString()}개를 찾았습니다 (추가 ${added}개, 갱신 ${updated}개).`);
    },
    onError: (error) => toast.error(error.message),
  });
  // A finished fill reports its error once; the muted text below stays until the next run.
  const reported = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (fill && !fill.running && fill.error && reported.current !== fill.error) {
      reported.current = fill.error;
      toast.error(fill.error);
    }
  }, [fill]);

  // Who wrote a term (출처) and who set its status (✦ when AI confirmed it and no person has looked yet).
  const asDraft = (term: Term) => ({ ...term, evidence: [] });
  const all = (terms.data ?? []).filter((term) => matches(asDraft(term), search.source, undefined, search.tags) && matchesMarks(termMarksOf(term), search.marks));
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
  useReportView('glossary-term', [selected && { kind: '용어', id: selected.id, label: `${selected.source} → ${selected.target}` }]);

  const select = (id?: string) => void navigate({ search: (previous) => ({ ...previous, term: id }), replace: true });
  const setFilter = (next: Partial<GlossarySearch>) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });
  const statuses = useQuery(q.statuses(projectId));
  const knownTags = tagsIn(statuses.data?.tags, 'terms');
  const pickedTags = search.tags ?? [];
  const toggleMark = (mark: AutoMark, on: boolean) => {
    const next = on ? [...new Set([...(search.marks ?? []), mark])] : (search.marks ?? []).filter((other) => other !== mark);
    setFilter({ marks: next.length ? next : undefined });
  };
  const toggleTag = (id: string, on: boolean) => {
    const next = on ? [...pickedTags, id] : pickedTags.filter((other) => other !== id);
    setFilter({ tags: next.length ? next : undefined });
  };
  const tag = useMutation({
    mutationFn: ({ ids, tagId, add }: { ids: string[]; tagId: string; add: boolean }) => unwrap(client.projects[':projectId']['knowledge-tags'].$post({ param: { projectId }, json: { kind: 'terms', ids, tagId, add } })),
    onError: (error) => toast.error(error.message),
  });

  // Picked undecided terms: a candidate without a Korean form cannot be confirmed (it would put an empty target in every prompt).
  const pickedTerms = rows.filter((term) => picked.has(term.id));
  const promotable = pickedTerms.filter((term) => !isSettled(term) && term.target.trim());
  const discardable = pickedTerms.filter((term) => !isSettled(term));
  const afterBulk = { onSuccess: clearPicked };

  const chips: FilterChip[] = [
    ...(search.ids ? [{ key: 'ids', label: `이번 실행 범위 ${search.ids.length}개`, clear: () => setFilter({ ids: undefined }) }] : []),
    ...(search.source ? [{ key: 'source', label: SOURCE_LABELS[search.source], clear: () => setFilter({ source: undefined }) }] : []),
    ...(search.marks ?? []).map((mark) => ({ key: `mark:${mark}`, label: <MarkChip mark={mark} />, name: AUTO_MARKS[mark].name, clear: () => toggleMark(mark, false) })),
    ...pickedTags.map((id) => {
      const known = knownTags.find((tag) => tag.id === id);
      return { key: `tag:${id}`, label: known ? <TagChip tag={known} /> : `#${id}`, name: `#${known?.name ?? id}`, clear: () => toggleTag(id, false) };
    }),
  ];

  const columns: ColumnDef<Term, unknown>[] = [
    { id: 'source', header: '원문', meta: { hideable: false }, cell: ({ row }) => <span className="font-medium">{row.original.source}</span> },
    { id: 'target', header: '번역', cell: ({ row }) => row.original.target || <span className="text-muted-foreground">—</span> },
    { id: 'lines', header: () => <span title="원문에 이 용어가 나오는 대사 수">나온 줄</span>, meta: { width: 72, align: 'end', label: '나온 줄' }, cell: ({ row }) => row.original.lines ?? <span className="text-muted-foreground">—</span> },
    { id: 'note', header: '메모', meta: { className: 'text-muted-foreground' }, cell: ({ row }) => row.original.note },
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
          groups={markTagGroups({ marks: TERM_MARK_IDS, picked: search.marks, onToggle: toggleMark, tags: knownTags, pickedTags, onToggleTag: toggleTag })}
          onClear={() => setFilter({ marks: undefined, tags: undefined })}
        />
      ),
      meta: { width: 150, label: '태그' },
      cell: ({ row }) => <TagCell tags={row.original.tags} known={knownTags} marks={termMarksOf(row.original)} />,
    },
  ];

  return (
    <Page title="용어집" flush>
      <SplitPane
        id="glossary"
        defaultWidth="380px"
        className="h-full"
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
        <Toolbar
          count={terms.data && `${rows.length.toLocaleString()}개${needle ? ` / 전체 ${all.length.toLocaleString()}개` : ''}`}
          actions={
            <>
              {fill?.running ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  <JobProgress done={fill.done} total={fill.total} running className="w-20" />
                  용어 번역 채우는 중 {fill.done.toLocaleString()}/{fill.total.toLocaleString()}
                  <Button variant="ghost" size="inline" disabled={cancelFill.isPending} onClick={() => cancelFill.mutate()}>
                    <CircleStop /> 중단
                  </Button>
                </span>
              ) : (
                <>
                  {fill && (fill.error ? <span className="text-xs text-muted-foreground">용어 번역 채우기 실패: {fill.error}</span> : fill.done > 0 && <span className="text-xs text-muted-foreground tabular-nums">{fill.done.toLocaleString()}개 채움</span>)}
                  {!!suggest.data?.pending && <FillDialog projectId={projectId} pending={suggest.data.pending} calls={suggest.data.calls} batch={suggest.data.batch} />}
                </>
              )}
              <Button variant="outline" disabled={discover.isPending} onClick={() => discover.mutate()}>
                <ScanSearch /> 대본에서 찾기
              </Button>
              <Button onClick={() => select(NEW_TERM)}>
                <Plus /> 용어 추가
              </Button>
            </>
          }
        >
          <SearchInput value={search.q} placeholder="원문·번역·메모 검색" onChange={(value) => void navigate({ search: (previous) => ({ ...previous, q: value }), replace: true })} />
          <FilterChips chips={chips} />
        </Toolbar>
        <DataTable
          id="glossary"
          columns={columns}
          rows={terms.data && rows}
          rowId={(term) => term.id}
          loading={terms.isLoading}
          empty={<EmptyState noun="용어" filtered={Boolean(needle || search.ids || search.source || search.marks?.length || search.tags?.length)} hint="‘대본에서 찾기’로 후보를 찾거나 ‘용어 추가’로 직접 넣으세요." />}
          selected={selected?.id}
          onRowClick={(term) => select(term.id === search.term ? undefined : term.id)}
          picked={picked}
          onPick={pick}
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
                tags={knownTags.filter((item) => !item.role)}
                heading={`고른 ${pickedTerms.length}개의 태그`}
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
    </Page>
  );
}

