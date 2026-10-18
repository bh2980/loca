import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, GitFork } from 'lucide-react';
import { toast } from 'sonner';
import { isUnknownListener, listenerLabel, needsListener, PALETTE, SPECIAL_LISTENERS, TAG_SCOPES, type ReadingRouteFork } from '@tw/shared';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText, MarkedSourceText, TokenText } from '@/components/editor/source-text';
import { LineHints } from '@/components/script/line-row';
import { Button, GroupHeading, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, ScriptReadingRow, Skeleton, TagChip, TagListEditor, type StatusLike } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { tokenPatternOf } from '@/lib/line-context';
import { keyLabel } from '@/lib/keys';
import { lineTags, q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import type { InferResponseType } from '@/lib/api';

type Row = InferResponseType<(typeof client.projects)[':projectId']['units']['by-ids']['$post']>['rows'][number];
type Status = Parameters<typeof TranslationEditor>[0]['statuses'][number];

/** Lines are loaded in bounded chunks around the virtualized reader viewport. */
const CHUNK = 40;
const scrollKey = (projectId: string, routeKey: string) => `tw.graph.route.reading.${projectId}.${encodeURIComponent(routeKey)}`;

function readScroll(key: string) {
  try {
    const value = Number(sessionStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeScroll(key: string, value: number) {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // Scroll restoration is a convenience when session storage is unavailable.
  }
}

function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));
}

function RouteLineRow({ projectId, row, selected, status, statusList, rules, tags, tokenPattern, focusTick, loadError, stageLabel, onRetry, onSelect, onEscape, onDone }: {
  projectId: string;
  row: Row | undefined;
  selected: boolean;
  status: StatusLike | undefined;
  statusList: Status[];
  rules: Parameters<typeof needsListener>[1];
  tags: (StatusLike & { role?: string | null })[];
  tokenPattern: RegExp | null;
  focusTick: number;
  loadError: boolean;
  stageLabel?: string;
  onRetry: () => void;
  onSelect: () => void;
  onEscape: () => void;
  onDone: (advanced: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[] }) => unwrap(client.units[':unitId'].$patch({ param: { unitId: row!.id }, json })),
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([row!.id], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['units', projectId] });
      if (row) queryClient.invalidateQueries({ queryKey: ['unit', row.id] });
    },
  });

  if (!row) return (
    <div role="listitem" className="px-4 py-3 sm:px-6">
      {stageLabel && <GroupHeading className="mb-2 block">{stageLabel}</GroupHeading>}
      {loadError ? (
        <div className="flex w-full max-w-4xl items-center gap-3" role="alert">
          <p className="text-sm text-destructive">이 줄을 불러오지 못했습니다.</p>
          <Button variant="outline" onClick={onRetry}>다시 시도</Button>
        </div>
      ) : <Skeleton className="h-28 w-full max-w-4xl" aria-label="줄을 불러오는 중" />}
    </div>
  );

  const attachedTags = row.tagIds ? tags.filter((tag) => row.tagIds.includes(tag.id)) : [];
  const orderedTags = [...attachedTags.filter((tag) => tag.role), ...attachedTags.filter((tag) => !tag.role)];

  const handleToggleTag = (tagId: string, add: boolean) => {
    const nextTagIds = add ? [...row.tagIds, tagId] : row.tagIds.filter((id) => id !== tagId);
    patch.mutate({ tagIds: nextTagIds });
  };

  const handleCreateTag = async (name: string) => {
    try {
      const color = (PALETTE[tags.length % PALETTE.length] as any).light ?? PALETTE[tags.length % PALETTE.length].hex;
      const res = await unwrap(client.projects[':projectId'].tags.$post({
        param: { projectId },
        json: { name, color, scope: [...TAG_SCOPES] },
      }));
      await patch.mutateAsync({ tagIds: [...row.tagIds, res.id] });
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const marks = (
    <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="이 줄의 태그" onClick={(event) => event.stopPropagation()}>
      <TagListEditor
        tags={orderedTags}
        allTags={tags}
        onToggle={handleToggleTag}
        onCreate={handleCreateTag}
        heading="대사 태그"
      />
    </div>
  );

  const tagRow = orderedTags.length > 0 ? (
    <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="이 줄의 태그">
      {orderedTags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
    </div>
  ) : null;

  const narration = row.kind === 'dialogue' && !row.speaker?.trim();
  const unknownListener = isUnknownListener(row, rules) || !row.listener;
  const said = needsListener(row, rules) || (Boolean(row.listener) && (row.listenerOrigin === 'human' || row.listenerOrigin === 'import'));
  const listener = said ? (unknownListener ? null : listenerLabel(row.listener!)) : undefined;
  const listenerIsPerson = !row.listener || (!Object.hasOwn(SPECIAL_LISTENERS, row.listener) && !unknownListener);
  const sourceClass = cn('whitespace-pre-wrap', narration && 'text-muted-foreground', row.kind === 'document' && 'leading-relaxed');
  // Same as the script list: glossary words are underlined in every line; the picked one gets their chips and the speech/relationship summary.
  const source = selected ? (
    <>
      <LineSourceText projectId={projectId} unitId={row.id} source={row.source} translation={row.translation} className={sourceClass} />
      <LineHints projectId={projectId} line={{ id: row.id, source: row.source, translation: row.translation, speaker: row.speaker, listener: row.listener, lastRun: null }} part="context" />
    </>
  ) : <MarkedSourceText projectId={projectId} text={row.source} pattern={tokenPattern} className={sourceClass} />;
  const translation = selected ? (
    <TranslationEditor key={`editor-${row.id}`} projectId={projectId} unit={row} statuses={statusList} focusKey={focusTick} marks={marks} onEscape={onEscape} onDone={onDone} />
  ) : (
    <>
      {row.translation ? (
        <TokenText text={row.translation} source={row.source} pattern={tokenPattern} className="whitespace-pre-wrap" />
      ) : (
        <span className="text-subtle-foreground select-none">미번역</span>
      )}
      {tagRow}
    </>
  );

  return (
    <div role="listitem" data-unit={row.id} data-selected={selected || undefined} onClick={() => !selected && onSelect()}>
      {stageLabel && <GroupHeading className="block px-4 pt-3 sm:px-6">{stageLabel}</GroupHeading>}
      <ScriptReadingRow speaker={row.speaker} listener={listener} listenerIsPerson={listenerIsPerson} status={status} statusBy={row.statusBy} source={source} translation={translation} selected={selected} />
    </div>
  );
}

/** A continuous, virtualized reading order for the current path. The URL owns the picked editor line. */
export function RouteList({ projectId, sequence, stages, routeKey, untranslatedIds, edit, onEdit, forks, onPickFork }: {
  projectId: string;
  sequence: { unitId: string; nodeId: string }[];
  stages: { id: string; nodeIds: string[]; unitIds: string[]; parallel: boolean }[];
  routeKey: string;
  untranslatedIds: string[];
  edit?: string;
  onEdit: (unitId: string | undefined) => void;
  forks?: ReadingRouteFork[];
  onPickFork?: (nodeId: string, targetId: string) => void;
}) {
  const statuses = useQuery(q.statuses(projectId));
  const statusList = useMemo(() => statuses.data?.statuses ?? [], [statuses.data]);
  const statusById = useMemo(() => new Map(statusList.map((status) => [status.id, status])), [statusList]);
  const tags = useMemo(() => lineTags(statuses.data?.tags), [statuses.data?.tags]);
  const project = useQuery(q.project(projectId));
  const rules = project.data?.formatRules ?? undefined;
  const tokenPattern = useMemo(() => tokenPatternOf(rules), [rules]);
  const indexById = useMemo(() => new Map(sequence.map((line, index) => [line.unitId, index] as const)), [sequence]);
  const parallelStageStarts = useMemo(() => new Map(stages.filter((stage) => stage.parallel && stage.unitIds.length > 0).map((stage) => [stage.unitIds[0]!, `함께 실행 · ${stage.unitIds.length.toLocaleString()}줄`] as const)), [stages]);
  const untranslated = useMemo(() => new Set(untranslatedIds), [untranslatedIds]);
  const remaining = useMemo(() => sequence.reduce((count, line) => count + Number(untranslated.has(line.unitId)), 0), [sequence, untranslated]);
  const parent = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sequence.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 104,
    getItemKey: (index) => sequence[index]?.unitId ?? index,
    overscan: 7,
  });
  const virtual = virtualizer.getVirtualItems();
  const chunks = new Set(virtual.map((entry) => Math.floor(entry.index / CHUNK)));
  const editIndex = edit ? indexById.get(edit) : undefined;
  if (editIndex !== undefined) chunks.add(Math.floor(editIndex / CHUNK));
  const chunkIndexes = [...chunks].filter((chunk) => chunk * CHUNK < sequence.length).sort((a, b) => a - b);
  const chunkIds = chunkIndexes.map((chunk) => sequence.slice(chunk * CHUNK, (chunk + 1) * CHUNK).map((line) => line.unitId));
  const results = useQueries({ queries: chunkIds.map((ids) => q.routeRows(projectId, ids)) });
  const rows = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const result of results) for (const row of result.data?.rows ?? []) byId.set(row.id, row);
    return byId;
  }, [results]);
  const resultByChunk = useMemo(() => new Map(chunkIndexes.map((chunk, index) => [chunk, results[index]] as const)), [chunkIndexes.join(','), results]);

  const currentScrollKey = scrollKey(projectId, routeKey);
  const scrollKeyRef = useRef(currentScrollKey);
  scrollKeyRef.current = currentScrollKey;
  const restored = useRef<string | undefined>(undefined);
  const jump = useCallback((index: number, align: 'start' | 'center' | 'auto') => {
    virtualizer.scrollToIndex(index, { align });
  }, [virtualizer]);
  useEffect(() => {
    const element = parent.current;
    if (!element || !sequence.length || restored.current === currentScrollKey) return;
    restored.current = currentScrollKey;
    element.scrollTop = readScroll(currentScrollKey);
  }, [currentScrollKey, sequence.length]);
  useEffect(() => {
    if (editIndex !== undefined) jump(editIndex, 'center');
  }, [editIndex, routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (edit && editIndex === undefined) onEdit(undefined);
  }, [edit, editIndex, onEdit]);

  const onScroll = useCallback(() => {
    const element = parent.current;
    if (element) writeScroll(scrollKeyRef.current, element.scrollTop);
  }, []);

  const [focusTick, setFocusTick] = useState(0);
  const select = useCallback((unitId: string | undefined, editing: boolean) => {
    setFocusTick((tick) => (editing ? tick + 1 : 0));
    onEdit(unitId);
  }, [onEdit]);

  const currentIndex = editIndex ?? virtualizer.range?.startIndex ?? 0;
  const adjacentUntranslated = (direction: 1 | -1) => {
    for (let index = currentIndex + direction; index >= 0 && index < sequence.length; index += direction) {
      if (untranslated.has(sequence[index]!.unitId)) return index;
    }
    return undefined;
  };
  const previousUntranslated = adjacentUntranslated(-1);
  const nextUntranslated = adjacentUntranslated(1);
  const goUntranslated = (direction: 1 | -1) => {
    const index = adjacentUntranslated(direction);
    if (index !== undefined) select(sequence[index]!.unitId, true);
    else toast(direction === 1 ? '이 길에는 뒤에 번역할 줄이 없습니다.' : '이 길에는 앞에 번역할 줄이 없습니다.');
  };
  const moveLine = (direction: 1 | -1, editing: boolean) => {
    const index = currentIndex + direction;
    if (index >= 0 && index < sequence.length) select(sequence[index]!.unitId, editing);
    else toast(direction === 1 ? '이 길의 마지막 줄입니다.' : '이 길의 첫 줄입니다.');
  };
  const keys = useRef({ moveLine, goUntranslated, edit, select });
  keys.current = { moveLine, goUntranslated, edit, select };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && target !== document.body && !target.closest('[data-testid="route-list"]')) return;
      if (target?.closest('button, a, select, [role="menu"], [role="listbox"], [role="dialog"], [data-route-inspector]')) return;
      const inField = typing(event.target);
      if (event.altKey && event.code === 'KeyN') {
        event.preventDefault();
        keys.current.goUntranslated(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === 'Enter') {
        if (!inField && keys.current.edit) (event.preventDefault(), keys.current.select(keys.current.edit, true));
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (inField ? !event.altKey : event.altKey) return;
      event.preventDefault();
      keys.current.moveLine(event.key === 'ArrowDown' ? 1 : -1, inField);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const renderLine = (index: number) => {
    const entry = sequence[index]!;
    const row = rows.get(entry.unitId);
    const chunk = Math.floor(index / CHUNK);
    const result = resultByChunk.get(chunk);
    return (
      <RouteLineRow
        key={entry.unitId}
        projectId={projectId}
        row={row}
        selected={entry.unitId === edit}
        status={row ? statusById.get(row.statusId) : undefined}
        statusList={statusList}
        rules={rules}
        tags={tags}
        tokenPattern={tokenPattern}
        focusTick={focusTick}
        loadError={Boolean(result?.isError && !row)}
        stageLabel={parallelStageStarts.get(entry.unitId)}
        onRetry={() => { void result?.refetch(); }}
        onSelect={() => select(entry.unitId, true)}
        onEscape={() => setFocusTick(0)}
        onDone={(advanced) => (advanced ? moveLine(1, true) : select(undefined, false))}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="route-list" data-lines={sequence.length}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums" data-testid="route-list-count">
          이번 길 {sequence.length.toLocaleString()}줄 · 번역 안 한 줄 {remaining.toLocaleString()}
        </span>
        <Button variant="ghost" disabled={previousUntranslated === undefined} title={`앞의 번역 안 한 줄 (${keyLabel('Alt+Shift+N')})`} onClick={() => goUntranslated(-1)}>
          <ChevronUp /> 이전 안 한 줄
        </Button>
        <Button variant="ghost" disabled={nextUntranslated === undefined} title={`뒤의 번역 안 한 줄 (${keyLabel('Alt+N')})`} onClick={() => goUntranslated(1)}>
          <ChevronDown /> 다음 안 한 줄
        </Button>
      </div>
      {forks && forks.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-4 py-1 overflow-x-auto" data-testid="route-forks">
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <GitFork className="size-3.5" />
            갈림길 ({forks.length})
          </span>
          {forks.length === 1 ? (
            (() => {
              const fork = forks[0]!;
              const selectedOption = fork.options.find((opt) => opt.targetId === fork.selectedId) ?? fork.options[0];
              const forkTitle = fork.label && !fork.label.startsWith('Sibling') ? fork.label : '분기 1';
              return (
                <DropdownMenu key={fork.nodeId}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="shrink-0">
                      <span className="max-w-[200px] truncate">
                        {forkTitle}: {selectedOption?.label ?? '선택'} ({fork.options.length}갈래)
                      </span>
                      <ChevronDown className="ml-1 size-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-80">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      {forkTitle} 선택 ({fork.options.length}갈래)
                    </DropdownMenuLabel>
                    {fork.options.map((opt) => {
                      const isSelected = opt.targetId === fork.selectedId;
                      return (
                        <DropdownMenuItem
                          key={opt.targetId}
                          onSelect={() => onPickFork?.(fork.nodeId, opt.targetId)}
                          className={cn(
                            'flex flex-col items-start gap-0.5 py-1.5 cursor-pointer',
                            isSelected && 'font-medium bg-muted/40'
                          )}
                        >
                          <div className="flex w-full items-center justify-between text-sm">
                            <span className="truncate font-medium">{opt.label}</span>
                            {isSelected && (
                              <span className="text-xs text-primary font-medium">선택됨</span>
                            )}
                          </div>
                          {opt.preview && opt.preview !== opt.label && (
                            <span className="line-clamp-2 text-xs text-muted-foreground font-normal">
                              {opt.preview}
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="shrink-0">
                    <span>갈림길 {forks.length}곳 선택</span>
                    <ChevronDown className="ml-1 size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
                  {forks.map((fork, idx) => {
                    const forkTitle = `분기 ${idx + 1}/${forks.length}${fork.label && !fork.label.startsWith('Sibling') ? ` · ${fork.label}` : ''}`;
                    return (
                      <div key={fork.nodeId} className={idx > 0 ? 'border-t border-border-subtle pt-1 mt-1' : ''}>
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {forkTitle}
                        </DropdownMenuLabel>
                        {fork.options.map((opt) => {
                          const isSelected = opt.targetId === fork.selectedId;
                          return (
                            <DropdownMenuItem
                              key={opt.targetId}
                              onSelect={() => onPickFork?.(fork.nodeId, opt.targetId)}
                              className={cn(
                                'flex flex-col items-start gap-0.5 py-1.5 cursor-pointer',
                                isSelected && 'font-medium bg-muted/40'
                              )}
                            >
                              <div className="flex w-full items-center justify-between text-sm">
                                <span className="truncate font-medium">{opt.label}</span>
                                {isSelected && (
                                  <span className="text-xs text-primary font-medium">선택됨</span>
                                )}
                              </div>
                              {opt.preview && opt.preview !== opt.label && (
                                <span className="line-clamp-2 text-xs text-muted-foreground font-normal">
                                  {opt.preview}
                                </span>
                              )}
                            </DropdownMenuItem>
                          );
                        })}
                      </div>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              {forks.slice(0, 2).map((fork, idx) => {
                const selectedOption = fork.options.find((opt) => opt.targetId === fork.selectedId) ?? fork.options[0];
                const forkTitle = fork.label && !fork.label.startsWith('Sibling') ? fork.label : `분기 ${idx + 1}`;
                return (
                  <DropdownMenu key={fork.nodeId}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="shrink-0">
                        <span className="max-w-[140px] truncate">
                          {forkTitle}: {selectedOption?.label ?? '선택'}
                        </span>
                        <ChevronDown className="ml-1 size-3 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-80">
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {forkTitle} 선택 ({fork.options.length}갈래)
                      </DropdownMenuLabel>
                      {fork.options.map((opt) => {
                        const isSelected = opt.targetId === fork.selectedId;
                        return (
                          <DropdownMenuItem
                            key={opt.targetId}
                            onSelect={() => onPickFork?.(fork.nodeId, opt.targetId)}
                            className={cn(
                              'flex flex-col items-start gap-0.5 py-1.5 cursor-pointer',
                              isSelected && 'font-medium bg-muted/40'
                            )}
                          >
                            <div className="flex w-full items-center justify-between text-sm">
                              <span className="truncate font-medium">{opt.label}</span>
                              {isSelected && (
                                <span className="text-xs text-primary font-medium">선택됨</span>
                              )}
                            </div>
                            {opt.preview && opt.preview !== opt.label && (
                              <span className="line-clamp-2 text-xs text-muted-foreground font-normal">
                                {opt.preview}
                              </span>
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </>
          )}
        </div>
      )}
      <div ref={parent} className="min-h-0 flex-1 overflow-y-auto" data-testid="route-scroll" onScroll={onScroll}>
        {sequence.length === 0 ? <p className="p-6 text-sm text-muted-foreground">이 길에는 대사가 없습니다.</p> : (
          <div role="list" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtual.map((entry) => (
              <div key={entry.key} data-index={entry.index} ref={virtualizer.measureElement} className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${entry.start}px)` }}>
                {renderLine(entry.index)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
