import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useDefaultLayout } from 'react-resizable-panels';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Network, PanelLeftClose, PanelLeftOpen, Sparkles, X } from 'lucide-react';
import { Page } from '@/components/page';
import { GroupList, type GroupRow } from '@/components/script/group-list';
import { filterChips, isFinding, LineList, linesSearchSchema, type LinesSearch } from '@/components/script/line-list';
import { Button } from '@/components/ui/button';
import { askAgent } from '@/lib/agent';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GROUP_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { keyLabel } from '@/lib/keys';

type Kind = GroupRow['kind'];
interface ScriptSearch extends LinesSearch {
  /** Group whose lines are shown; none = every line (of `kind`, if set). */
  group?: string;
  /** Only lines waiting in the review inbox. */
  review?: true;
  /** The group list's own filters, kept while lines change. */
  kind?: Kind;
  gq?: string;
}

/** Whether the group list is shown is a per-tab convenience (sessionStorage), like folded sections. */
const LIST_KEY = 'tw.script.list';
const readListOpen = () => {
  try {
    return sessionStorage.getItem(LIST_KEY) !== '0';
  } catch {
    return true;
  }
};

export const Route = createFileRoute('/p/$projectId/script')({
  validateSearch: (raw: Record<string, unknown>): ScriptSearch => ({
    ...linesSearchSchema(raw),
    group: typeof raw.group === 'string' && raw.group ? raw.group : undefined,
    review: raw.review === true || raw.review === 'true' ? true : undefined,
    kind: typeof raw.kind === 'string' && raw.kind in GROUP_KIND ? (raw.kind as Kind) : undefined,
    gq: typeof raw.gq === 'string' && raw.gq ? raw.gq : undefined,
  }),
  component: Script,
});

/**
 * The translation screen. Left: the script's groups by section, with "모든 대사" and "검토함" on
 * top. Center: the chosen lines, translated in place. Right: the picked line's details.
 */
function Script() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const project = useQuery(q.project(projectId));
  const groups = useQuery(q.groups(projectId, { kind: search.kind, q: search.gq }));
  const statuses = useQuery(q.statuses(projectId));
  const ordered = [...(groups.data ?? [])].sort((a, b) => a.sort - b.sort);
  const index = ordered.findIndex((item) => item.id === search.group);
  const group = index >= 0 ? ordered[index] : undefined;
  const finalIds = new Set(statuses.data?.statuses.filter((status) => status.kind === 'final').map((status) => status.id));
  const lineTotal = project.data?.byStatus.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const [listOpen, setListOpen] = useState(() => readListOpen());
  // The list's width is dragged by its edge and remembered, like every right-hand pane.
  const layout = useDefaultLayout({ id: 'tw-script-groups', panelIds: listOpen ? ['groups', 'lines'] : ['lines'], storage: localStorage });
  const toggleList = () =>
    setListOpen((open) => {
      try {
        sessionStorage.setItem(LIST_KEY, open ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !open;
    });
  useReportView('script', [group && { kind: GROUP_KIND[group.kind], id: group.id, label: group.title }]);

  // 찾아가기: the filter's lines are walked one by one inside their scenes instead of listed apart.
  const finding = isFinding(search) && !search.review;
  const matches = useQuery({
    ...q.unitMatches(projectId, { statusId: search.status, tagIds: search.tags?.join(','), q: search.q, speaker: search.speaker, listener: search.listener, marks: search.marks?.join(',') }),
    enabled: finding,
  });
  const matchRows = useMemo(() => (finding ? (matches.data?.rows ?? []) : []), [finding, matches.data]);
  const perScene = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of matchRows) counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
    return counts;
  }, [matchRows]);
  const position = matchRows.findIndex((row) => row.id === search.line);
  const goToMatch = useCallback((row: { id: string; groupId: string } | undefined) => row && void navigate({ search: (previous) => ({ ...previous, group: row.groupId, line: row.id, page: undefined }), replace: true }), [navigate]);
  // Next/previous from the picked line; from a line that is not a match, the nearest one after or before it in script order.
  const step = (direction: 1 | -1) => {
    if (!matchRows.length) return;
    if (position >= 0) return goToMatch(matchRows[position + direction]);
    const sceneIndex = (groupId: string) => ordered.findIndex((item) => item.id === groupId);
    const here = sceneIndex(search.group ?? '');
    const candidates = direction === 1 ? matchRows.filter((row) => sceneIndex(row.groupId) >= here) : matchRows.filter((row) => sceneIndex(row.groupId) <= here).reverse();
    goToMatch(candidates[0] ?? (direction === 1 ? matchRows[0] : matchRows.at(-1)));
  };
  // Entering 찾아가기 (from home, picking a filter, opening a scene) goes to the first match there, or the first overall.
  useEffect(() => {
    if (!finding || !matches.data || !matchRows.length) return;
    const picked = matchRows.find((row) => row.id === search.line);
    if (picked) return picked.groupId === search.group ? undefined : goToMatch(picked);
    if (search.line) return; // a line picked by hand in this scene, to read around a match
    // A scene without matches stays open as chosen; ⌥↓ goes on from it.
    if (search.group) return goToMatch(matchRows.find((row) => row.groupId === search.group));
    goToMatch(matchRows[0]);
  }, [finding, matches.data, search.group]); // eslint-disable-line react-hooks/exhaustive-deps
  // A match that stops matching (its listener was picked) hands over to the one that took its place.
  const previousMatches = useRef<{ ids: string[]; line?: string }>({ ids: [] });
  useEffect(() => {
    const before = previousMatches.current;
    previousMatches.current = { ids: matchRows.map((row) => row.id), line: search.line };
    if (!finding || !search.line || before.line !== search.line) return;
    const was = before.ids.indexOf(search.line);
    if (was >= 0 && position < 0 && matchRows.length) goToMatch(matchRows[Math.min(was, matchRows.length - 1)]);
  }, [matchRows]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!finding) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      event.preventDefault();
      step(event.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const findLabel = filterChips(search, statuses.data?.statuses ?? [], statuses.data?.tags ?? []).map((chip) => chip.label).concat(search.q ? [`“${search.q}”`] : []).join(' · ');
  const clearFilters = { q: undefined, status: undefined, tags: undefined, speaker: undefined, listener: undefined, marks: undefined, view: undefined, page: undefined };

  const onSearch = useCallback((next: Partial<ScriptSearch>, options?: { replace?: boolean }) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: options?.replace }), [navigate]);
  // Moving to another scene keeps a filter being walked (찾아가기); otherwise only the list's own search and marks.
  const openGroup = (id: string | undefined) =>
    void navigate({ search: (previous) => (finding ? { ...previous, group: id, line: undefined, page: undefined, detail: undefined } : { gq: previous.gq, marks: previous.marks, group: id }) });

  const heading = (
    <span className="flex min-w-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={toggleList} aria-label={listOpen ? '장면 목록 접기' : '장면 목록 펴기'}>
            {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{listOpen ? '장면 목록 접기' : '장면 목록 펴기'}</TooltipContent>
      </Tooltip>
      {search.group ? (
        <>
          <Button variant="ghost" size="icon" disabled={index <= 0} aria-label="이전 장면" onClick={() => openGroup(ordered[index - 1]?.id)}>
            <ChevronLeft />
          </Button>
          <span className="max-w-72 truncate text-sm font-semibold" title={group?.title}>
            {group?.title ?? '…'}
          </span>
          <Button variant="ghost" size="icon" disabled={index < 0 || index >= ordered.length - 1} aria-label="다음 장면" onClick={() => openGroup(ordered[index + 1]?.id)}>
            <ChevronRight />
          </Button>
          {group?.kind === 'scene' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="대사 그래프에서 보기" asChild>
                  <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: group.id }}>
                    <Network />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>대사 그래프에서 보기</TooltipContent>
            </Tooltip>
          )}
          {group && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="AI로 요약" onClick={() => askAgent(`이 ${GROUP_KIND[group.kind]}을 끝까지 읽고 요약해줘.`, { send: true })}>
                  <Sparkles />
                </Button>
              </TooltipTrigger>
              <TooltipContent>채팅에서 AI로 {GROUP_KIND[group.kind]} 요약</TooltipContent>
            </Tooltip>
          )}
        </>
      ) : (
        <span className="px-1 text-sm font-semibold">{search.review ? '검토함' : '모든 대사'}</span>
      )}
    </span>
  );

  return (
    <Page title="번역" flush>
      <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged} className="h-full min-h-0">
        {listOpen && (
          <>
            <ResizablePanel id="groups" defaultSize="300px" minSize="200px" maxSize="50%" className="min-w-0">
              <GroupList
                projectId={projectId}
                groups={groups.data && ordered}
                finalIds={finalIds}
                scope={{ group: search.group, review: search.review }}
                lineTotal={lineTotal}
                reviewCount={project.data?.reviewCount ?? 0}
                gq={search.gq}
                onFilter={(gq) => onSearch({ gq }, { replace: true })}
                marks={finding ? perScene : undefined}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}
        <ResizablePanel id="lines" minSize="480px" className="flex min-w-0 flex-col">
          <LineList
            key={`${search.group ?? ''}:${search.review ?? ''}`}
            projectId={projectId}
            groupId={search.group}
            review={search.review}
            kind={search.group ? undefined : search.kind}
            search={search}
            onSearch={onSearch}
            onOpenScene={(groupId, line) => void navigate({ search: { group: groupId, line } })}
            find={finding && search.group ? { ids: new Set(matchRows.filter((row) => row.groupId === search.group).map((row) => row.id)), label: findLabel } : undefined}
            banner={
              finding && (
                <div className="flex shrink-0 items-center gap-2 border-b bg-warning/5 px-4 py-1.5 text-sm">
                  {/* Says it is the whole scene, the matches marked: the list alone shows only the matches. */}
                  <span className="truncate">
                    장면 전체에서 <span className="font-medium">{findLabel}</span> 찾는 중
                  </span>
                  <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {!matches.data ? '찾는 중…' : !matchRows.length ? '해당하는 줄이 없습니다' : `${position >= 0 ? (position + 1).toLocaleString() : '–'} / ${matchRows.length.toLocaleString()}줄 · 이 장면 ${(perScene.get(search.group ?? '') ?? 0).toLocaleString()}줄`}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="이전 줄" disabled={!matchRows.length} onClick={() => step(-1)}>
                          <ChevronUp />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>이전 줄 ({keyLabel('Alt+Up')})</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="다음 줄" disabled={!matchRows.length} onClick={() => step(1)}>
                          <ChevronDown />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>다음 줄 ({keyLabel('Alt+Down')})</TooltipContent>
                    </Tooltip>
                    <Button variant="ghost" onClick={() => onSearch({ view: 'list', group: undefined, page: undefined })}>
                      맞는 줄만 보기
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="필터 지우기" onClick={() => onSearch(clearFilters)}>
                      <X />
                    </Button>
                  </span>
                </div>
              )
            }
            heading={heading}
            runGroupIds={group ? [group.id] : undefined}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </Page>
  );
}
