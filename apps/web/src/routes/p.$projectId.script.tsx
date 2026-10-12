import { useCallback, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useDefaultLayout } from 'react-resizable-panels';
import { ChevronLeft, ChevronRight, Network, PanelLeftClose, PanelLeftOpen, Play, Sparkles } from 'lucide-react';
import { Page } from '@/components/page';
import { GroupList, type GroupRow } from '@/components/script/group-list';
import { LineList, linesSearchSchema, type LinesSearch } from '@/components/script/line-list';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { askAgent } from '@/lib/agent';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GROUP_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

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
  const done = group ? Object.entries(group.statuses).reduce((sum, [id, n]) => sum + (finalIds.has(id) ? n : 0), 0) : 0;
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

  const onSearch = useCallback((next: Partial<ScriptSearch>, options?: { replace?: boolean }) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: options?.replace }), [navigate]);
  const openGroup = (id: string | undefined) => void navigate({ search: (previous) => ({ gq: previous.gq, remaining: previous.remaining, group: id }) });

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
          {group && (
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {done}/{group.total} 완료
            </span>
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
            heading={heading}
            actions={
              <RunDialog
                projectId={projectId}
                groupIds={group ? [group.id] : undefined}
                trigger={
                  <Button variant="outline">
                    <Play /> AI 실행
                  </Button>
                }
              />
            }
            menu={
              group && (
                <>
                  <DropdownMenuItem onSelect={() => askAgent(`이 ${GROUP_KIND[group.kind]}을 끝까지 읽고 요약해줘.`, { send: true })}>
                    <Sparkles /> AI로 장면 요약
                  </DropdownMenuItem>
                  {group.kind === 'scene' && (
                    <DropdownMenuItem asChild>
                      <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: group.id }}>
                        <Network /> 대사 그래프에서 보기
                      </Link>
                    </DropdownMenuItem>
                  )}
                </>
              )
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </Page>
  );
}
