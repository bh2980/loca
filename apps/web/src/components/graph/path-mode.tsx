import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { SeamCheckPane } from '@/components/graph/seam-check-pane';
import { PathGraph, type PathNodeText } from '@/components/graph/path-graph';
import { PathNodeExtras, PathNodePane, describeNode, forkChoices } from '@/components/graph/path-pane';
import { RouteList } from '@/components/graph/route-list';
import { loopTargets, resolveAt, stops } from '@/components/graph/path-window';
import { Page } from '@/components/page';
import { PaneHeader } from '@/components/pane-header';
import { SplitPane } from '@/components/split-pane';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';
import { keyLabel } from '@/lib/keys';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

/**
 * 길 따라 보기 (docs/DESIGN.md J2c): the slice of the dialogue graph for the stored choices, drawn
 * as its overview (sections between choices) a window at a time. `at` is the window's centre (an
 * overview node id) and `all` draws the whole overview. The main area is the route's translation list
 * (RouteList) with the graph as a narrow map beside it; the selected map node is the page's `node` (its
 * pane says its other choices and loops) and the picked line is `edit`.
 */
export function PathMode({ projectId, toggle, node, edit, at, all, onSelect, onEdit, onMove, onAll }: {
  projectId: string;
  /** The scope/view switch, shared with the other graph modes. */
  toggle: ReactNode;
  node?: string;
  edit?: string;
  at?: string;
  all: boolean;
  /** `focus`: the window moves to the clicked node too (and the list goes there). */
  onSelect: (nodeId: string | undefined, focus?: boolean) => void;
  onEdit: (unitId: string | undefined) => void;
  /** Like scrolling: replaces the history entry. */
  onMove: (nodeId: string) => void;
  /** Switching between the window and the whole overview is a history entry. */
  onAll: (all: boolean) => void;
}) {
  const route = useQuery(q.route(projectId));
  // The dialogue graph's node list carries every node's first line in one call (the whole graph, no layout needed).
  const graph = useQuery(q.graph(projectId, 'dialogue'));
  const texts = useMemo(() => new Map<string, PathNodeText>((graph.data?.nodes ?? []).map((item) => [item.id, { speaker: item.speaker, text: item.text }])), [graph.data]);
  const slice = route.data;
  const seamData = useQuery(q.seamChecks(projectId)).data;
  const checks = seamData?.checks;
  // 다음 길 (docs/DESIGN.md J2c): the route through the most untranslated lines, and the steps between routes.
  const next = useQuery(q.routeNext(projectId)).data;
  const round = slice?.round ?? 1;
  const nextRoute = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].route.next.$post({ param: { projectId }, json: { round } })),
    onSuccess: (done) => toast(`길 ${done.round}로 넘어갔습니다${next ? ` · 새 줄 ${next.newLines.toLocaleString()}줄` : ''}`),
    onError: (error) => toast.error(error.message),
  });
  const prevRoute = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].route.prev.$post({ param: { projectId }, json: { round } })),
    onSuccess: (done) => toast(`길 ${done.round}로 돌아갔습니다`),
    onError: (error) => toast.error(error.message),
  });
  const busy = nextRoute.isPending || prevRoute.isPending;
  const finished = !!next && next.newLines === 0;
  const stay = !!next && next.newLines > 0 && !next.changed;
  const nextLabel = finished ? '모든 길 번역함' : `다음 길${next && next.changed ? ` (+${next.newLines.toLocaleString()}줄)` : ''}`;
  const nextTitle = finished
    ? '번역하지 않은 줄이 있는 길이 더 없습니다.'
    : stay
      ? '이번 길에 번역하지 않은 줄이 남아 있습니다. 먼저 이번 길을 번역하세요.'
      : '번역하지 않은 줄을 가장 많이 지나는 길로 넘어갑니다(앞 길과 겹치는 부분이 가장 적도록).';

  const pick = useMutation({
    mutationFn: (body: { nodeId: string; armId: string | null }) => unwrap(client.projects[':projectId']['route-picks'].$put({ param: { projectId }, json: body })),
    onError: (error) => toast.error(error.message),
  });
  const reset = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['route-picks'].$delete({ param: { projectId } })),
    onError: (error) => toast.error(error.message),
  });
  const onPick = useCallback((nodeId: string, armId: string) => pick.mutate({ nodeId, armId }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const onAuto = useCallback((nodeId: string) => pick.mutate({ nodeId, armId: null }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const overviewById = useMemo(() => new Map((route.data?.overview.nodes ?? []).map((item) => [item.id, item] as const)), [route.data]);

  // A selection that the new slice no longer has (another arm was picked) is forgotten.
  const block = slice?.overview.nodes.find((item) => item.id === node);
  // 이음새 점검: a seam anchor opens its own pane instead of the lines' pane.
  const isSeam = !!block && block.kind === 'anchor' && !!block.seam;
  const isChoiceBlock = !!block && slice?.blocks.find((item) => item.id === block.id)?.kind === 'choice';
  useEffect(() => {
    if (slice && node && !block) onSelect(undefined);
  }, [slice, node, block]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = block && slice ? forkChoices(slice, block) : undefined;
  const loops = block && slice ? loopTargets(slice.overview, block.id).map((to) => describeNode(overviewById.get(to), texts)) : [];
  const extras = choices || loops.length ? <PathNodeExtras choices={choices} loops={loops} onPick={onPick} onAuto={onAuto} /> : undefined;
  const editUnit = useQuery({ ...q.unit(edit ?? ''), enabled: !!edit });
  useReportView('graph-line', [editUnit.data && { kind: '대사', id: editUnit.data.id, label: `${editUnit.data.key} · ${editUnit.data.source.slice(0, 40)}` }]);

  const first = useRef(performance.now());
  const ready = useCallback(() => {
    document.body.dataset.pathReady = String(Math.round(performance.now() - first.current));
  }, []);

  const here = slice && resolveAt(slice.overview, at);
  const around = slice && stops(slice.overview, here);
  const picks = Object.keys(route.data?.picks ?? {}).length;
  // 이음새 점검 (round 2 on): the seams of this route; 바뀜 are no longer counted as checked.
  const seamList = slice?.overview.nodes.filter((item) => item.kind === 'anchor' && item.seam) ?? [];
  const seamChecks = seamData?.seamChecks;
  const remaining = next ? (next.remainingRoutes === 0 ? '남은 길 없음' : `남은 길 약 ${next.remainingRoutes}`) : undefined;
  const summary = slice ? [`길 ${slice.round}`, `새 줄 ${slice.newLinesOnRoute.toLocaleString()}`, `번역 ${slice.translatedGraphLines.toLocaleString()}/${slice.graphLines.toLocaleString()}줄`, remaining].filter(Boolean).join(' · ') : undefined;
  const scope = slice ? `이번 길 ${slice.lines.toLocaleString()}줄 / 프로젝트 전체 ${slice.totalLines.toLocaleString()}줄 · 새 줄은 이번 길에서 아직 번역하지 않은 줄 · 번역은 대사 그래프에 있는 줄(${slice.graphLines.toLocaleString()}줄) 기준, 번역 글자가 있는 줄만 셉니다.` : undefined;
  const seamSummary = round >= 2 && seamChecks ? `이음새 점검 ${seamChecks.checked.toLocaleString()}/${seamChecks.total.toLocaleString()}${seamChecks.stale ? ` · 바뀜 ${seamChecks.stale.toLocaleString()}` : ''}` : undefined;
  // The next seam in script order after the window's place (wrapping round); only `at` moves.
  const nextSeam = (() => {
    const order = slice?.overview.nodes ?? [];
    const place = order.findIndex((item) => item.id === here);
    return seamList.find((item) => order.indexOf(item) > place) ?? seamList[0];
  })();
  const goSeam = () => (nextSeam && nextSeam.id !== here ? onMove(nextSeam.id) : toast('이 길의 이음새는 지금 보는 곳뿐입니다.'));
  const go = (target: string | undefined) => target && onMove(target);
  // ⌥↑/⌥↓ (Ctrl as well) move the window to the previous/next choice or join, unless a field has the keys.
  const goRef = useRef<{ previous?: string; next?: string }>({});
  goRef.current = { previous: around?.previous, next: around?.next };
  useEffect(() => {
    if (all) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.altKey || event.ctrlKey) || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const to = event.key === 'ArrowDown' ? goRef.current.next : goRef.current.previous;
      event.preventDefault();
      if (to) onMove(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page
      title="그래프"
      wideMeta
      meta={
        summary && (
          <span className="text-sm text-muted-foreground tabular-nums" title={[summary, scope, seamSummary].filter(Boolean).join(' · ')}>
            <span data-testid="path-summary">{summary}</span>
            {seamSummary && <span data-testid="seam-summary"> · {seamSummary}</span>}
          </span>
        )
      }
      actions={
        <div className="flex items-center gap-2">
          {slice && slice.overview.nodes.length > 0 && (
            <>
              <Button variant="outline" disabled={!slice.canGoBack || busy} title="바로 앞 길의 선택으로 되돌립니다" onClick={() => prevRoute.mutate()}>
                이전 길
              </Button>
              <Button disabled={!next || finished || stay || busy} title={nextTitle} onClick={() => nextRoute.mutate()}>
                {nextLabel}
              </Button>
              <Toggle variant="outline" size="sm" pressed={all} onPressedChange={onAll} title="창 없이 전체를 한 화면에 맞춥니다">
                전체 보기
              </Toggle>
              {round >= 2 && (
                <Button variant="ghost" disabled={!nextSeam} title="이 길의 다음 이음새로 이동 (끝이면 처음 이음새)" onClick={goSeam}>
                  다음 이음새
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" title="더보기">
                    <MoreHorizontal /> 더보기
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={all || !around?.previous} onSelect={() => go(around?.previous)}>
                    이전 갈림
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">{keyLabel('Alt+Up')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={all || !around?.next} onSelect={() => go(around?.next)}>
                    다음 갈림
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">{keyLabel('Alt+Down')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={picks === 0 || reset.isPending} onSelect={() => reset.mutate()}>
                    선택 초기화
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {toggle}
        </div>
      }
      flush
    >
      <SplitPane
        id="graph"
        defaultWidth="380px"
        className="absolute inset-0"
        pane={
          block && (
            <div className="h-full bg-background">
              {isSeam ? (
                <SeamCheckPane key={block.id} projectId={projectId} nodeId={block.id} onClose={() => onSelect(undefined)} />
              ) : (
              <PathNodePane
                key={block.id}
                title={block.kind === 'section' ? `구간 · ${block.unitIds.length.toLocaleString()}줄` : isChoiceBlock ? '선택지' : block.unitIds.length > 1 ? `이어진 대사 ${block.unitIds.length}줄` : block.unitIds.length ? '대사' : '이어짐'}
                subtitle={`이 노드의 줄 ${block.unitIds.length.toLocaleString()}줄`}
                extras={extras}
                onClose={() => onSelect(undefined)}
              />
              )}
            </div>
          )
        }
      >
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* The map: the path graph as a narrow column. A click goes there in the list; the list scrolling moves it. */}
          <div className="relative w-72 shrink-0 border-r bg-[radial-gradient(var(--graph-grid)_1px,transparent_1px)] [background-size:20px_20px]" data-testid="path-map">
            {slice && graph.data && slice.overview.nodes.length > 0 && (
              <PathGraph projectId={projectId} slice={slice} checks={checks} texts={texts} at={here} all={all} selectedId={node} folds={false} onSelect={(id) => onSelect(id, true)} onMove={onMove} onReady={ready} />
            )}
            {(route.isPending || graph.isPending) && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner /> 길을 계산하는 중…
              </div>
            )}
            {(route.isError || graph.isError) && <p className="p-6 text-sm text-destructive">길을 불러오지 못했습니다: {(route.error ?? graph.error)?.message}</p>}
          </div>
          <div className="relative min-w-0 flex-1">
            {slice && slice.overview.nodes.length > 0 && <RouteList projectId={projectId} slice={slice} checks={checks} at={here} edit={edit} onEdit={onEdit} onAt={onMove} />}
            {slice && !slice.overview.nodes.length && (
              <Empty className="absolute inset-0">
                <EmptyHeader>
                  <EmptyTitle>따라갈 길이 없습니다</EmptyTitle>
                  <EmptyDescription>대사 그래프가 없거나 대사가 있는 노드가 없습니다.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
      </SplitPane>
    </Page>
  );
}
