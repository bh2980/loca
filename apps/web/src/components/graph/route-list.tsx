import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { SeamStateChip } from '@/components/graph/seam-check-pane';
import { buildItems, indexOfLine, nodeStarts, routeSequence, translatedIds, untranslatedFrom, type RouteItem } from '@/components/graph/route-list-model';
import { LineSourceText, TokenText } from '@/components/editor/source-text';
import { LineHints } from '@/components/script/line-row';
import { TranslationEditor } from '@/components/translation-editor';
import { Button, Skeleton, AiMark, StatusIcon, HelpTip } from '@loca/ui';
import { client, unwrap, type InferResponseType } from '@/lib/api';
import { tokenPatternOf } from '@/lib/line-context';
import { keyLabel } from '@/lib/keys';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

type RouteData = InferResponseType<(typeof client.projects)[':projectId']['route']['$get']>;
type Row = InferResponseType<(typeof client.projects)[':projectId']['units']['by-ids']['$post']>['rows'][number];

/** Lines are read from the server this many at a time (reading order), the chunks around what is on screen. */
const CHUNK = 40;
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Opened folds are a session convenience (not page state): kept per project in sessionStorage. */
const foldStore = (projectId: string) => `tw.graph.route.folds.${projectId}`;
const topStore = (projectId: string) => `tw.graph.route.top.${projectId}`;
function readSet(key: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}
function readTop(projectId: string): { round: number; unitId: string } | undefined {
  try {
    const raw = JSON.parse(sessionStorage.getItem(topStore(projectId)) ?? 'null') as { round?: unknown; unitId?: unknown } | null;
    return raw && typeof raw.round === 'number' && typeof raw.unitId === 'string' ? { round: raw.round, unitId: raw.unitId } : undefined;
  } catch {
    return undefined;
  }
}
const writeSession = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A convenience: without storage the list opens at `at` again.
  }
};

/** One line of the route: who says it, the source and the translation; the picked line opens the script view's translation editor in place. */
function RouteLineRow({ projectId, unitId, row, selected, status, statusList, tokenPattern, focusTick, onSelect, onEscape, onDone }: {
  projectId: string;
  unitId: string;
  row: Row | undefined;
  selected: boolean;
  status: { name: string; color: string } | undefined;
  statusList: Parameters<typeof TranslationEditor>[0]['statuses'];
  tokenPattern: RegExp | null;
  focusTick: number;
  onSelect: () => void;
  onEscape: () => void;
  onDone: (advanced: boolean) => void;
}) {
  if (!row) return <Skeleton className="m-3 h-12" data-testid="route-row-loading" data-unit={unitId} />;
  const narration = row.kind === 'dialogue' && !row.speaker?.trim();
  return (
    <div
      role="listitem"
      data-unit={row.id}
      data-selected={selected || undefined}
      onClick={() => !selected && onSelect()}
      className={cn('px-4 py-2.5', selected ? 'bg-muted shadow-[inset_2px_0_0_var(--primary)]' : 'cursor-pointer hover:bg-accent')}
    >
      <p className="mb-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <span className="truncate">{row.speaker ?? '지문·문구'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <StatusIcon status={status} />
          {status?.name}
          <AiMark by={row.statusBy} />
        </span>
      </p>
      {selected ? (
        <div className="space-y-2">
          <div>
            <LineSourceText projectId={projectId} unitId={row.id} source={row.source} translation={row.translation} className={cn('text-sm', narration && 'text-muted-foreground')} />
            <LineHints projectId={projectId} line={row} part="context" />
          </div>
          <TranslationEditor key={`editor-${row.id}`} projectId={projectId} unit={row} statuses={statusList} focusKey={focusTick} onEscape={onEscape} onDone={onDone} />
          <LineHints projectId={projectId} line={row} part="result" />
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          <TokenText text={row.source} source={row.source} pattern={tokenPattern} className={narration ? 'text-muted-foreground' : undefined} />
          {row.translation ? <TokenText text={row.translation} source={row.source} pattern={tokenPattern} className="border-l-2 pl-2" /> : <p className="border-l-2 border-transparent pl-2 text-subtle-foreground">번역 없음</p>}
        </div>
      )}
    </div>
  );
}

/** The seam between this route's new lines (above) and an earlier route's lines (below): its check state and the check. */
function SeamBand({ projectId, nodeId, state, entries }: { projectId: string; nodeId: string; state: 'checked' | 'stale' | undefined; entries: number }) {
  const queryClient = useQueryClient();
  const mark = useMutation({
    // The signature is of the lines as they read right now (the server refuses a check made against older text).
    mutationFn: async () => {
      const detail = await queryClient.fetchQuery({ ...q.seamDetail(projectId, nodeId), staleTime: 0 });
      return unwrap(client.projects[':projectId']['seam-checks'][':nodeId'].$put({ param: { projectId, nodeId }, json: { sig: detail.sig } }));
    },
    onError: (error) => toast.error(error.message),
  });
  const unmark = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['seam-checks'][':nodeId'].$delete({ param: { projectId, nodeId } })),
    onError: (error) => toast.error(error.message),
  });
  const busy = mark.isPending || unmark.isPending;
  return (
    <div role="separator" data-testid="seam-band" data-seam={nodeId} className="flex items-center gap-2 border-y bg-muted px-4 py-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">이번 길의 새 줄 ↑</span>
      <span className="h-px min-w-4 flex-1 bg-border" />
      <span className="shrink-0">이음새</span>
      <SeamStateChip state={state} className="h-5 px-1.5 text-xs" />
      {entries > 1 && <span className="inline-flex shrink-0 items-center gap-1">갈래 {entries}개 <HelpTip>이 이음새로 새 줄 갈래가 여럿 들어옵니다. 다른 갈래의 마지막 줄은 지도에서 이음새를 눌러 확인하세요.</HelpTip></span>}
      <Button variant="outline" disabled={busy} onClick={() => (state === 'checked' ? unmark.mutate() : mark.mutate())} title={state === 'stale' ? '점검한 뒤 이 줄들의 번역이 바뀌었습니다. 다시 점검하면 지금 내용 기준이 됩니다.' : undefined}>
        {state === 'checked' ? '점검 취소' : '점검함'}
      </Button>
      <span className="h-px min-w-4 flex-1 bg-border" />
      <span className="shrink-0">↓ 이미 번역한 길</span>
    </div>
  );
}

/**
 * 길 번역 목록 (docs/DESIGN.md J2c): the route's lines in reading order, virtualized, each row editable in
 * place with the script view's TranslationEditor. Stretches translated on an earlier route fold into
 * '번역함 · N줄'; a seam is a band with the two lines either side of it, all editable. `at` (the map's
 * place) follows the scroll and the list follows `at` when something else moves it; neither pushes history.
 */
export function RouteList({ projectId, slice, checks, at, edit, onEdit, onAt }: {
  projectId: string;
  slice: RouteData;
  checks: Record<string, { state: 'checked' | 'stale' }> | undefined;
  /** The overview node the map is at. */
  at: string | undefined;
  /** The picked line (URL `edit`). */
  edit: string | undefined;
  onEdit: (unitId: string | undefined) => void;
  /** The list scrolled to another node (replaces the history entry). */
  onAt: (nodeId: string) => void;
}) {
  const statuses = useQuery(q.statuses(projectId));
  const statusList = useMemo(() => statuses.data?.statuses ?? [], [statuses.data]);
  const statusById = useMemo(() => new Map(statusList.map((status) => [status.id, status])), [statusList]);
  const project = useQuery(q.project(projectId));
  const tokenPattern = useMemo(() => tokenPatternOf(project.data?.formatRules ?? undefined), [project.data?.formatRules]);

  const sequence = useMemo(() => routeSequence(slice.overview), [slice.overview]);
  const seqIndex = useMemo(() => new Map(sequence.map((line, i) => [line.unitId, i] as const)), [sequence]);
  const translated = useMemo(() => translatedIds(slice.blocks, slice.translatedMask), [slice.blocks, slice.translatedMask]);
  const earlier = useMemo(() => new Set(slice.blocks.filter((block) => block.earlier).flatMap((block) => block.unitIds)), [slice.blocks]);
  const seamNodes = useMemo(() => new Set(slice.seamAround.map((seam) => seam.nodeId)), [slice.seamAround]);
  const seamEntries = useMemo(() => new Map(slice.seamAround.map((seam) => [seam.nodeId, seam.before.length] as const)), [slice.seamAround]);
  // Lines that stay open: the two either side of a seam, and the picked one.
  const open = useMemo(() => new Set([...slice.seamAround.flatMap((seam) => [...seam.before.flatMap((entry) => entry.unitIds), ...seam.after]), ...(edit ? [edit] : [])]), [slice.seamAround, edit]);
  const [expanded, setExpanded] = useState<Set<string>>(() => readSet(foldStore(projectId)));
  const expand = useCallback(
    (unitIds: string[]) =>
      setExpanded((current) => {
        const next = new Set([...current, ...unitIds]);
        writeSession(foldStore(projectId), [...next]);
        return next;
      }),
    [projectId],
  );
  const items = useMemo(
    () => buildItems({ sequence, round: slice.round, translated: (id) => translated.has(id), earlier: (id) => earlier.has(id), open, expanded, seams: seamNodes }),
    [sequence, slice.round, translated, earlier, open, expanded, seamNodes],
  );
  const starts = useMemo(() => nodeStarts(items), [items]);
  const remaining = useMemo(() => sequence.filter((line) => !translated.has(line.unitId)).length, [sequence, translated]);

  const parent = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: (index) => (items[index]?.kind === 'line' ? 76 : 44),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 6,
  });
  const virtual = virtualizer.getVirtualItems();

  // The lines on screen come from the server in chunks of the reading order (the chunk after the last one too, for scrolling on).
  const chunks = new Set<number>();
  for (const entry of virtual) {
    const item = items[entry.index];
    const first = item?.kind === 'line' ? seqIndex.get(item.unitId) : undefined;
    if (first !== undefined) chunks.add(Math.floor(first / CHUNK));
  }
  if (edit && seqIndex.has(edit)) chunks.add(Math.floor(seqIndex.get(edit)! / CHUNK));
  if (chunks.size) chunks.add(Math.max(...chunks) + 1);
  const chunkIds = [...chunks].sort((a, b) => a - b).map((chunk) => sequence.slice(chunk * CHUNK, (chunk + 1) * CHUNK).map((line) => line.unitId));
  const results = useQueries({ queries: chunkIds.filter((ids) => ids.length).map((ids) => q.routeRows(projectId, ids)) });
  const rows = new Map<string, Row>();
  for (const result of results) for (const row of result.data?.rows ?? []) rows.set(row.id, row);

  // ── where the list is ────────────────────────────────────────────────
  /** A scroll the page asked for: the report of the node under the top is held back while it settles. */
  const programmatic = useRef(0);
  const reported = useRef<string | undefined>(at);
  const jump = useCallback(
    (index: number, align: 'start' | 'center' | 'auto') => {
      programmatic.current = performance.now();
      virtualizer.scrollToIndex(index, { align });
    },
    [virtualizer],
  );
  const startsRef = useRef(starts);
  startsRef.current = starts;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Opening (and a reload): the picked line, else where this tab last was, else the map's node.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !items.length) return;
    opened.current = true;
    const picked = edit ? indexOfLine(items, edit) : -1;
    const top = readTop(projectId);
    const remembered = top && top.round === slice.round ? indexOfLine(items, top.unitId) : -1;
    const target = picked >= 0 ? picked : remembered >= 0 ? remembered : (at ? (starts.get(at) ?? 0) : 0);
    if (target > 0) jump(target, picked >= 0 ? 'center' : 'start');
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // The map (a click, the toolbar's steps) moved `at`: the list goes to that node.
  useEffect(() => {
    if (!opened.current || !at || at === reported.current) return;
    reported.current = at;
    const index = startsRef.current.get(at);
    if (index !== undefined) jump(index, 'start');
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new route starts from the top; a picked line the route no longer has is forgotten.
  const round = useRef(slice.round);
  useEffect(() => {
    if (round.current !== slice.round) {
      round.current = slice.round;
      programmatic.current = performance.now();
      virtualizer.scrollToOffset(0);
      // The list starts over, so the URL's place does too (the scroll report is held back while it moves).
      const first = items.find((item) => item.nodeId)?.nodeId;
      if (first && first !== at) {
        reported.current = first;
        onAt(first);
      }
    }
  }, [slice.round]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (edit && !seqIndex.has(edit)) onEdit(undefined);
  }, [edit, seqIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  // Scrolling: the node under the top of the list is where the map is.
  const topIndex = virtualizer.range?.startIndex;
  useEffect(() => {
    if (topIndex === undefined) return;
    const item = itemsRef.current[topIndex];
    if (!item) return;
    if (item.kind !== 'seam') writeSession(topStore(projectId), { round: slice.round, unitId: item.kind === 'line' ? item.unitId : item.unitIds[0] });
    if (performance.now() - programmatic.current < 700 || item.nodeId === reported.current) return;
    reported.current = item.nodeId;
    onAt(item.nodeId);
  }, [topIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── picking and moving ───────────────────────────────────────────────
  // Bumped whenever the picked line's editor should take the focus; 0 = just looking.
  const [focusTick, setFocusTick] = useState(0);
  const pickedHere = useRef<string | undefined>(undefined);
  const select = useCallback(
    (unitId: string | undefined, editing: boolean) => {
      pickedHere.current = unitId;
      setFocusTick((tick) => (editing ? tick + 1 : 0));
      onEdit(unitId);
    },
    [onEdit],
  );
  // A line picked here only scrolls as far as needed; one that came with the URL (Back, a link) is brought into view.
  useEffect(() => {
    if (!edit || !opened.current) return;
    const index = indexOfLine(itemsRef.current, edit);
    if (index >= 0 && !(virtualizer.range && index >= virtualizer.range.startIndex && index <= virtualizer.range.endIndex)) jump(index, edit === pickedHere.current ? 'auto' : 'center');
    pickedHere.current = edit;
  }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveLine = (direction: 1 | -1, editing: boolean) => {
    const from = edit ? indexOfLine(items, edit) : (virtualizer.range?.startIndex ?? 0) - (direction === 1 ? 1 : -1);
    for (let i = from + direction; i >= 0 && i < items.length; i += direction) {
      const item = items[i]!;
      if (item.kind === 'line') return select(item.unitId, editing);
    }
    toast(direction === 1 ? '이 길의 마지막 줄입니다.' : '이 길의 첫 줄입니다.');
  };
  const goUntranslated = (direction: 1 | -1) => {
    const top = items[virtualizer.range?.startIndex ?? 0];
    const from = edit ?? (top?.kind === 'line' ? top.unitId : top?.kind === 'fold' ? top.unitIds[0] : undefined);
    const target = untranslatedFrom(sequence, (id) => translated.has(id), from, direction);
    if (target) select(target, true);
    else toast(direction === 1 ? '이 길에는 뒤에 번역할 줄이 없습니다.' : '이 길에는 앞에 번역할 줄이 없습니다.');
  };
  const keys = useRef({ moveLine, goUntranslated, edit, select });
  keys.current = { moveLine, goUntranslated, edit, select };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const inField = typing(event.target);
      // Alt+N / Alt+Shift+N: the next / previous line without a translation (the physical key: with Korean input or ⌥ on a Mac the character differs).
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyN') {
        event.preventDefault();
        keys.current.goUntranslated(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.metaKey || event.ctrlKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter')) return;
      // As in the script view: ↑↓ move the pick, Alt+↑↓ do too while typing; Alt+↑↓ outside a field are the previous/next choice (the page's).
      if (event.key === 'Enter') {
        if (!inField && keys.current.edit && !document.querySelector('[role="dialog"]')) (event.preventDefault(), keys.current.select(keys.current.edit, true));
        return;
      }
      if (inField ? !event.altKey : event.altKey) return;
      if (!inField && document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      keys.current.moveLine(event.key === 'ArrowDown' ? 1 : -1, inField);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const renderItem = (item: RouteItem) => {
    if (item.kind === 'seam') return <SeamBand projectId={projectId} nodeId={item.nodeId} state={checks?.[item.nodeId]?.state} entries={seamEntries.get(item.nodeId) ?? 1} />;
    if (item.kind === 'fold')
      return (
        <Button variant="ghost" className="w-full justify-start rounded-none bg-muted px-4 font-normal text-muted-foreground" data-testid="route-fold" title="앞선 길에서 번역을 마친 줄입니다. 누르면 펼칩니다." onClick={() => expand(item.unitIds)}>
          번역함 · {item.unitIds.length.toLocaleString()}줄
        </Button>
      );
    const row = rows.get(item.unitId);
    return (
      <RouteLineRow
        projectId={projectId}
        unitId={item.unitId}
        row={row}
        selected={item.unitId === edit}
        status={row && statusById.get(row.statusId)}
        statusList={statusList}
        tokenPattern={tokenPattern}
        focusTick={focusTick}
        onSelect={() => select(item.unitId, true)}
        onEscape={() => setFocusTick(0)}
        onDone={(advanced) => (advanced ? moveLine(1, true) : select(undefined, false))}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="route-list" data-items={items.length} data-lines={sequence.length}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums" data-testid="route-list-count">
          이번 길 {sequence.length.toLocaleString()}줄 · 번역 안 한 줄 {remaining.toLocaleString()}
        </span>
        <Button variant="ghost" disabled={!remaining} title={`앞의 번역 안 한 줄 (${keyLabel('Alt+Shift+N')})`} onClick={() => goUntranslated(-1)}>
          <ChevronUp /> 이전 안 한 줄
        </Button>
        <Button variant="ghost" disabled={!remaining} title={`뒤의 번역 안 한 줄 (${keyLabel('Alt+N')})`} onClick={() => goUntranslated(1)}>
          <ChevronDown /> 다음 안 한 줄
        </Button>
      </div>
      <div ref={parent} className="min-h-0 flex-1 overflow-y-auto" data-testid="route-scroll">
        <div role="list" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtual.map((entry) => {
            const item = items[entry.index];
            if (!item) return null;
            return (
              <div key={entry.key} data-index={entry.index} ref={virtualizer.measureElement} className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${entry.start}px)` }}>
                {renderItem(item)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
