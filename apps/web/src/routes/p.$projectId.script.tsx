import { useCallback, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useDefaultLayout } from 'react-resizable-panels';
import { ChevronLeft, ChevronRight, Network, PanelLeftClose, PanelLeftOpen, Play, X } from 'lucide-react';
import { AiButton } from '@/components/ai-button';
import { Page } from '@/components/page';
import { GroupList, type GroupRow } from '@/components/script/group-list';
import { LineList, linesSearchSchema, type LinesSearch } from '@/components/script/line-list';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
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
  const lineTotal = project.data?.byStatus.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
  const openGroup = (id: string | undefined) => void navigate({ search: (previous) => ({ gq: previous.gq, kind: previous.kind, group: id }) });

  const listToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={toggleList} aria-label={listOpen ? '묶음 목록 접기' : '묶음 목록 펴기'}>
          {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{listOpen ? '묶음 목록 접기' : '묶음 목록 펴기'}</TooltipContent>
    </Tooltip>
  );
  const title = search.review ? (
    <span className="text-sm font-semibold">검토함</span>
  ) : search.group ? (
    <span className="flex min-w-0 items-center gap-1">
      <Button variant="ghost" size="icon" disabled={index <= 0} aria-label="이전 묶음" onClick={() => openGroup(ordered[index - 1]?.id)}>
        <ChevronLeft />
      </Button>
      <span className="min-w-0">
        <span className="block max-w-80 truncate text-sm font-semibold" title={group?.title}>
          {group?.title ?? '…'}
        </span>
        {group && <span className="block truncate text-xs text-muted-foreground">{[GROUP_KIND[group.kind], group.section, group.description].filter(Boolean).join(' · ')}</span>}
      </span>
      <Button variant="ghost" size="icon" disabled={index < 0 || index >= ordered.length - 1} aria-label="다음 묶음" onClick={() => openGroup(ordered[index + 1]?.id)}>
        <ChevronRight />
      </Button>
    </span>
  ) : (
    <span className="text-sm font-semibold">모든 대사{search.kind ? ` · ${GROUP_KIND[search.kind]}` : ''}</span>
  );
  const heading = (
    <span className="flex min-w-0 items-center gap-1">
      {listToggle}
      {title}
    </span>
  );

  const actions = group && (
    <>
      <RunDialog
        projectId={projectId}
        groupIds={[group.id]}
        trigger={
          <Button variant="outline">
            <Play /> 이 {GROUP_KIND[group.kind]} 실행
          </Button>
        }
      />
      <AiButton prompt={`이 ${GROUP_KIND[group.kind]}을 끝까지 읽고 요약해줘.`}>AI 요약</AiButton>
      {group.kind === 'scene' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" asChild>
              <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: group.id }} aria-label="대사 그래프에서 보기">
                <Network />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>대사 그래프에서 보기</TooltipContent>
        </Tooltip>
      )}
    </>
  );

  return (
    <Page title="번역" flush>
      <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged} className="h-full min-h-0">
        {listOpen && (
          <>
            <ResizablePanel id="groups" defaultSize="340px" minSize="220px" maxSize="50%" className="min-w-0">
              <GroupList
                projectId={projectId}
                groups={groups.data && ordered}
                statuses={statuses.data?.statuses ?? []}
                scope={{ group: search.group, review: search.review }}
                lineTotal={lineTotal}
                reviewCount={project.data?.reviewCount ?? 0}
                gq={search.gq}
                kind={search.kind}
                onFilter={(next) => onSearch(next, { replace: true })}
                picked={picked}
                onPick={(ids, on) =>
                  setPicked((previous) => {
                    const next = new Set(previous);
                    for (const id of ids) if (on) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
                bulk={
                  <>
                    <span className="font-medium tabular-nums">묶음 {picked.size}개</span>
                    <RunDialog
                      projectId={projectId}
                      groupIds={[...picked]}
                      trigger={
                        <Button>
                          <Play /> 실행
                        </Button>
                      }
                    />
                    <Button variant="ghost" size="icon" className="ml-auto" aria-label="선택 해제" onClick={() => setPicked(new Set())}>
                      <X />
                    </Button>
                  </>
                }
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
            heading={heading}
            actions={actions}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </Page>
  );
}
