import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Play, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { client, unwrap } from '@/lib/api';
import { LineDetail } from '@/components/line-detail';
import { StatusBadge, StatusDot, TagChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const PAGE_SIZE = 100;

const ORIGIN_LABEL = { ai: 'AI', human: '사람', tool: '도구', import: '가져옴' } as const;

/** Where the representative translation came from, kept out of the text itself. */
function OriginBadge({ origin, model }: { origin: keyof typeof ORIGIN_LABEL; model: string | null }) {
  return (
    <span className="mt-1 flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {ORIGIN_LABEL[origin]}
      {model && <span className="font-mono">· {model}</span>}
    </span>
  );
}

export interface LinesSearch {
  q?: string;
  status?: string;
  tag?: string;
  page?: number;
  line?: string;
}

/**
 * Filterable, server-paginated lines table with the line detail pane beside it.
 * All filter state lives in the URL, so Back/Forward and reload restore it exactly.
 */
export function LinesView({ projectId, groupId, kind, search, onSearch, showScene }: {
  projectId: string;
  groupId?: string;
  /** Only lines in groups of this kind (scene / document / ui). */
  kind?: 'scene' | 'document' | 'ui';
  search: LinesSearch;
  onSearch: (next: Partial<LinesSearch>, options?: { replace?: boolean }) => void;
  showScene?: boolean;
}) {
  const statuses = useQuery(q.statuses(projectId));
  const page = search.page ?? 0;
  const lines = useQuery(q.units(projectId, { groupId, kind, q: search.q, statusId: search.status, tagId: search.tag, offset: page * PAGE_SIZE, limit: PAGE_SIZE }));
  const statusById = new Map(statuses.data?.statuses.map((status) => [status.id, status]));
  const tagById = new Map(statuses.data?.tags.map((tag) => [tag.id, tag]));
  const total = lines.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedRow = useRef<HTMLTableRowElement>(null);
  // Picked lines (checkboxes) are separate from the line open in the detail pane, and survive paging.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pageIds = lines.data?.rows.map((line) => line.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const toggle = (ids: string[], on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      for (const id of ids) if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const setStatus = useMutation({
    mutationFn: (statusId: string) => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...picked], statusId } })),
    onSuccess: () => toast.success(`${picked.size}개 대사의 상태를 바꿨습니다.`),
  });
  const setTag = useMutation({
    mutationFn: ({ tagId, add }: { tagId: string; add: boolean }) =>
      unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: add ? { unitIds: [...picked], addTagIds: [tagId] } : { unitIds: [...picked], removeTagIds: [tagId] } })),
    onSuccess: (_data, { tagId, add }) => toast.success(`${picked.size}개 대사${add ? '에' : '에서'} #${tagById.get(tagId)?.name} 태그를 ${add ? '붙였습니다' : '뗐습니다'}.`),
  });

  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [search.line, lines.data]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          <InputGroup className="w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              defaultValue={search.q}
              placeholder="원문·번역·화자·ID"
              onKeyDown={(event) => event.key === 'Enter' && onSearch({ q: event.currentTarget.value.trim() || undefined, page: undefined })}
              onBlur={(event) => event.currentTarget.value.trim() !== (search.q ?? '') && onSearch({ q: event.currentTarget.value.trim() || undefined, page: undefined })}
            />
          </InputGroup>
          <Select value={search.status ?? 'all'} onValueChange={(value) => onSearch({ status: value === 'all' ? undefined : value, page: undefined })}>
            <SelectTrigger className="w-44" aria-label="상태 필터">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모든 상태</SelectItem>
              {statuses.data?.statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  <StatusDot color={status.color} /> {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!!statuses.data?.tags.length && (
            <Select value={search.tag ?? 'all'} onValueChange={(value) => onSearch({ tag: value === 'all' ? undefined : value, page: undefined })}>
              <SelectTrigger className="w-36" aria-label="태그 필터">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">모든 태그</SelectItem>
                {statuses.data.tags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    #{tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {total.toLocaleString()}개{total > PAGE_SIZE && ` 중 ${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min(total, (page + 1) * PAGE_SIZE).toLocaleString()}`}
          </span>
        </div>
        {picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-6 py-2 text-sm">
            <span className="font-medium tabular-nums">{picked.size}개 선택</span>
            <RunDialog
              projectId={projectId}
              unitIds={[...picked]}
              trigger={
                <Button size="sm">
                  <Play /> 워크플로 실행
                </Button>
              }
            />
            <Select value="" onValueChange={(statusId) => setStatus.mutate(statusId)}>
              <SelectTrigger size="sm" className="w-36 bg-background">
                <SelectValue placeholder="상태 변경" />
              </SelectTrigger>
              <SelectContent>
                {statuses.data?.statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    <StatusDot color={status.color} /> {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!!statuses.data?.tags.length && (
              <Select value="" onValueChange={(value) => setTag.mutate({ tagId: value.slice(1), add: value[0] === '+' })}>
                <SelectTrigger size="sm" className="w-36 bg-background">
                  <SelectValue placeholder="태그" />
                </SelectTrigger>
                <SelectContent>
                  {statuses.data.tags.map((tag) => (
                    <SelectItem key={`+${tag.id}`} value={`+${tag.id}`}>
                      #{tag.name} 붙이기
                    </SelectItem>
                  ))}
                  {statuses.data.tags.map((tag) => (
                    <SelectItem key={`-${tag.id}`} value={`-${tag.id}`}>
                      #{tag.name} 떼기
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              <X /> 선택 해제
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto border-t">
          <Table className="min-w-[720px] table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox aria-label="이 페이지 모두 선택" checked={allOnPage} onCheckedChange={(checked) => toggle(pageIds, Boolean(checked))} />
                </TableHead>
                {showScene && <TableHead className="w-40">묶음</TableHead>}
                <TableHead className="w-28">화자</TableHead>
                <TableHead>원문</TableHead>
                <TableHead>번역</TableHead>
                <TableHead className="w-36">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.data?.rows.map((line) => {
                const selected = line.id === search.line;
                return (
                  <TableRow
                    key={line.id}
                    ref={selected ? selectedRow : undefined}
                    data-state={selected ? 'selected' : undefined}
                    className="cursor-pointer align-top"
                    onClick={() => onSearch({ line: selected ? undefined : line.id }, { replace: true })}
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox aria-label={`${line.key} 선택`} checked={picked.has(line.id)} onCheckedChange={(checked) => toggle([line.id], Boolean(checked))} />
                    </TableCell>
                    {showScene && <TableCell className="truncate text-muted-foreground">{line.groupTitle}</TableCell>}
                    <TableCell className="truncate font-medium">{line.speaker ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="whitespace-pre-wrap">{line.source}</TableCell>
                    <TableCell className={cn('whitespace-pre-wrap', !line.translation && 'text-muted-foreground')}>
                      {line.translation ?? '—'}
                      {line.translation && line.origin && <OriginBadge origin={line.origin} model={line.model} />}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={statusById.get(line.statusId)} />
                        {line.tagIds.map((id) => tagById.get(id)).filter(Boolean).map((tag) => <TagChip key={tag!.id} tag={tag!} />)}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {lines.data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    조건에 맞는 대사가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t px-6 py-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onSearch({ page: page - 1 || undefined, line: undefined })}>
              <ChevronLeft /> 이전
            </Button>
            <span className="text-sm tabular-nums">
              {page + 1} / {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onSearch({ page: page + 1, line: undefined })}>
              다음 <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      {search.line && (
        <div className="w-[400px] shrink-0 border-l">
          <LineDetail projectId={projectId} unitId={search.line} onClose={() => onSearch({ line: undefined }, { replace: true })} showScene={showScene} />
        </div>
      )}
    </div>
  );
}

export const linesSearchSchema = (raw: Record<string, unknown>): LinesSearch => ({
  q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
  status: typeof raw.status === 'string' ? raw.status : undefined,
  tag: typeof raw.tag === 'string' ? raw.tag : undefined,
  page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
  line: typeof raw.line === 'string' ? raw.line : undefined,
});
