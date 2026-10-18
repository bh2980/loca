import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { LineDetail } from '@/components/line-detail';
import { SplitPane, FilterChips, Pager, SearchInput, FilterBar, ActionBar, EmptyState, Button, Skeleton, TagChip } from '@loca/ui';
import { HeaderActions } from '@/components/page';
import { MarkChip } from '@/components/status';
import { tokenPatternOf } from '@/lib/line-context';
import { RunDialog } from '@/components/workflow/run-dialog';
import { lineTags, q } from '@/lib/queries';
import { hasLineFilter, LineFilters, filterChips, type LinesSearch } from '@/components/script/line-filters';
import { LineHeadRow, useLineBulk } from '@/components/script/line-bulk';
import { LineRow } from '@/components/script/line-row';

export { filterChips, isFinding, linesSearchSchema, type LinesSearch } from '@/components/script/line-filters';

const PAGE_SIZE = 100;

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The translation screen's lines: source on the left, translation on the right, in script order.
 * Only the picked line opens up — its editor and a short row of hints (speech rule, terms, format,
 * what the last run flagged). Tags stay below the translation in both modes. Other details (listener, candidates, AI context, history)
 * lives in the details pane, opened on demand. Keyboard: ↑↓ moves, ↵ edits, ⌘↵ confirms and goes on.
 */
export function LineList({
  projectId,
  groupId,
  review,
  kind,
  search,
  onSearch,
  heading,
  runGroupIds,
  runKind,
  onOpenScene,
  find,
  banner,
}: {
  projectId: string;
  groupId?: string;
  review?: boolean;
  kind?: 'scene' | 'document' | 'ui';
  search: LinesSearch;
  onSearch: (next: Partial<LinesSearch>, options?: { replace?: boolean }) => void;
  heading: ReactNode;
  /** What 'AI 실행' runs when no line is picked (the open scene; none = the whole list's scope). */
  runGroupIds?: string[];
  /** The script view (대사 · UI · 문서) the list shows, for 'AI 실행' to start from that kind's lines. */
  runKind?: 'scene' | 'ui' | 'document';
  /** Opens a line in its own scene, without this list's filters. */
  onOpenScene?: (groupId: string, lineId: string) => void;
  /** Walking a filter inside this scene: every line shows, the matching ones are marked. */
  find?: { ids: Set<string>; label: string };
  /** Shown between the toolbar and the lines (the find bar). */
  banner?: ReactNode;
}) {
  const statuses = useQuery(q.statuses(projectId));
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
        : { groupId, kind, review: review ? '1' : undefined, marks: search.marks?.join(','), q: search.q, statusId: search.status, tagIds: search.tags?.join(','), speaker: search.speaker, listener: search.listener, focus: focusing, offset: page * PAGE_SIZE, limit: PAGE_SIZE },
    ),
  );
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
  const showScene = !groupId;
  const speakers = useQuery(q.speakers(projectId));
  const people = useQuery(q.characters(projectId));
  // Bumped whenever the picked line's editor should take the focus; 0 = just looking.
  const [focusTick, setFocusTick] = useState(0);
  const setEditing = (edit: boolean) => setFocusTick((tick) => (edit ? tick + 1 : 0));

  // Lines picked by their checkboxes; the head row above the lines acts on them.
  const bulk = useLineBulk({ projectId, pickKey: review ? 'review' : (groupId ?? (kind ? `all.${kind}` : 'all')), rows, tagName: (tagId) => tagById.get(tagId)?.name, marks: search.marks });
  const { picked, pick, stopPicking } = bulk;
  // Moving past the end of a page opens the next page and lands on its first (or last) line.
  const landing = useRef<'first' | 'last' | null>(null);
  useEffect(() => {
    if (!landing.current || !rows?.length || lines.isPlaceholderData) return;
    const target = landing.current === 'first' ? rows[0] : rows.at(-1)!;
    landing.current = null;
    pickedHere.current = target.id;
    onSearch({ line: target.id }, { replace: true });
  }, [rows, lines.isPlaceholderData, onSearch]);

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
  // After ⌘↵ the line may leave the list (검토함, #남은 줄); the next line is the one after it as it was.
  const advanceFrom = (id: string) => {
    if (!rows) return;
    const index = rows.findIndex((row) => row.id === id);
    const shrinking = review || search.marks?.some((mark) => mark === 'remaining' || mark === 'ai');
    if (index >= 0 && index + 1 < rows.length) select(rows[index + 1].id, true);
    else if (shrinking && index > 0 && page + 1 >= Math.ceil(total / PAGE_SIZE)) select(rows[index - 1].id, true);
    else move(1, true);
  };

  const moveRef = useRef(move);
  moveRef.current = move;
  const selectedRef = useRef(search.line);
  selectedRef.current = search.line;
  // While a filter is walked, ⌥↑↓ go to the previous/next match (the script page handles them).
  const findingRef = useRef(Boolean(find));
  findingRef.current = Boolean(find);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      const inField = typing(event.target);
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.altKey && findingRef.current) return;
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (event.altKey || !inField)) {
        if (!inField && document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
        event.preventDefault();
        moveRef.current(event.key === 'ArrowDown' ? 1 : -1, inField);
      } else if (event.key === 'Enter' && !inField && selectedRef.current && !document.querySelector('[role="dialog"]')) {
        event.preventDefault();
        setEditing(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const selectedRow = useRef<HTMLLIElement>(null);
  // A line opened from a link (glossary example, search, evidence) is brought to the middle and
  // flashes once, so it is found at a glance; lines moved to here only scroll as far as needed.
  const [arrived, setArrived] = useState<string>();
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
  const chips = find ? [] : filterChips(search, statusList, statuses.data?.tags ?? []);

  return (
    <SplitPane
      id="lines"
      defaultWidth="380px"
      className="h-full min-h-0"
      pane={
        search.line &&
        search.detail && (
          <LineDetail
            projectId={projectId}
            unitId={search.line}
            onClose={() => onSearch({ detail: undefined, lineTab: undefined }, { replace: true })}
            showScene={showScene}
            tab={search.lineTab ?? 'checks'}
            onTab={(tab) => onSearch({ lineTab: tab === 'checks' ? undefined : tab }, { replace: true })}
            aiNode={search.aiNode}
            onAiNode={(aiNode) => onSearch({ aiNode }, { replace: true })}
          />
        )
      }
    >
      <HeaderActions>
        <RunDialog projectId={projectId} unitIds={picked.size ? [...picked] : undefined} groupIds={picked.size ? undefined : runGroupIds} viewKind={picked.size || runGroupIds ? undefined : runKind}
          trigger={<Button><Play /> {picked.size ? `AI 실행 · 고른 ${picked.size.toLocaleString()}줄` : 'AI 실행'}</Button>} />
        {!find && !review && hasLineFilter(search) && <ActionBar aria-label="대사 목록 동작" items={[{ id: 'find-in-scene', label: '장면에서 찾아가기', onSelect: () => onSearch({ mode: 'find', page: undefined }) }]} />}
      </HeaderActions>
      <FilterBar>
        <div className="mr-1 min-w-0 shrink">{heading}</div>
        <SearchInput value={search.q} onChange={(value) => onSearch({ q: value, page: undefined })} placeholder="찾기" className="w-44" />
        <LineFilters
          projectId={projectId}
          statuses={statusList}
          tags={lineTags(statuses.data?.tags)}
          speakers={(speakers.data ?? []).flatMap((row) => (row.speaker ? [{ name: row.speaker, lines: row.lines }] : []))}
          search={search}
          onSearch={(next) => onSearch({ ...next, page: undefined })}
        />
        <FilterChips
          chips={chips.map((chip) => ({
            key: chip.key,
            label: chip.mark ? <MarkChip mark={chip.mark} /> : chip.tag ? <TagChip tag={chip.tag} /> : chip.label,
            name: chip.label,
            clear: () => onSearch({ ...chip.clear, page: undefined }),
          }))}
        />
      </FilterBar>
      {banner}
      {!!rows?.length && <LineHeadRow projectId={projectId} rows={rows} bulk={bulk} statusList={statusList} tags={lineTags(statuses.data?.tags)} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!rows ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState className="py-16" noun={review ? '검토할 대사' : '대사'} filtered={!review && hasLineFilter(search)} />
        ) : (
          <ul>
            {rows.map((line, index) => {
              const selected = line.id === search.line;
              return (
                <LineRow
                  key={line.id}
                  projectId={projectId}
                  line={line}
                  newScene={showScene && rows[index - 1]?.groupId !== line.groupId}
                  selected={selected}
                  marked={find?.ids.has(line.id)}
                  findLabel={find?.label}
                  status={statusById.get(line.statusId)}
                  statusList={statusList}
                  tags={lineTags(statuses.data?.tags)}
                  tokenPattern={tokenPattern}
                  review={review}
                  isPicked={picked.has(line.id)}
                  arrived={line.id === arrived}
                  rowRef={selected ? selectedRow : undefined}
                  noting={noting}
                  focusTick={focusTick}
                  onPick={(on) => pick([line.id], on)}
                  onSelect={() => select(line.id, true)}
                  onOpenScene={onOpenScene}
                  onArrivedEnd={() => setArrived(undefined)}
                  onNoting={setNoting}
                  onDetail={() => onSearch({ detail: true }, { replace: true })}
                  onEscape={() => setEditing(false)}
                  onDone={(advanced) => (advanced ? advanceFrom(line.id) : select(undefined, false))}
                  onFilterTag={(tagId) => onSearch({ tags: [tagId], page: undefined })}
                  onFilterMark={(mark) => onSearch({ marks: [mark], page: undefined })}
                />
              );
            })}
          </ul>
        )}
      </div>
      <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={(next) => onSearch({ page: next || undefined, line: undefined })} />
    </SplitPane>
  );
}
