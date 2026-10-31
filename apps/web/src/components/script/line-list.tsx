import { useEffect, useMemo, useRef, useState, type ReactNode, useEffectEvent, memo, useLayoutEffect, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { LineDetail } from '@/components/line-detail';
import { useRevealDock, EditorToolbar, FilterChips, Pager, FilterBar, ActionBar, Button, Box, Inline, Text, SearchField, Skeleton, EmptyState, SplitPane } from '@loca/ui';
import { HeaderActions } from '@/components/page';
import { tokenPatternOf } from '@/lib/line-context';
import { RunDialog } from '@/components/workflow/run-dialog';
import { lineTags, q, useMarkStyles } from '@/lib/queries';
import { markColor, type LineMark } from '@tw/shared';
import { hasLineFilter, LineFilters, filterChips, lineQueryParams, type LinesSearch } from '@/components/script/line-filters';
import { LineHeadRow, useLineBulk } from '@/components/script/line-bulk';
import { LineRow } from '@/components/script/line-row';
import { sceneSelectionState } from '@/components/script/scene-selection';

export { filterChips, isFinding, linesSearchSchema, type LinesSearch } from '@/components/script/line-filters';

const PAGE_SIZE = 100;

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The translation screen's lines: source on the left, translation on the right, in script order.
 * Only the picked line opens up — its editor and a short row of hints (speech rule, terms, format,
 * what the last run flagged). Tags stay below the translation in both modes. Other details (listener, candidates, AI context, history)
 * lives in the details pane, opened on demand. Keyboard: ↑↓ moves, ↵ edits, ⌘↵ confirms and goes on.
 */
const NO_ROWS: never[] = [];

type RowLine = ComponentProps<typeof LineRow>['line'];
/** What a row can ask of its list; one object for every row, made once. */
interface RowActions {
  pick: (ids: string[], on: boolean) => void;
  select: (id: string) => void;
  openDetail: (id: string) => void;
  openScene: (groupId: string, lineId: string) => void;
  editSource: (line: RowLine) => void;
  addLine: (line: RowLine) => void;
  showInGraph: (line: RowLine) => void;
  arrivedEnd: () => void;
  noting: (noting: boolean) => void;
  escape: () => void;
  done: (id: string, advanced: boolean) => void;
  filterTag: (tagId: string) => void;
  filterMark: (mark: LineMark) => void;
  filterAi: () => void;
}

/**
 * One line of the list. Memoized: when the URL or the selection changes, only the rows whose own
 * props changed (the line itself, the picked one, the one left) render again.
 */
const LineItem = memo(function LineItem({ actions, line, sceneLines, sceneChecked, matchesReady, withSceneLink, withLineActions, ...row }: Omit<ComponentProps<typeof LineRow>, `on${string}` | 'sceneSelection'> & {
  actions: RowActions;
  /** The first row of a scene in a list of many: the scene's matching lines (its checkbox picks them all). */
  sceneLines: readonly { id: string }[] | undefined;
  sceneChecked: boolean | 'indeterminate';
  matchesReady: boolean;
  withSceneLink: boolean;
  withLineActions: boolean;
}) {
  return (
    <LineRow
      {...row}
      line={line}
      sceneSelection={sceneLines ? { checked: sceneChecked, disabled: !matchesReady || !sceneLines.length, count: matchesReady ? `${sceneLines.length.toLocaleString()}줄` : undefined, onChange: (on) => actions.pick(sceneLines.map((item) => item.id), on) } : undefined}
      onPick={(on) => actions.pick([line.id], on)}
      onSelect={() => actions.select(line.id)}
      onOpenDetail={() => actions.openDetail(line.id)}
      onOpenScene={withSceneLink ? actions.openScene : undefined}
      onEditSource={withLineActions ? () => actions.editSource(line) : undefined}
      onAddLine={withLineActions ? () => actions.addLine(line) : undefined}
      onShowInGraph={withLineActions && line.kind === 'dialogue' ? () => actions.showInGraph(line) : undefined}
      onArrivedEnd={actions.arrivedEnd}
      onNoting={actions.noting}
      onEscape={actions.escape}
      onDone={(advanced) => actions.done(line.id, advanced)}
      onFilterTag={actions.filterTag}
      onFilterMark={actions.filterMark}
      onFilterAi={actions.filterAi}
    />
  );
});

export function LineList({
  projectId,
  groupId,
  section,
  review,
  kind,
  displayKind,
  search,
  onSearch,
  runGroupIds,
  runKind,
  onOpenScene,
  find,
  banner,
  dockEditor,
  dockSelectionKey,
  emptyAction,
  lineActions,
  withSpeakers = true,
}: {
  projectId: string;
  groupId?: string;
  section?: string;
  review?: boolean;
  kind?: 'scene' | 'document' | 'ui';
  /** Active source kind even when a selected group narrows the query and `kind` is unset. */
  displayKind?: 'scene' | 'document' | 'ui';
  search: LinesSearch;
  onSearch: (next: Partial<LinesSearch>, options?: { replace?: boolean }) => void;
  /** What 'AI 실행' runs when no line is picked (the open scene; none = the whole list's scope). */
  runGroupIds?: string[];
  /** The script view (대사 · UI · 문서) the list shows, for 'AI 실행' to start from that kind's lines. */
  runKind?: 'scene' | 'ui' | 'document';
  /** Opens a line in its own scene, without this list's filters. */
  onOpenScene?: (groupId: string, lineId: string) => void;
  /** A line's right-click: its source in the editor, a new line in its scene, its scene in the graph. */
  lineActions?: { editSource: (line: { id: string; groupId: string; groupKind: 'scene' | 'ui' | 'document' }) => void; addLine: (line: { id: string; groupId: string; groupKind: 'scene' | 'ui' | 'document' }) => void; showInGraph: (line: { groupId: string }) => void };
  /** Walking a filter inside this scene: every line shows, the matching ones are marked. */
  find?: { ids: Set<string>; label: string };
  /** Shown between the toolbar and the lines (the find bar). */
  banner?: ReactNode;
  /** An alternate right dock view such as the source editor, selected from the script header. */
  dockEditor?: ReactNode;
  dockSelectionKey?: string;
  emptyAction?: ReactNode;
  withSpeakers?: boolean;
}) {
  const statuses = useQuery(q.statuses(projectId));
  const markStyles = useMarkStyles(projectId);
  // Format tokens read as numbered chips (#1) in every row; the full token is on hover.
  const projectInfo = useQuery(q.project(projectId));
  const tokenPattern = useMemo(() => tokenPatternOf(projectInfo.data?.formatRules ?? undefined), [projectInfo.data?.formatRules]);
  // Writing a note on the picked line (closed when another line is picked).
  const [noting, setNoting] = useState(false);
  useEffect(() => setNoting(false), [search.line]);
  const page = search.page ?? 0;
  // Lines picked here (click, keys); any other line in the URL arrived from elsewhere (a link).
  const pickedHere = useRef<string | undefined>(undefined);
  // A line that arrives from a link may sit on any page: the server opens the page that holds it,
  // then the URL takes that page (replace), so paging and Back keep working from there.
  const [focusing, setFocusing] = useState<string | undefined>(() => search.line);
  useEffect(() => {
    if (search.line && search.line !== pickedHere.current) setFocusing(search.line);
  }, [search.line]);
  const lines = useQuery(
    q.units(
      projectId,
      find
        ? { groupId, focus: focusing, offset: page * PAGE_SIZE, limit: PAGE_SIZE }
        : { groupId, section, kind, review: review ? '1' : undefined, ...lineQueryParams(search), focus: focusing, offset: page * PAGE_SIZE, limit: PAGE_SIZE },
    ),
  );
  // Scene checkboxes operate on the entire filtered result, not just this page. Keep the
  // projection in sync with the visible rows while the list is showing previous-filter data.
  const showScene = !groupId;
  const matchesQuery = q.unitMatches(projectId, {
    groupId,
    section,
    kind,
    review: review ? '1' : undefined,
    ...lineQueryParams(search),
  });
  const matches = useQuery({ ...matchesQuery, enabled: showScene });
  useEffect(() => {
    if (!focusing || !lines.data || lines.isPlaceholderData) return;
    const held = Math.floor(lines.data.offset / PAGE_SIZE);
    setFocusing(undefined);
    if (held !== page) onSearch({ page: held || undefined }, { replace: true });
  }, [focusing, lines.data, lines.isPlaceholderData]); // eslint-disable-line react-hooks/exhaustive-deps
  const statusList = useMemo(() => statuses.data?.statuses ?? [], [statuses.data]);
  const statusById = new Map(statusList.map((status) => [status.id, status]));
  const tagById = new Map(statuses.data?.tags.map((tag) => [tag.id, tag]));
  const rows = lines.data?.rows;
  const total = lines.data?.total ?? 0;
  const matchesReady = !lines.isPlaceholderData && !matches.isPending && !matches.isError && matches.data !== undefined;
  // One empty list while matches load, not a new one each render (the bulk picks compare it).
  const matchRows = matchesReady ? matches.data.rows : NO_ROWS;
  const matchingByScene = useMemo(() => {
    const grouped = new Map<string, typeof matchRows>();
    for (const row of matchRows) {
      const group = grouped.get(row.groupId);
      if (group) group.push(row);
      else grouped.set(row.groupId, [row]);
    }
    return grouped;
  }, [matchRows]);
  const emptyNoun = review ? '검토할 대사' : (displayKind ?? kind) === 'ui' ? 'UI 문자열' : (displayKind ?? kind) === 'document' ? '문서' : '대사';
  const groupNoun = (displayKind ?? kind) === 'ui' ? 'UI 묶음' : (displayKind ?? kind) === 'document' ? '문서 묶음' : (displayKind ?? kind) === 'scene' ? '장면' : '묶음';
  const speakers = useQuery(q.speakers(projectId));
  const listeners = useQuery(q.listeners(projectId));
  // Bumped whenever the picked line's editor should take the focus; 0 = just looking.
  const [focusTick, setFocusTick] = useState(0);
  const setEditing = (edit: boolean) => setFocusTick((tick) => (edit ? tick + 1 : 0));

  // Lines picked by their checkboxes; the head row above the lines acts on them.
  const bulk = useLineBulk({ projectId, pickKey: review ? 'review' : (groupId ?? (kind ? `all.${kind}` : 'all')), rows, selectionRows: matchRows, tagName: (tagId) => tagById.get(tagId)?.name, aiOnly: search.decidedBy === 'ai' });
  const { picked, pick } = bulk;
  // Moving past the end of a page opens the next page and lands on its first (or last) line.
  const landing = useRef<'first' | 'last' | null>(null);
  useEffect(() => {
    if (!landing.current || !rows?.length || lines.isPlaceholderData) return;
    const target = landing.current === 'first' ? rows[0] : rows.at(-1)!;
    landing.current = null;
    pickedHere.current = target.id;
    onSearch({ line: target.id }, { replace: true });
  }, [rows, lines.isPlaceholderData, onSearch]);

  const revealDock = useRevealDock();
  const select = (id: string | undefined, edit: boolean) => {
    pickedHere.current = id;
    setEditing(edit);
    onSearch({ line: id }, { replace: true });
  };
  const move = (step: 1 | -1, edit = false) => {
    if (!rows?.length) return;
    const index = rows.findIndex((row) => row.id === search.line);
    const next = index < 0 ? (step > 0 ? 0 : rows.length - 1) : index + step;
    if (next >= 0 && next < rows.length) return select(rows[next].id, edit);
    const pages = Math.ceil(total / PAGE_SIZE);
    if (step > 0 && page + 1 < pages) {
      landing.current = 'first';
      setEditing(edit);
      onSearch({ page: page + 1, line: undefined });
    } else if (step < 0 && page > 0) {
      landing.current = 'last';
      setEditing(edit);
      onSearch({ page: page - 1 || undefined, line: undefined });
    }
  };
  // After ⌘↵ the line may leave the list (검토함, 최종 아님, 정한 쪽 AI); the next line is the one after it as it was.
  const advanceFrom = (id: string) => {
    if (!rows) return;
    const index = rows.findIndex((row) => row.id === id);
    const shrinking = review || search.unfinished === true || search.decidedBy === 'ai';
    if (index >= 0 && index + 1 < rows.length) select(rows[index + 1].id, true);
    else if (shrinking && index > 0 && page + 1 >= Math.ceil(total / PAGE_SIZE)) select(rows[index - 1].id, true);
    else move(1, true);
  };

  // Reads the latest list and selection when a key comes (an effect event, so the listener is added once).
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
    const inField = typing(event.target);
    // While a filter is walked, ⌥↑↓ go to the previous/next match (the script page handles them).
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.altKey && find) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (event.altKey || !inField)) {
      if (!inField && document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1, inField);
    } else if (event.key === 'Enter' && !inField && search.line && !document.querySelector('[role="dialog"]')) {
      event.preventDefault();
      setEditing(true);
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const selectedRow = useRef<HTMLLIElement>(null);
  // A line opened from a link (glossary example, search, evidence) is brought to the middle and
  // flashes once, so it is found at a glance; lines moved to here only scroll as far as needed.
  const [arrived, setArrived] = useState<string>();
  // The rows' handlers never change (so a row whose line did not change skips rendering); each calls this
  // list's latest logic, kept after every render.
  const latest = useRef({ select, advanceFrom, pick, onSearch, revealDock, onOpenScene, lineActions, setEditing });
  useLayoutEffect(() => {
    latest.current = { select, advanceFrom, pick, onSearch, revealDock, onOpenScene, lineActions, setEditing };
  });
  const rowActions = useMemo<RowActions>(() => ({
    pick: (ids, on) => latest.current.pick(ids, on),
    select: (id) => latest.current.select(id, true),
    openDetail: (id) => {
      latest.current.revealDock?.();
      latest.current.onSearch({ line: id, detail: true }, { replace: true });
    },
    openScene: (groupId, lineId) => latest.current.onOpenScene?.(groupId, lineId),
    editSource: (line) => latest.current.lineActions?.editSource(line),
    addLine: (line) => latest.current.lineActions?.addLine(line),
    showInGraph: (line) => latest.current.lineActions?.showInGraph(line),
    arrivedEnd: () => setArrived(undefined),
    noting: setNoting,
    escape: () => latest.current.setEditing(false),
    done: (id, advanced) => (advanced ? latest.current.advanceFrom(id) : latest.current.select(undefined, false)),
    filterTag: (tagId) => latest.current.onSearch({ tags: [tagId], page: undefined }),
    filterMark: (mark) => latest.current.onSearch({ marks: [mark], page: undefined }),
    filterAi: () => latest.current.onSearch({ decidedBy: 'ai', page: undefined }),
  }), []);
  const rowTags = lineTags(statuses.data?.tags);
  useEffect(() => {
    const row = selectedRow.current;
    if (!row) return;
    const fromLink = search.line !== pickedHere.current;
    row.scrollIntoView({ block: fromLink ? 'center' : 'nearest' });
    if (fromLink) {
      pickedHere.current = search.line;
      setArrived(search.line);
    }
  }, [search.line, rows]);

  // Set filters show as removable chips; while finding, the find bar shows them instead.
  const chips = find ? [] : filterChips(search, statusList, statuses.data?.tags ?? [], markStyles);

  // The details pane opens only on request (the 상세 button, the row's menu): picking or moving between
  // lines never reveals it, and closing it keeps the picked line.
  const showDetail = Boolean(search.line && search.detail);
  return (
    <SplitPane fill="height"
      id="lines"
      autoActivate={Boolean(dockEditor || showDetail)}
      selectionKey={dockSelectionKey}
      defaultWidth="380px"
      pane={dockEditor ?? (
        showDetail && search.line ? (
          <LineDetail
            projectId={projectId}
            unitId={search.line}
            onClose={() => onSearch({ detail: undefined }, { replace: true })}
            showScene={showScene}
            aiNode={search.aiNode}
            onAiNode={(aiNode) => onSearch({ aiNode }, { replace: true })}
          />
        ) : undefined
      )}
    >
      <HeaderActions>
        <RunDialog projectId={projectId} unitIds={picked.size ? [...picked] : undefined} groupIds={picked.size ? undefined : runGroupIds} viewKind={picked.size || runGroupIds ? undefined : runKind}
          trigger={<Button><Play /> {picked.size ? `실행 · ${picked.size.toLocaleString()}줄` : "실행"}</Button>} />
        {!find && !review && hasLineFilter(search) && <ActionBar aria-label="대사 목록 동작" items={[{ id: 'find-in-scene', label: '장면에서 찾아가기', onSelect: () => onSearch({ mode: 'find', page: undefined }) }]} />}
      </HeaderActions>
      <EditorToolbar><FilterBar>
        <SearchField size="sm" value={search.q} onChange={(value) => onSearch({ q: value, page: undefined })} placeholder="원문·번역 찾기" />
          <LineFilters
          projectId={projectId}
          statuses={statusList}
          tags={lineTags(statuses.data?.tags)}
          speakers={(speakers.data ?? []).flatMap((row) => (row.speaker ? [{ name: row.speaker, lines: row.lines }] : []))}
          listeners={listeners.data?.listeners ?? []}
          unknownListenerCount={listeners.data?.unknownCount ?? 0}
          listenersPending={listeners.isPending}
          listenersError={listeners.isError}
          onRetryListeners={() => { void listeners.refetch(); }}
            withSpeakers={withSpeakers}
          search={search}
          onSearch={(next) => onSearch({ ...next, page: undefined })}
        />
        <FilterChips
          chips={chips.map((chip) => ({
            key: chip.key,
            label: chip.label,
            color: chip.mark ? markColor(chip.mark, markStyles) : chip.tag?.color,
            hidden: chip.hidden,
            clear: () => onSearch({ ...chip.clear, page: undefined }),
          }))}
        />
        <Text marginLeft="auto" nowrap variant="caption" tone="muted">{review && "검토함 · "}{total.toLocaleString()}줄</Text>
      </FilterBar></EditorToolbar>
      {banner}
      {showScene && (matches.isPending || lines.isPlaceholderData) && <Text as="p" paddingX="normal" paddingY="condensed" variant="caption" tone="muted" role="status">{groupNoun}별 전체 선택 목록을 불러오는 중입니다.</Text>}
      {showScene && matches.isError && !lines.isPlaceholderData && (
        <Inline gap="condensed" paddingX="normal" paddingY="condensed" variant="caption" tone="muted" role="alert">
          <span>{groupNoun}별 전체 선택 목록을 불러오지 못했습니다.</span>
          <Button variant="outline" onClick={() => void matches.refetch()}>다시 시도</Button>
        </Inline>
      )}
      {!!rows?.length && <LineHeadRow projectId={projectId} rows={rows} bulk={bulk} statusList={statusList} tags={lineTags(statuses.data?.tags)} />}
      <Box minHeight={0} grow overflow="y">
        {!rows ? (
          <Box spaceY="comfortable" padding="comfortable">
            <Skeleton shape="row" count={6} />
          </Box>
        ) : rows.length === 0 ? (
          <EmptyState variant="roomy" noun={emptyNoun} filtered={!review && hasLineFilter(search)} action={!review && !hasLineFilter(search) ? emptyAction : undefined} />
        ) : (
          <ul>
            {rows.map((line, index) => {
              const selected = line.id === search.line;
              const sceneLines = showScene && rows[index - 1]?.groupId !== line.groupId ? (matchingByScene.get(line.groupId) ?? NO_ROWS) : undefined;
              return (
                <LineItem
                  key={line.id}
                  actions={rowActions}
                  projectId={projectId}
                  line={line}
                  newScene={sceneLines !== undefined}
                  sceneLines={sceneLines}
                  sceneChecked={sceneLines ? sceneSelectionState(picked, sceneLines.map((row) => row.id)) : false}
                  matchesReady={matchesReady}
                  selected={selected}
                  marked={find?.ids.has(line.id)}
                  findLabel={find?.label}
                  status={statusById.get(line.statusId)}
                  statusList={statusList}
                  tags={rowTags}
                  tokenPattern={tokenPattern}
                  review={review}
                  isPicked={picked.has(line.id)}
                  arrived={line.id === arrived}
                  rowRef={selected ? selectedRow : undefined}
                  // Only the picked line edits and takes notes: the other rows keep their props (and skip rendering).
                  noting={selected && noting}
                  focusTick={selected ? focusTick : 0}
                  withSceneLink={Boolean(onOpenScene)}
                  withLineActions={Boolean(lineActions)}
                />
              );
            })}
          </ul>
        )}
      </Box>
      <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={(next) => onSearch({ page: next || undefined, line: undefined })} />
    </SplitPane>
  );
}
