import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, ListChecks, MoreHorizontal, PanelRightOpen, Play, Sparkles, Tags, X } from 'lucide-react';
import { toast } from 'sonner';
import { checkFormat, LISTENER_MIN_CONFIDENCE, listenerLabel, mentions, SPEECH_LEVEL_LABELS, speechLevelOf } from '@tw/shared';
import { BulkBar } from '@/components/data-table';
import { LineDetail, LINE_TABS, type LineTab } from '@/components/line-detail';
import { SplitPane } from '@/components/split-pane';
import { AiMark, StatusDot, TagChip } from '@/components/status';
import { Pager, SearchInput, Toolbar } from '@/components/toolbar';
import { TranslationEditor } from '@/components/translation-editor';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const PAGE_SIZE = 100;

export interface LinesSearch {
  q?: string;
  status?: string;
  tag?: string;
  speaker?: string;
  /** A character name, or "-" for lines whose listener is unknown. */
  listener?: string;
  /** Only lines not in a final status yet. */
  remaining?: true;
  /** Only lines whose status a run set and no person has looked at since (✦). */
  by?: 'ai';
  page?: number;
  line?: string;
  /** The line's details pane is open (closed by default: the row itself is the editor). */
  detail?: true;
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
  remaining: raw.remaining === true || raw.remaining === 'true' ? true : undefined,
  by: raw.by === 'ai' ? 'ai' : undefined,
  page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
  line: typeof raw.line === 'string' ? raw.line : undefined,
  detail: raw.detail === true || raw.detail === 'true' ? true : undefined,
  lineTab: typeof raw.lineTab === 'string' && LINE_TABS.includes(raw.lineTab as LineTab) && raw.lineTab !== 'checks' ? (raw.lineTab as LinesSearch['lineTab']) : undefined,
  aiNode: typeof raw.aiNode === 'string' && raw.aiNode.includes(':') ? raw.aiNode : undefined,
});

/** Who the line is addressed to. Unsure AI guesses count as unknown. */
function listenerText(line: { listener: string | null; listenerOrigin: 'import' | 'ai' | 'human' | null; listenerConfidence: number | null }) {
  if (!line.listener || (line.listenerOrigin === 'ai' && (line.listenerConfidence ?? 0) < LISTENER_MIN_CONFIDENCE)) return { text: '청자 미상', unknown: true };
  return { text: listenerLabel(line.listener), unknown: false };
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The translation screen's lines: source on the left, translation on the right, in script order.
 * Only the picked line opens up — its editor and a short row of hints (speech rule, terms, format,
 * what the last run flagged). Everything else (listener, tags, candidates, AI context, history)
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
  actions,
  menu,
}: {
  projectId: string;
  groupId?: string;
  review?: boolean;
  kind?: 'scene' | 'document' | 'ui';
  search: LinesSearch;
  onSearch: (next: Partial<LinesSearch>, options?: { replace?: boolean }) => void;
  heading: ReactNode;
  actions?: ReactNode;
  /** Extra items for the "더 보기" menu (what this group can do besides translating). */
  menu?: ReactNode;
}) {
  const statuses = useQuery(q.statuses(projectId));
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
    q.units(projectId, { groupId, kind, review: review ? '1' : undefined, remaining: search.remaining ? '1' : undefined, by: search.by, q: search.q, statusId: search.status, tagId: search.tag, speaker: search.speaker, listener: search.listener, focus: focusing, offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
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
  // Bumped whenever the picked line's editor should take the focus; 0 = just looking.
  const [focusTick, setFocusTick] = useState(0);
  const setEditing = (edit: boolean) => setFocusTick((tick) => (edit ? tick + 1 : 0));

  // Picking several lines is a mode, so checkboxes don't clutter the everyday list.
  const [picking, setPicking] = useState(false);
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
  const stopPicking = () => {
    setPicking(false);
    setPicked(new Set());
  };
  const setStatus = useMutation({
    mutationFn: (statusId: string) => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...picked], statusId } })),
    onSuccess: () => toast.success(`${picked.size}개 대사의 상태를 바꿨습니다.`),
  });
  // 확인함: the statuses stay; a person now holds them, so the ✦ goes.
  const check = useMutation({
    mutationFn: (unitIds: string[]) => unwrap(client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds, checked: true } })),
    onSuccess: (_data, unitIds) => {
      toast.success(`${unitIds.length}개 대사를 확인했습니다.`);
      if (search.by) stopPicking();
    },
  });
  const pickedByAi = (rows ?? []).filter((row) => picked.has(row.id) && row.statusBy === 'ai').map((row) => row.id);
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
  // After ⌘↵ the line may leave the list (검토함, 남은 줄만); the next line is the one after it as it was.
  const advanceFrom = (id: string) => {
    if (!rows) return;
    const index = rows.findIndex((row) => row.id === id);
    const shrinking = review || search.remaining || search.by;
    if (index >= 0 && index + 1 < rows.length) select(rows[index + 1].id, true);
    else if (shrinking && index > 0 && page + 1 >= Math.ceil(total / PAGE_SIZE)) select(rows[index - 1].id, true);
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

  // Filters that came from elsewhere (home, search, a glossary link) show as removable chips.
  const chips = [
    search.status && { key: 'status', label: `상태: ${statusById.get(search.status)?.name ?? '?'}`, clear: { status: undefined } },
    search.tag && { key: 'tag', label: `태그: #${tagById.get(search.tag)?.name ?? '?'}`, clear: { tag: undefined } },
    search.speaker && { key: 'speaker', label: `화자: ${search.speaker}`, clear: { speaker: undefined } },
    search.listener && { key: 'listener', label: search.listener === '-' ? '청자 미상만' : `청자: ${search.listener}`, clear: { listener: undefined } },
  ].filter(Boolean) as { key: string; label: string; clear: Partial<LinesSearch> }[];

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
      <Toolbar
        actions={
          <>
            {actions}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="더 보기">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => (picking ? stopPicking() : setPicking(true))}>
                  <ListChecks /> {picking ? '선택 그만하기' : '여러 줄 선택'}
                </DropdownMenuItem>
                {menu}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <div className="mr-1 min-w-0">{heading}</div>
        <Button variant={search.remaining ? 'secondary' : 'outline'} aria-pressed={Boolean(search.remaining)} onClick={() => onSearch({ remaining: search.remaining ? undefined : true, page: undefined })}>
          {search.remaining && <Check />} 남은 줄만
        </Button>
        <Button variant={search.by ? 'secondary' : 'outline'} aria-pressed={Boolean(search.by)} title="워크플로가 상태를 정했고 아직 사람이 확인하지 않은 줄(✦)" onClick={() => onSearch({ by: search.by ? undefined : 'ai', page: undefined })}>
          {search.by ? <Check /> : <Sparkles />} AI가 정한 것만
        </Button>
        <SearchInput value={search.q} onChange={(value) => onSearch({ q: value, page: undefined })} placeholder="찾기" className="w-44" />
        {chips.map((chip) => (
          <Button key={chip.key} variant="secondary" onClick={() => onSearch({ ...chip.clear, page: undefined })} aria-label={`${chip.label} 필터 지우기`}>
            {chip.label} <X />
          </Button>
        ))}
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!rows ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">{review ? '검토할 대사가 없습니다.' : search.by ? 'AI가 정하고 확인하지 않은 줄이 없습니다.' : search.remaining ? '남은 줄이 없습니다. 모두 최종 상태입니다.' : '맞는 대사가 없습니다.'}</p>
        ) : (
          <ul>
            {rows.map((line) => {
              const selected = line.id === search.line;
              const status = statusById.get(line.statusId);
              const who = listenerText(line);
              return (
                <li
                  key={line.id}
                  ref={selected ? selectedRow : undefined}
                  onClick={() => !selected && select(line.id, true)}
                  className={cn('flex gap-3 border-b px-4 transition-colors', selected ? 'bg-muted/60 py-3 shadow-[inset_2px_0_0_var(--primary)]' : 'cursor-pointer py-2.5 hover:bg-muted/40')}
                  style={line.id === arrived ? { animation: 'line-arrived 2s ease-out' } : undefined}
                  onAnimationEnd={() => setArrived(undefined)}
                >
                  {picking && <Checkbox className="mt-1" aria-label={`${line.key} 선택`} checked={picked.has(line.id)} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => pick([line.id], Boolean(checked))} />}
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-6">
                    <div className="min-w-0">
                      <p className="mb-0.5 flex min-w-0 gap-1 text-xs text-muted-foreground">
                        <span className="truncate">{line.speaker ?? '지문'}</span>
                        {selected && line.kind === 'dialogue' && <span className={cn('truncate', who.unknown && 'text-warning')}>→ {who.text}</span>}
                        {showScene && <span className="ml-auto truncate pl-2">{line.groupTitle}</span>}
                      </p>
                      <p className={cn('break-words whitespace-pre-wrap', selected ? 'text-base' : 'text-sm')}>{line.source}</p>
                    </div>
                    <div className="min-w-0">
                      {selected ? (
                        <>
                          <TranslationEditor key={line.id} unit={line} statuses={statusList} focusKey={focusTick} onEscape={() => setEditing(false)} onDone={(advanced) => (advanced ? advanceFrom(line.id) : undefined)} />
                          <LineHints projectId={projectId} line={line} onDetail={(tab) => onSearch({ detail: true, lineTab: tab }, { replace: true })} />
                        </>
                      ) : (
                        <div className="flex gap-2 pt-4 text-sm">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="mt-1.5 flex">
                                <StatusDot color={status?.color ?? '#a1a1aa'} />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{status?.name}</TooltipContent>
                          </Tooltip>
                          {line.statusBy === 'ai' && <AiMark by="ai" className="mt-1 -ml-1" />}
                          <div className="min-w-0">
                            <p className={cn('break-words whitespace-pre-wrap', !line.translation && 'text-muted-foreground')}>{line.translation ?? '번역 없음'}</p>
                            {review && !!line.lastRun?.issues.length && (
                              <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                                <CircleAlert className="mt-0.5 size-3 shrink-0" />
                                <span className="line-clamp-2">{line.lastRun.issues[0]}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={(next) => onSearch({ page: next || undefined, line: undefined })} />
      {picking && (
        <BulkBar count={picked.size} onClear={stopPicking}>
          <Button variant="outline" disabled={!rows?.length} onClick={() => pick(rows?.map((row) => row.id) ?? [], true)}>
            이 페이지 모두
          </Button>
          {picked.size > 0 && (
            <>
              <Button variant="outline" className="bg-background" disabled={pickedByAi.length === 0 || check.isPending} title="상태는 그대로 두고 사람이 확인한 것으로 표시합니다(✦ 없앰)" onClick={() => check.mutate(pickedByAi)}>
                <Check /> 확인함{pickedByAi.length ? ` (${pickedByAi.length})` : ''}
              </Button>
              <RunDialog
                projectId={projectId}
                unitIds={[...picked]}
                trigger={
                  <Button>
                    <Play /> AI 실행
                  </Button>
                }
              />
              <Select value="" onValueChange={(statusId) => setStatus.mutate(statusId)}>
                <SelectTrigger size="sm" className="w-36 bg-background">
                  <SelectValue placeholder="상태 바꾸기" />
                </SelectTrigger>
                <SelectContent>
                  {statusList.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <StatusDot color={item.color} /> {item.name}
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
                        <DropdownMenuCheckboxItem key={tag.id} checked={state === 'all'} onSelect={(event) => event.preventDefault()} onCheckedChange={() => setTag.mutate({ tagId: tag.id, add: state !== 'all' })}>
                          <TagChip tag={tag} />
                          {state === 'some' && <span className="ml-auto text-xs text-muted-foreground">일부</span>}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </BulkBar>
      )}
    </SplitPane>
  );
}

/**
 * The few things worth knowing while typing, as one row under the editor: does the translation
 * keep the speech rule, the confirmed terms and the source's format, and what the last run said.
 * "자세히" opens everything else in the pane.
 */
function LineHints({ projectId, line, onDetail }: { projectId: string; line: { id: string; source: string; translation: string | null; lastRun: { issues: string[] } | null }; onDetail: (tab?: Exclude<LineTab, 'checks'>) => void }) {
  const unit = useQuery(q.unit(line.id));
  const terms = useQuery(q.terms(projectId));
  const project = useQuery(q.project(projectId));
  const [draft] = useDraft(`line:${line.id}`, line.translation ?? '');
  const text = draft.trim();
  const speech = unit.data?.speech;
  const guessed = text ? speechLevelOf(text) : null;
  const used = useMemo(() => (terms.data ?? []).filter((term) => term.status === 'confirmed' && term.target && mentions(line.source, term.source)), [terms.data, line.source]);
  const format = text ? checkFormat(line.source, draft, { placeholders: true, tags: true, newlines: true, emptyText: false }, project.data?.formatRules) : [];
  const others = (unit.data?.candidates.length ?? 0) - (line.translation ? 1 : 0);

  const hint = (key: string, ok: boolean | null, label: ReactNode, title?: string) => (
    <span key={key} title={title} className={cn('inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs', ok === false && 'border-warning/40 text-warning')}>
      {ok === true && <Check className="size-3 text-success" />}
      {ok === false && <CircleAlert className="size-3" />}
      {label}
    </span>
  );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      {speech && speech.level !== 'other' && hint('speech', guessed ? guessed === speech.level : null, `말투: ${SPEECH_LEVEL_LABELS[speech.level]}${guessed && guessed !== speech.level ? ` (지금 ${SPEECH_LEVEL_LABELS[guessed]})` : ''}`, speech.rule)}
      {used.map((term) => hint(term.id, text ? text.toLowerCase().includes(term.target.toLowerCase()) : null, `${term.source} → ${term.target}`))}
      {format.map((issue) => hint(issue.code, false, issue.message))}
      {line.lastRun?.issues.slice(0, 1).map((issue) => hint('run', false, issue))}
      {others > 0 && (
        <Button variant="ghost" size="inline" className="text-muted-foreground" onClick={() => onDetail('candidates')}>
          다른 후보 {others}개
        </Button>
      )}
      <Button variant="ghost" size="inline" className="ml-auto text-muted-foreground" onClick={() => onDetail()}>
        <PanelRightOpen /> 자세히
      </Button>
    </div>
  );
}
