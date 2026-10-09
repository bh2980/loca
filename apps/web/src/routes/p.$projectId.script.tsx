import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsUpDown, List, Network, Play, Search, X } from 'lucide-react';
import { LinesView, linesSearchSchema, type LinesSearch } from '@/components/lines-view';
import { AiButton } from '@/components/ai-button';
import { Page } from '@/components/page';
import { GroupTable } from '@/components/script/group-table';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GROUP_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

type Kind = keyof typeof GROUP_KIND;
interface ScriptSearch extends LinesSearch {
  /** Group whose lines are open; none = the group list (or every line with `view=lines`). */
  group?: string;
  /** Every line of the project in one table instead of the group list. */
  view?: 'lines';
  /** Group list filters, kept while a group is open so Back and prev/next follow the same list. */
  kind?: Kind;
  gq?: string;
}

export const Route = createFileRoute('/p/$projectId/script')({
  validateSearch: (raw: Record<string, unknown>): ScriptSearch => ({
    ...linesSearchSchema(raw),
    group: typeof raw.group === 'string' ? raw.group : undefined,
    view: raw.view === 'lines' ? 'lines' : undefined,
    kind: typeof raw.kind === 'string' && raw.kind in GROUP_KIND ? (raw.kind as Kind) : undefined,
    gq: typeof raw.gq === 'string' && raw.gq ? raw.gq : undefined,
  }),
  component: Script,
});

/**
 * The script: first every group (scenes, documents, UI) in one table by section, then one group's
 * lines with its neighbours a click away. Kind is a column and a filter, not a separate list.
 */
function Script() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const groups = useQuery(q.groups(projectId, { kind: search.kind, q: search.gq }));
  const statuses = useQuery(q.statuses(projectId));
  const ordered = [...(groups.data ?? [])].sort((a, b) => a.sort - b.sort);
  const index = ordered.findIndex((item) => item.id === search.group);
  const group = index >= 0 ? ordered[index] : undefined;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const setSearch = (next: Partial<ScriptSearch>, replace = false) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });
  const openGroup = (id: string | undefined) => setSearch({ group: id, view: undefined, page: undefined, line: undefined, q: undefined, status: undefined, tag: undefined, speaker: undefined, listener: undefined });
  const toList = () => openGroup(undefined);
  useReportView('script', [group && { kind: GROUP_KIND[group.kind], id: group.id, label: group.title }]);

  if (search.group)
    return (
      <Page
        title="스크립트"
        back={
          <Button variant="ghost" size="sm" onClick={toList}>
            <ArrowLeft /> 묶음 목록
          </Button>
        }
        meta={
          <span className="flex min-w-0 items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7" disabled={index <= 0} aria-label="이전 묶음" onClick={() => openGroup(ordered[index - 1]?.id)}>
              <ChevronLeft />
            </Button>
            <GroupSwitcher groups={ordered} current={group} onPick={openGroup} />
            <Button variant="ghost" size="icon" className="size-7" disabled={index < 0 || index >= ordered.length - 1} aria-label="다음 묶음" onClick={() => openGroup(ordered[index + 1]?.id)}>
              <ChevronRight />
            </Button>
            {group && <span className="truncate">{[GROUP_KIND[group.kind], group.section, group.description].filter(Boolean).join(' · ')}</span>}
          </span>
        }
        actions={
          group && (
            <>
              <RunDialog
                projectId={projectId}
                groupIds={[group.id]}
                trigger={
                  <Button size="sm">
                    <Play /> 이 {GROUP_KIND[group.kind]} 실행
                  </Button>
                }
              />
              <AiButton prompt={`이 ${GROUP_KIND[group.kind]}을 끝까지 읽고 요약해줘.`}>AI 요약</AiButton>
              {group.kind === 'scene' && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: group.id }}>
                    <Network /> 대사 그래프
                  </Link>
                </Button>
              )}
            </>
          )
        }
        flush
      >
        <LinesView projectId={projectId} groupId={search.group} search={search} onSearch={(next, options) => setSearch(next, options?.replace)} />
      </Page>
    );

  if (search.view === 'lines')
    return (
      <Page
        title="스크립트"
        back={
          <Button variant="ghost" size="sm" onClick={toList}>
            <ArrowLeft /> 묶음 목록
          </Button>
        }
        meta={<span>모든 대사{search.kind ? ` · ${GROUP_KIND[search.kind]}만` : ''}</span>}
        flush
      >
        <LinesView projectId={projectId} kind={search.kind} search={search} showScene onSearch={(next, options) => setSearch(next, options?.replace)} />
      </Page>
    );

  const lineTotal = ordered.reduce((sum, item) => sum + item.total, 0);
  return (
    <Page
      title="스크립트"
      meta={
        <span className="tabular-nums">
          묶음 {ordered.length.toLocaleString()}개 · 대사 {lineTotal.toLocaleString()}개
        </span>
      }
      actions={
        <Button variant="outline" size="sm" onClick={() => setSearch({ view: 'lines', page: undefined, line: undefined })}>
          <List /> 모든 대사 보기
        </Button>
      }
      flush
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
          <InputGroup className="w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              defaultValue={search.gq}
              placeholder="묶음 제목·키로 찾기"
              onKeyDown={(event) => event.key === 'Enter' && setSearch({ gq: event.currentTarget.value.trim() || undefined }, true)}
              onBlur={(event) => event.currentTarget.value.trim() !== (search.gq ?? '') && setSearch({ gq: event.currentTarget.value.trim() || undefined }, true)}
            />
          </InputGroup>
          {picked.size > 0 && (
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="font-medium tabular-nums">{picked.size}개 선택</span>
              <RunDialog
                projectId={projectId}
                groupIds={[...picked]}
                trigger={
                  <Button size="sm">
                    <Play /> 실행
                  </Button>
                }
              />
              <Button size="icon" variant="ghost" className="size-8" aria-label="선택 해제" onClick={() => setPicked(new Set())}>
                <X />
              </Button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {groups.data && (
            <GroupTable
              projectId={projectId}
              groups={ordered}
              statuses={statuses.data?.statuses ?? []}
              picked={picked}
              expandAll={Boolean(search.gq)}
              kind={search.kind}
              onKind={(kind) => setSearch({ kind }, true)}
              onOpen={openGroup}
              onPick={(ids, on) =>
                setPicked((previous) => {
                  const next = new Set(previous);
                  for (const id of ids) if (on) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
            />
          )}
          {groups.data?.length === 0 && <p className="px-6 py-8 text-sm text-muted-foreground">맞는 묶음이 없습니다.</p>}
        </div>
      </div>
    </Page>
  );
}

/** Jump to any group of the current list by title, without going back to it. */
function GroupSwitcher({ groups, current, onPick }: { groups: { id: string; title: string; section: string | null; kind: Kind }[]; current?: { id: string; title: string }; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-80 min-w-0 justify-between font-medium text-foreground" aria-label="묶음 바꾸기">
          <span className="truncate">{current?.title ?? '묶음'}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <Command>
          <CommandInput placeholder="묶음 찾기" />
          <CommandList>
            <CommandEmpty>맞는 묶음이 없습니다.</CommandEmpty>
            {groups.map((group) => (
              <CommandItem
                key={group.id}
                value={`${group.title} ${group.section ?? ''} ${group.id}`}
                onSelect={() => {
                  setOpen(false);
                  onPick(group.id);
                }}
              >
                <span className="truncate">{group.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{[group.section, GROUP_KIND[group.kind]].filter(Boolean).join(' · ')}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
