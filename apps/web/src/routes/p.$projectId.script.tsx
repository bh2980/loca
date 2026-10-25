import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListTree, X } from 'lucide-react';
import { Page } from '@/components/page';
import { GroupList, type GroupRow } from '@/components/script/group-list';
import { filterChips, isFinding, LineList, linesSearchSchema, type LinesSearch } from '@/components/script/line-list';
import { lineQueryParams } from '@/components/script/line-filters';
import { SourceEditor, type SourceEditorMode, type SourceSaved } from '@/components/script/source-editor';
import { Button, ContextMenuItem, ContextMenuSeparator, EditorToolbarProvider, EditorToolbarSlot, Icon, Inline, PageHeading, ScriptWorkspace, Text, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { askAgent } from '@/lib/agent';
import { GROUP_KIND, SCRIPT_VIEW, SOURCE_GROUP_LABEL, SOURCE_UNIT_LABEL } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { keyLabel } from '@/lib/keys';

type Kind = GroupRow['kind'];
const VIEW_ORDER: Kind[] = ['scene', 'ui', 'document'];
interface ScriptSearch extends LinesSearch {
  /** Group whose lines are shown; none = every line of the view (`kind`). */
  group?: string;
  /** Only lines waiting in the review inbox. */
  review?: true;
  /** All lines inside one chapter/section. */
  section?: string;
  /**
   * The view: the scenes' dialogue, UI strings or documents, each with its own groups on the left.
   * Unset = the picked group's kind, else the first kind the project has. One kind = no views.
   */
  kind?: Kind;
  /** The group list's own search, kept while lines change. */
  gq?: string;
  /** Source create/edit mode mounted in the line detail dock. */
  sourceAction?: SourceEditorMode;
  sourceKind?: Kind;
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
    section: typeof raw.section === 'string' && raw.section ? raw.section : undefined,
    kind: typeof raw.kind === 'string' && raw.kind in GROUP_KIND ? (raw.kind as Kind) : undefined,
    gq: typeof raw.gq === 'string' && raw.gq ? raw.gq : undefined,
    sourceAction: ['create-group', 'edit-group', 'create-unit', 'edit-unit'].includes(String(raw.sourceAction)) ? raw.sourceAction as SourceEditorMode : undefined,
    sourceKind: typeof raw.sourceKind === 'string' && raw.sourceKind in GROUP_KIND ? raw.sourceKind as Kind : undefined,
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
  const allGroups = useQuery(q.groups(projectId));
  const searched = useQuery({ ...q.groups(projectId, { q: search.gq }), enabled: Boolean(search.gq) });
  const statuses = useQuery(q.statuses(projectId));
  // Keep all source kinds available, including empty ones, so standard-format documents are discoverable.
  const views = VIEW_ORDER.map((kind) => ({
    kind,
    lines: (allGroups.data ?? []).filter((item) => item.kind === kind).reduce((sum, item) => sum + item.total, 0),
  }));
  const view: Kind = allGroups.data?.find((item) => item.id === search.group)?.kind ?? search.kind ?? 'scene';
  const selectedSection = search.section ? allGroups.data?.find((item) => item.kind === view && item.section === search.section)?.section : undefined;
  const groups = search.gq ? searched : allGroups;
  const ordered = [...(groups.data ?? [])].filter((item) => item.kind === view).sort((a, b) => a.sort - b.sort);
  const kindGroupCount = (allGroups.data ?? []).filter((item) => item.kind === view).length;
  const index = ordered.findIndex((item) => item.id === search.group);
  const group = index >= 0 ? ordered[index] : undefined;
  const sectionGroupIds = search.section ? (allGroups.data ?? []).filter((item) => item.kind === view && item.section === search.section).map((item) => item.id) : undefined;
  const finalIds = new Set(statuses.data?.statuses.filter((status) => status.kind === 'final').map((status) => status.id));
  const initialIds = new Set(statuses.data?.statuses.filter((status) => status.kind === 'initial').map((status) => status.id));
  const [listOpen, setListOpen] = useState(() => readListOpen());
  // The list's width is dragged by its edge and remembered, like every right-hand pane.
  const showGroups = listOpen;
  const toggleList = () =>
    setListOpen((open) => {
      try {
        sessionStorage.setItem(LIST_KEY, open ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !open;
    });
  useReportView('script', [group && { kind: SOURCE_GROUP_LABEL[group.kind], id: group.id, label: group.title }]);

  // 찾아가기: the filter's lines are walked one by one inside their scenes instead of listed apart.
  const finding = isFinding(search) && !search.review;
  const matches = useQuery({
    // Walking a filter stays inside the open view (대사 · UI · 문서).
    ...q.unitMatches(projectId, { kind: view, section: search.section, ...lineQueryParams(search) }),
    enabled: finding,
  });
  const matchRows = useMemo(() => (finding ? (matches.data?.rows ?? []) : []), [finding, matches.data]);
  const perScene = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of matchRows) counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
    return counts;
  }, [matchRows]);
  const position = matchRows.findIndex((row) => row.id === search.line);
  const goToMatch = useCallback((row: { id: string; groupId: string } | undefined) => row && void navigate({ search: (previous) => ({ ...previous, group: row.groupId, section: undefined, line: row.id, page: undefined }), replace: true }), [navigate]);
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
  const clearFilters = { q: undefined, status: undefined, tags: undefined, speaker: undefined, listener: undefined, marks: undefined, mode: undefined, page: undefined };

  const onSearch = useCallback((next: Partial<ScriptSearch>, options?: { replace?: boolean }) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: options?.replace }), [navigate]);
  // Scene navigation changes location, not the user's active filters.
  const openGroup = (id: string | undefined, line?: string) =>
    void navigate({ search: (previous) => ({ ...previous, sourceAction: undefined, sourceKind: undefined, group: id, section: undefined, review: undefined, kind: id ? undefined : previous.kind, line, page: undefined, detail: undefined }) });
  const openSourceEditor = (mode: SourceEditorMode, kind: Kind = view) =>
    void navigate({ search: (previous) => ({ ...previous, sourceAction: mode, sourceKind: kind }) });
  const closeSourceEditor = () => void navigate({ search: (previous) => ({ ...previous, sourceAction: undefined, sourceKind: undefined }), replace: true });
  const onSourceSaved = (result: SourceSaved) => {
    // Land on the saved source even if the prior filters would have hidden it.
    void navigate({ search: (previous) => ({
      ...previous,
      sourceAction: undefined,
      sourceKind: undefined,
      kind: result.entity === 'group' ? undefined : previous.kind,
      group: result.groupId,
      section: undefined,
      review: undefined,
      line: result.entity === 'unit' ? result.id : undefined,
      q: undefined, status: undefined, tags: undefined, speaker: undefined, listener: undefined, marks: undefined, mode: undefined,
      page: undefined, detail: undefined,
    }) });
  };

  // What used to sit in a "…" menu now sits beside what it acts on: + at the scene list, a scene's
  // right-click (edit, add a line, graph, AI summary), a line's right-click (원문 편집, add a line,
  // graph), the list toggle and ‹ › (previous / next scene) at the title.
  const activeGroupKind = group?.kind ?? view;
  const groupNoun = SOURCE_GROUP_LABEL[activeGroupKind];
  const sourceAt = (mode: SourceEditorMode, kind: Kind, groupId?: string, line?: string) =>
    void navigate({ search: (previous) => ({ ...previous, sourceAction: mode, sourceKind: kind, ...(groupId && { group: groupId, section: undefined, review: undefined, kind: undefined }), ...(line && { line }) }) });
  const graphOf = (groupId: string) => void navigate({ to: '/p/$projectId/graph', params: { projectId }, search: { scope: 'dialogue', scene: groupId } });
  const groupMenu = (item: GroupRow) => (
    <>
      <ContextMenuItem onClick={() => sourceAt('edit-group', item.kind, item.id)}>{SOURCE_GROUP_LABEL[item.kind]} 편집</ContextMenuItem>
      <ContextMenuItem onClick={() => sourceAt('create-unit', item.kind, item.id)}>{SOURCE_UNIT_LABEL[item.kind]} 추가</ContextMenuItem>
      {item.kind === 'scene' && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => graphOf(item.id)}>그래프에서 보기</ContextMenuItem>
          <ContextMenuItem onClick={() => askAgent(`"${item.title}" 장면을 끝까지 읽고 요약해줘.`, { send: true })}>AI로 장면 요약</ContextMenuItem>
        </>
      )}
    </>
  );
  const iconButton = (label: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>{icon}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const heading = <>
    {iconButton(listOpen ? `${groupNoun} 목록 접기` : `${groupNoun} 목록 펴기`, <Icon icon={ListTree} tone={listOpen ? undefined : 'subtle'} />, toggleList)}
    <Text variant="body" weight="semibold">{search.review ? '검토함' : SCRIPT_VIEW[view]}</Text><Icon icon={ChevronRight} size="xs" tone="muted" />
    <Text truncate maxWidth="label" variant="caption" tone="muted">{group?.title ?? selectedSection ?? (search.review ? '검토 대기' : `전체 ${view === 'scene' ? '대사' : view === 'ui' ? 'UI' : '문서'}`)}</Text>
    {group && (
      <Inline as="span">
        {iconButton(`이전 ${groupNoun}`, <ChevronLeft />, () => openGroup(ordered[index - 1]?.id), index <= 0)}
        {iconButton(`다음 ${groupNoun}`, <ChevronRight />, () => openGroup(ordered[index + 1]?.id), index < 0 || index >= ordered.length - 1)}
      </Inline>
    )}
  </>;

  return (
    <Page title="번역" flush column>
      <EditorToolbarProvider>
      <EditorToolbarSlot />
      <PageHeading>{heading}</PageHeading>
      <ScriptWorkspace open={showGroups} navigation={
            <GroupList
              statuses={statuses.data?.statuses}
              projectId={projectId}
              groups={groups.data && ordered}
              finalIds={finalIds}
              initialIds={initialIds}
              scope={{ group: search.group, review: search.review, section: search.section, kind: view }}
              views={views}
              reviewCount={project.data?.reviewCount ?? 0}
              gq={search.gq}
              onFilter={(gq) => onSearch({ gq }, { replace: true })}
              marks={finding ? perScene : undefined}
              onCreate={() => openSourceEditor('create-group', view)}
              menu={groupMenu}
            />
      }>
          <LineList
            key={`${search.group ?? ''}:${search.section ?? ''}:${search.review ?? ''}:${search.group || search.review ? '' : view}`}
            projectId={projectId}
            groupId={search.group}
            review={search.review}
            kind={search.group || search.review ? undefined : view}
            displayKind={view}
            section={search.group || search.review ? undefined : search.section}
            search={search}
            onSearch={onSearch}
            onOpenScene={(groupId, line) => openGroup(groupId, line)}
            lineActions={{
              editSource: (line) => sourceAt('edit-unit', line.groupKind, undefined, line.id),
              addLine: (line) => sourceAt('create-unit', line.groupKind, line.groupId),
              showInGraph: (line) => graphOf(line.groupId),
            }}
            find={finding && search.group ? { ids: new Set(matchRows.filter((row) => row.groupId === search.group).map((row) => row.id)), label: findLabel } : undefined}
            banner={
              finding && (
                <Inline gap="condensed" shrink={false} border="bottom" background="warningFaint" paddingX="comfortable" paddingY="snug" variant="body">
                  {/* Says it is the whole scene, the matches marked: the list alone shows only the matches. */}
                  <Text truncate>
                    {SOURCE_GROUP_LABEL[group?.kind ?? view]} 전체에서 <Text weight="medium">{findLabel}</Text> 찾는 중
                  </Text>
                  <Text variant="caption" nowrap tone="muted" tabular>
                    {!matches.data ? '찾는 중…' : !matchRows.length ? '해당하는 줄이 없습니다' : `${position >= 0 ? (position + 1).toLocaleString() : '–'} / ${matchRows.length.toLocaleString()}줄 · 이 ${SOURCE_GROUP_LABEL[group?.kind ?? view]} ${(perScene.get(search.group ?? '') ?? 0).toLocaleString()}줄`}
                  </Text>
                  <Inline as="span" marginLeft="auto" gap="tight">
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
                    <Button variant="ghost" onClick={() => onSearch({ mode: undefined, group: undefined, page: undefined })}>
                      맞는 줄만 보기
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="필터 지우기" onClick={() => onSearch(clearFilters)}>
                      <X />
                    </Button>
                  </Inline>
                </Inline>
              )
            }
            runGroupIds={group ? [group.id] : sectionGroupIds}
            runKind={!search.group && !search.review && !search.section ? view : undefined}
            withSpeakers={view === 'scene'}
            emptyAction={kindGroupCount === 0 ? <Button variant="outline" onClick={() => openSourceEditor('create-group', view)}>{SOURCE_GROUP_LABEL[view]} 추가</Button> : <Button variant="outline" onClick={() => openSourceEditor('create-unit', view)}>{SOURCE_UNIT_LABEL[view]} 추가</Button>}
            dockSelectionKey={search.sourceAction ? `source:${search.sourceAction}:${search.sourceKind ?? ''}:${search.group ?? ''}:${search.line ?? ''}` : undefined}
            dockEditor={search.sourceAction ? <SourceEditor
              projectId={projectId}
              kind={search.sourceKind ?? group?.kind ?? view}
              groupId={search.sourceAction === 'edit-group' || (search.sourceAction === 'create-unit' && (group?.kind ?? view) === (search.sourceKind ?? view)) ? search.group : undefined}
              unitId={search.sourceAction === 'edit-unit' ? search.line : undefined}
              mode={search.sourceAction}
              onClose={closeSourceEditor}
              onSaved={onSourceSaved}
              onCreateGroup={() => openSourceEditor('create-group', search.sourceKind ?? view)}
              onDeleted={() => void navigate({ search: (previous) => ({
                ...previous,
                sourceAction: undefined,
                sourceKind: undefined,
                ...(search.sourceAction === 'edit-group' ? { group: undefined, kind: search.sourceKind ?? view, section: undefined, review: undefined, page: undefined } : {}),
                line: undefined,
                detail: undefined,
              }), replace: true })}
            /> : undefined}
          />
      </ScriptWorkspace>
      </EditorToolbarProvider>
    </Page>
  );
}
