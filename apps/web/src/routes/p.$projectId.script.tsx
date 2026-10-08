import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Network, Play, Search, X } from 'lucide-react';
import { LinesView, linesSearchSchema, type LinesSearch } from '@/components/lines-view';
import { Page } from '@/components/page';
import { StatusBar } from '@/components/status';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { GROUP_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

type Kind = keyof typeof GROUP_KIND;
interface ScriptSearch extends LinesSearch {
  /** Group open on the right; none = every line of the project (or of `kind`). */
  group?: string;
  kind?: Kind;
  /** Filter for the group list. */
  gq?: string;
}

export const Route = createFileRoute('/p/$projectId/script')({
  validateSearch: (raw: Record<string, unknown>): ScriptSearch => ({
    ...linesSearchSchema(raw),
    group: typeof raw.group === 'string' ? raw.group : undefined,
    kind: typeof raw.kind === 'string' && raw.kind in GROUP_KIND ? (raw.kind as Kind) : undefined,
    gq: typeof raw.gq === 'string' && raw.gq ? raw.gq : undefined,
  }),
  component: Script,
});

/**
 * The whole source script: groups from the import file (scenes, UI, documents) on the left,
 * their lines on the right. No group picked = all lines, so UI and document strings are never hidden.
 */
function Script() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const groups = useQuery(q.groups(projectId, { kind: search.kind, q: search.gq }));
  const statuses = useQuery(q.statuses(projectId));
  const group = groups.data?.find((item) => item.id === search.group);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const setSearch = (next: Partial<ScriptSearch>, replace = false) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });
  const openGroup = (id: string | undefined) => setSearch({ group: id, page: undefined, line: undefined });
  useReportView('script', [group && { kind: GROUP_KIND[group.kind], id: group.id, label: group.title }]);
  const visibleTotal = groups.data?.reduce((sum, item) => sum + item.total, 0) ?? 0;

  return (
    <Page
      title="스크립트"
      meta={
        group ? (
          <span>
            <span className="font-medium text-foreground">{group.title}</span> · {[GROUP_KIND[group.kind], group.key, group.description].filter(Boolean).join(' · ')}
          </span>
        ) : undefined
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
            {group.kind === 'scene' && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: group.id }}>
                  <Network /> 대사 그래프에서 보기
                </Link>
              </Button>
            )}
          </>
        )
      }
      flush
    >
      <div className="flex h-full min-h-0">
        <aside className="flex w-72 shrink-0 flex-col border-r">
          <div className="space-y-2 border-b p-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="w-full"
              value={search.kind ?? 'all'}
              onValueChange={(value) => value && setSearch({ kind: value === 'all' ? undefined : (value as Kind), group: undefined, page: undefined, line: undefined })}
            >
              <ToggleGroupItem value="all" className="flex-1">
                전체
              </ToggleGroupItem>
              {(Object.keys(GROUP_KIND) as Kind[]).map((kind) => (
                <ToggleGroupItem key={kind} value={kind} className="flex-1">
                  {GROUP_KIND[kind]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                defaultValue={search.gq}
                placeholder="제목·키로 찾기"
                onKeyDown={(event) => event.key === 'Enter' && setSearch({ gq: event.currentTarget.value.trim() || undefined }, true)}
                onBlur={(event) => event.currentTarget.value.trim() !== (search.gq ?? '') && setSearch({ gq: event.currentTarget.value.trim() || undefined }, true)}
              />
            </InputGroup>
          </div>
          {picked.size > 0 && (
            <div className="flex items-center gap-1 border-b bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{picked.size}개 선택</span>
              <RunDialog
                projectId={projectId}
                groupIds={[...picked]}
                trigger={
                  <Button size="sm" className="ml-auto">
                    <Play /> 실행
                  </Button>
                }
              />
              <Button size="icon" variant="ghost" className="size-8" aria-label="선택 해제" onClick={() => setPicked(new Set())}>
                <X />
              </Button>
            </div>
          )}
          <ul className="min-h-0 flex-1 overflow-auto p-1.5">
            <li>
              <button
                onClick={() => openGroup(undefined)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted', !search.group && 'bg-muted font-medium')}
              >
                {search.kind ? `모든 ${GROUP_KIND[search.kind]}` : '전체 스크립트'}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{visibleTotal.toLocaleString()}</span>
              </button>
            </li>
            {groups.data?.map((item) => (
              <li key={item.id} className={cn('flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted', item.id === search.group && 'bg-muted')}>
                <Checkbox
                  className="mt-0.5"
                  aria-label={`${item.title} 선택`}
                  checked={picked.has(item.id)}
                  onCheckedChange={(checked) =>
                    setPicked((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                <button onClick={() => openGroup(item.id)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-baseline gap-2 text-sm">
                    <span className={cn('truncate', item.id === search.group && 'font-medium')}>{item.title}</span>
                    {!search.kind && item.kind !== 'scene' && <span className="shrink-0 text-[10px] text-muted-foreground">{GROUP_KIND[item.kind]}</span>}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{item.total}</span>
                  </span>
                  <StatusBar statuses={statuses.data?.statuses ?? []} counts={item.statuses} className="mt-1 h-1" />
                </button>
              </li>
            ))}
            {groups.data?.length === 0 && <li className="px-2 py-4 text-sm text-muted-foreground">맞는 묶음이 없습니다.</li>}
          </ul>
        </aside>
        <div className="min-w-0 flex-1">
          <LinesView
            projectId={projectId}
            groupId={search.group}
            kind={search.group ? undefined : search.kind}
            search={search}
            showScene={!search.group}
            onSearch={(next, options) => setSearch(next, options?.replace)}
          />
        </div>
      </div>
    </Page>
  );
}
