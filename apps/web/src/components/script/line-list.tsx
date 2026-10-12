import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert, Play, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { LISTENER_MIN_CONFIDENCE, listenerLabel } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { HeaderFilter } from '@/components/header-filter';
import { LineDetail, LINE_TABS, type LineTab } from '@/components/line-detail';
import { SplitPane } from '@/components/split-pane';
import { StatusBadge, StatusDot, TagChip } from '@/components/status';
import { Pager, SearchInput, Toolbar } from '@/components/toolbar';
import { TranslationEditor } from '@/components/translation-editor';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const PAGE_SIZE = 100;

const ORIGIN_LABEL = { ai: 'AI', human: '사람', tool: '도구', import: '가져옴' } as const;

export interface LinesSearch {
  q?: string;
  status?: string;
  tag?: string;
  speaker?: string;
  /** A character name, or "-" for lines whose listener is unknown. */
  listener?: string;
  page?: number;
  line?: string;
  /** The line pane's tab and the AI node whose context it shows ("workflowId:nodeId"). */
  lineTab?: Exclude<LineTab, 'checks'>;
  aiNode?: string;
}

export const linesSearchSchema = (raw: Record<string, unknown>): LinesSearch => ({
  q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
  status: typeof raw.status === 'string' ? raw.status : undefined,
  tag: typeof raw.tag === 'string' ? raw.tag : undefined,
  speaker: typeof raw.speaker === 'string' && raw.speaker ? raw.speaker : undefined,
  listener: typeof raw.listener === 'string' && raw.listener ? raw.listener : undefined,
  page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
  line: typeof raw.line === 'string' ? raw.line : undefined,
  lineTab: typeof raw.lineTab === 'string' && LINE_TABS.includes(raw.lineTab as LineTab) && raw.lineTab !== 'checks' ? (raw.lineTab as LinesSearch['lineTab']) : undefined,
  aiNode: typeof raw.aiNode === 'string' && raw.aiNode.includes(':') ? raw.aiNode : undefined,
});

/** Who the line is addressed to. AI guesses are faint with their confidence; unsure ones count as unknown. */
export function ListenerCell({ line }: { line: { listener: string | null; listenerOrigin: 'import' | 'ai' | 'human' | null; listenerConfidence: number | null } }) {
  const name = line.listener ? listenerLabel(line.listener) : null;
  if (line.listenerOrigin === 'ai' && (line.listenerConfidence ?? 0) < LISTENER_MIN_CONFIDENCE)
    return (
      <span className="text-warning" title={`AI 추정: ${name ?? '모름'} (확신 ${(line.listenerConfidence ?? 0).toFixed(2)})`}>
        미상
      </span>
    );
  if (!name) return <span className="text-muted-foreground">—</span>;
  if (line.listenerOrigin === 'ai')
    return (
      <span className="text-muted-foreground" title={`AI 추정 (확신 ${(line.listenerConfidence ?? 0).toFixed(2)})`}>
        {name} · AI
      </span>
    );
  return <span>{name}</span>;
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The translation screen's line list: lines in script order, filtered by the column headers, with
 * the picked line's translation editable in its own row and its details in the pane beside it.
 * Keyboard: ↑↓ (or ⌥↑↓ while typing) moves between lines, ↵ starts editing, ⌘↵ saves and moves
 * the line on to its next status, then goes to the next line.
 */
export function LineList({
  projectId,
  groupId,
  review,
  kind,
  search,
  onSearch,
  heading,
  actions,
}: {
  projectId: string;
  groupId?: string;
  review?: boolean;
  kind?: 'scene' | 'document' | 'ui';
  search: LinesSearch;
  onSearch: (next: Partial<LinesSearch>, options?: { replace?: boolean }) => void;
  /** Left of the toolbar: what this list is (a group's title, "모든 대사"). */
  heading: ReactNode;
  actions?: ReactNode;
}) {
  const statuses = useQuery(q.statuses(projectId));
  const page = search.page ?? 0;
  const lines = useQuery(q.units(projectId, { groupId, kind, review: review ? '1' : undefined, q: search.q, statusId: search.status, tagId: search.tag, speaker: search.speaker, listener: search.listener, offset: page * PAGE_SIZE, limit: PAGE_SIZE }));
  const speakers = useQuery(q.speakers(projectId));
  const people = useQuery(q.characters(projectId));
  const statusList = useMemo(() => statuses.data?.statuses ?? [], [statuses.data]);
  const statusById = new Map(statusList.map((status) => [status.id, status]));
  const tagById = new Map(statuses.data?.tags.map((tag) => [tag.id, tag]));
  const rows = lines.data?.rows;
  const total = lines.data?.total ?? 0;
  const showScene = !groupId;
  // Bumped whenever the picked line's editor should take the focus; 0 = just looking.
  const [focusTick, setFocusTick] = useState(0);
  const setEditing = (edit: boolean) => setFocusTick((tick) => (edit ? tick + 1 : 0));

  // Picked lines (checkboxes) are separate from the line open in the pane, and survive paging.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const knownTags = useRef(new Map<string, string[]>());
  for (const row of rows ?? []) knownTags.current.set(row.id, row.tagIds);
  const tagState = (tagId: string): 'all' | 'some' | 'none' => {
    const flags = [...picked].map((id) => knownTags.current.get(id)?.includes(tagId) ?? false);
    return flags.every(Boolean) ? 'all' : flags.some(Boolean) ? 'some' : 'none';
  };
  const pick = (ids: string[], on: boolean) =>
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

  // Moving past the end of a page opens the next page and lands on its first (or last) line.
  const landing = useRef<'first' | 'last' | null>(null);
  useEffect(() => {
    if (!landing.current || !rows?.length || lines.isPlaceholderData) return;
    const target = landing.current === 'first' ? rows[0] : rows.at(-1)!;
    landing.current = null;
    onSearch({ line: target.id }, { replace: true });
  }, [rows, lines.isPlaceholderData, onSearch]);

  const select = (id: string | undefined, edit: boolean) => {
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
  // After ⌘↵ the line may leave the list (검토함); the next line is the one after it as it was.
  const advanceFrom = (id: string) => {
    if (!rows) return;
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0 && index + 1 < rows.length) select(rows[index + 1].id, true);
    else if (review && index > 0 && page + 1 >= Math.ceil(total / PAGE_SIZE)) select(rows[index - 1].id, true);
    else move(1, true);
  };

  const moveRef = useRef(move);
  moveRef.current = move;
  const selectedRef = useRef(search.line);
  selectedRef.current = search.line;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      const inField = typing(event.target);
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

  type Row = NonNullable<typeof rows>[number];
  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: 'source',
      meta: { wrap: true },
      header: () => (
        <span className="flex items-center gap-2">
          <HeaderFilter label="화자" value={search.speaker} onChange={(speaker) => onSearch({ speaker, page: undefined })} options={(speakers.data ?? []).filter((row) => row.speaker).map((row) => ({ value: row.speaker!, label: row.speaker, hint: row.lines }))} />
          <span className="text-muted-foreground/50">→</span>
          <HeaderFilter
            label="청자"
            value={search.listener}
            onChange={(listener) => onSearch({ listener, page: undefined })}
            options={[
              { value: '-', label: '미상', keywords: '미상 unknown' },
              ...(people.data?.characters ?? []).filter((c) => c.status === 'confirmed').map((c) => ({ value: c.name, label: c.name, hint: c.player ? '플레이어' : undefined })),
            ]}
          />
          <span className="text-muted-foreground/50">·</span>
          원문
        </span>
      ),
      cell: ({ row: { original: line } }) => (
        <div className="space-y-1">
          <p className="flex min-w-0 items-baseline gap-1 text-xs whitespace-nowrap">
            <span className="truncate font-medium">{line.speaker ?? <span className="font-normal text-muted-foreground">화자 없음</span>}</span>
            {line.kind === 'dialogue' && (
              <>
                <span className="text-muted-foreground">→</span>
                <span className="truncate">
                  <ListenerCell line={line} />
                </span>
              </>
            )}
            {showScene && (
              <span className="ml-auto truncate pl-2 text-muted-foreground" title={line.groupTitle}>
                {line.groupTitle}
              </span>
            )}
          </p>
          <p>{line.source}</p>
        </div>
      ),
    },
    {
      id: 'translation',
      meta: { wrap: true },
      header: '번역',
      cell: ({ row: { original: line } }) =>
        line.id === search.line ? (
          <TranslationEditor
            key={line.id}
            unit={line}
            statuses={statusList}
            focusKey={focusTick}
            onEscape={() => setEditing(false)}
            onDone={(advanced) => (advanced ? advanceFrom(line.id) : undefined)}
          />
        ) : (
          <div className="space-y-1">
            <p className={cn(!line.translation && 'text-muted-foreground')}>{line.translation ?? '—'}</p>
            {line.translation && line.origin && <p className="text-xs text-muted-foreground">{ORIGIN_LABEL[line.origin]}{line.model && ` · ${line.model}`}</p>}
            {review && !!line.lastRun?.issues.length && (
              <p className="flex items-start gap-1 text-xs text-warning">
                <CircleAlert className="mt-0.5 size-3 shrink-0" />
                <span className="line-clamp-2">{line.lastRun.issues.join(' · ')}</span>
              </p>
            )}
          </div>
        ),
    },
    {
      id: 'status',
      meta: { width: 128 },
      header: () => (
        <HeaderFilter
          label="상태"
          value={search.status}
          onChange={(status) => onSearch({ status, page: undefined })}
          options={statusList.map((status) => ({ value: status.id, keywords: status.name, label: <><StatusDot color={status.color} /> {status.name}</> }))}
          groups={[{ heading: '태그', value: search.tag, onChange: (tag) => onSearch({ tag, page: undefined }), options: (statuses.data?.tags ?? []).map((tag) => ({ value: tag.id, keywords: tag.name, label: `#${tag.name}` })) }]}
        />
      ),
      cell: ({ row: { original: line } }) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={statusById.get(line.statusId)} />
          {line.tagIds.map((id) => tagById.get(id)).filter(Boolean).map((tag) => <TagChip key={tag!.id} tag={tag!} />)}
        </div>
      ),
    },
  ];

  const filtered = Boolean(search.q || search.status || search.tag || search.speaker || search.listener);
  return (
    <SplitPane
      id="lines"
      defaultWidth="340px"
      className="h-full min-h-0"
      pane={
        search.line && (
          <LineDetail
            projectId={projectId}
            unitId={search.line}
            onClose={() => select(undefined, false)}
            showScene={showScene}
            tab={search.lineTab ?? 'checks'}
            onTab={(tab) => onSearch({ lineTab: tab === 'checks' ? undefined : tab }, { replace: true })}
            aiNode={search.aiNode}
            onAiNode={(aiNode) => onSearch({ aiNode }, { replace: true })}
          />
        )
      }
    >
      <Toolbar count={lines.data ? `${total.toLocaleString()}줄` : undefined} actions={actions}>
        <div className="mr-2 min-w-0">{heading}</div>
        <SearchInput value={search.q} onChange={(value) => onSearch({ q: value, page: undefined })} placeholder="원문·번역·화자·ID" />
        {filtered && (
          <Button variant="ghost" onClick={() => onSearch({ q: undefined, status: undefined, tag: undefined, speaker: undefined, listener: undefined, page: undefined })}>
            필터 지우기
          </Button>
        )}
      </Toolbar>
      <DataTable
        columns={columns}
        rows={rows}
        rowId={(line) => line.id}
        loading={!lines.data}
        selected={search.line}
        onRowClick={(line) => line.id !== search.line && select(line.id, true)}
        picked={picked}
        onPick={pick}
        empty={review ? '검토할 대사가 없습니다. ‘검토함에 표시’가 켜진 상태의 대사가 여기에 모입니다.' : filtered ? '조건에 맞는 대사가 없습니다.' : '대사가 없습니다.'}
        footer={
          <div className="flex shrink-0 items-center border-t">
            <p className="px-4 text-xs text-muted-foreground">↑↓ 줄 이동 · ↵ 편집 · ⌘S 저장 · ⌘↵ 다음 상태로 · Esc 편집 끝</p>
            <div className="ml-auto [&>div]:border-t-0">
              <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={(next) => onSearch({ page: next || undefined, line: undefined })} />
            </div>
          </div>
        }
        bulk={
          <>
            <RunDialog
              projectId={projectId}
              unitIds={[...picked]}
              trigger={
                <Button>
                  <Play /> 워크플로 실행
                </Button>
              }
            />
            <Select value="" onValueChange={(statusId) => setStatus.mutate(statusId)}>
              <SelectTrigger size="sm" className="w-36 bg-background">
                <SelectValue placeholder="상태 변경" />
              </SelectTrigger>
              <SelectContent>
                {statusList.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    <StatusDot color={status.color} /> {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!!statuses.data?.tags.length && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="bg-background">
                    <Tags /> 태그
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">선택한 {picked.size}개 대사의 태그</DropdownMenuLabel>
                  {statuses.data.tags.map((tag) => {
                    const state = tagState(tag.id);
                    return (
                      <DropdownMenuCheckboxItem
                        key={tag.id}
                        checked={state === 'all'}
                        // Keep the menu open so several tags can be toggled in a row.
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => setTag.mutate({ tagId: tag.id, add: state !== 'all' })}
                      >
                        <TagChip tag={tag} />
                        {state === 'some' && <span className="ml-auto text-xs text-muted-foreground">일부</span>}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
    </SplitPane>
  );
}
