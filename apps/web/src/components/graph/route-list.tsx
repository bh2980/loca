import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, GitFork } from 'lucide-react';
import { toast } from 'sonner';
import { isUnknownListener, listenerLabel, needsListener, PALETTE, SPECIAL_LISTENERS, TAG_SCOPES, type ReadingRouteFork } from '@tw/shared';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText, MarkedSourceText, TokenText } from '@/components/editor/source-text';
import { LineHints } from '@/components/script/line-row';
import { usePersonColors } from '@/lib/person-colors';
import { Box, Button, DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger, ForkOptionItem, Heading, Icon, Inline, ScriptReadingRow, Skeleton, Stack, TagChip, TagListEditor, Text, type StatusLike, VirtualItem } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { tokenPatternOf } from '@/lib/line-context';
import { keyLabel } from '@/lib/keys';
import { lineTags, q } from '@/lib/queries';
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
  const colorOf = usePersonColors(projectId);
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
    <Box role="listitem" paddingY="normal" paddingX="page">
      {stageLabel && <Heading as="h3" variant="group" minWidth={0} marginBottom="condensed" display="block">{stageLabel}</Heading>}
      {loadError ? (
        <Inline gap="normal" width="full" maxWidth="reading" role="alert">
          <Text as="p" variant="body" tone="danger">이 줄을 불러오지 못했습니다.</Text>
          <Button variant="outline" onClick={onRetry}>다시 시도</Button>
        </Inline>
      ) : <Skeleton height="placeholder-md" width="full" maxWidth="reading" aria-label="줄을 불러오는 중" />}
    </Box>
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
    <Inline wrap gap="tight" marginTop="tight" role="group" aria-label="이 줄의 태그" onClick={(event) => event.stopPropagation()}>
      <TagListEditor
        tags={orderedTags}
        allTags={tags}
        onToggle={handleToggleTag}
        onCreate={handleCreateTag}
        heading="대사 태그"
      />
    </Inline>
  );

  const tagRow = orderedTags.length > 0 ? (
    <Stack direction="row" wrap gap="tight" marginTop="tight" role="group" aria-label="이 줄의 태그">
      {orderedTags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
    </Stack>
  ) : null;

  const narration = row.kind === 'dialogue' && !row.speaker?.trim();
  const unknownListener = isUnknownListener(row, rules) || !row.listener;
  const said = needsListener(row, rules) || (Boolean(row.listener) && (row.listenerOrigin === 'human' || row.listenerOrigin === 'import'));
  const listener = said ? (unknownListener ? null : listenerLabel(row.listener!)) : undefined;
  const listenerIsPerson = !row.listener || (!Object.hasOwn(SPECIAL_LISTENERS, row.listener) && !unknownListener);
  // Same as the script list: glossary words are underlined in every line; the picked one gets their chips and the speech/relationship summary.
  const source = selected ? (
    <>
      <Text asChild preserveLines tone={narration ? 'muted' : undefined} leading={row.kind === 'document' ? 'relaxed' : undefined}><LineSourceText projectId={projectId} unitId={row.id} source={row.source} translation={row.translation} /></Text>
      <LineHints projectId={projectId} line={{ id: row.id, source: row.source, translation: row.translation, speaker: row.speaker, listener: row.listener, lastRun: null }} part="context" />
    </>
  ) : <Text asChild preserveLines tone={narration ? 'muted' : undefined} leading={row.kind === 'document' ? 'relaxed' : undefined}><MarkedSourceText projectId={projectId} text={row.source} pattern={tokenPattern} /></Text>;
  const translation = selected ? (
    <TranslationEditor key={`editor-${row.id}`} projectId={projectId} unit={row} statuses={statusList} focusKey={focusTick} marks={marks} onEscape={onEscape} onDone={onDone} />
  ) : (
    <>
      {row.translation ? (
        <Text asChild preserveLines><TokenText text={row.translation} source={row.source} pattern={tokenPattern} /></Text>
      ) : (
        <Text tone="subtle" userSelect="none">미번역</Text>
      )}
      {tagRow}
    </>
  );

  return (
    <div role="listitem" data-unit={row.id} data-selected={selected || undefined} onClick={() => !selected && onSelect()}>
      {stageLabel && <Heading as="h3" variant="group" minWidth={0} display="block" paddingX="page" paddingTop="normal">{stageLabel}</Heading>}
      <ScriptReadingRow speaker={row.speaker} speakerColor={colorOf(row.speaker)} listener={listener} listenerIsPerson={listenerIsPerson} status={status} statusBy={row.statusBy} source={source} translation={translation} selected={selected} />
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
    <Stack height="full" minHeight={0} data-testid="route-list" data-lines={sequence.length}>
      <Inline wrap gap="condensed" shrink={false} border="bottom" paddingX="comfortable" paddingY="snug">
        <Text variant="caption" tone="muted" tabular truncate minWidth={0} grow data-testid="route-list-count">
          {sequence.length.toLocaleString()}줄 · 미번역 {remaining.toLocaleString()}
        </Text>
        <Button variant="ghost" disabled={previousUntranslated === undefined} title={`앞의 미번역 줄 (${keyLabel('Alt+Shift+N')})`} onClick={() => goUntranslated(-1)}>
          <ChevronUp /> 이전 미번역
        </Button>
        <Button variant="ghost" disabled={nextUntranslated === undefined} title={`뒤의 미번역 줄 (${keyLabel('Alt+N')})`} onClick={() => goUntranslated(1)}>
          <ChevronDown /> 다음 미번역
        </Button>
      </Inline>
      {forks && forks.length > 0 && (
        <Inline gap="condensed" shrink={false} border="bottom" background="faint" paddingX="comfortable" paddingY="tight" overflow="x" data-testid="route-forks">
          <Inline as="span" gap="snug" shrink={false} variant="caption" weight="medium" tone="muted">
            <Icon icon={GitFork} size="sm" />
            갈림길 ({forks.length})
          </Inline>
          {forks.length === 1 ? (
            (() => {
              const fork = forks[0]!;
              const selectedOption = fork.options.find((opt) => opt.targetId === fork.selectedId) ?? fork.options[0];
              const forkTitle = fork.label && !fork.label.startsWith('Sibling') ? fork.label : '분기 1';
              return (
                <DropdownMenu key={fork.nodeId}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" shrink={false}>
                      <Text truncate maxWidth="label-lg">
                        {forkTitle}: {selectedOption?.label ?? '선택'} ({fork.options.length}갈래)
                      </Text>
                      <Icon icon={ChevronDown} size="xs" marginLeft="tight" opacity={60} />
                    </Button>
                  </DropdownMenuTrigger>
                  <Box asChild width="popover">
                    <DropdownMenuContent align="start">
                      <Text asChild variant="caption" tone="muted">
                        <DropdownMenuLabel>
                          {forkTitle} 선택 ({fork.options.length}갈래)
                        </DropdownMenuLabel>
                      </Text>
                      {fork.options.map((opt) => (
                        <ForkOptionItem key={opt.targetId} label={opt.label} preview={opt.preview} selected={opt.targetId === fork.selectedId} onSelect={() => onPickFork?.(fork.nodeId, opt.targetId)} />
                      ))}
                    </DropdownMenuContent>
                  </Box>
                </DropdownMenu>
              );
            })()
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" shrink={false}>
                    <span>갈림길 {forks.length}곳 선택</span>
                    <Icon icon={ChevronDown} size="xs" marginLeft="tight" opacity={60} />
                  </Button>
                </DropdownMenuTrigger>
                <Box asChild maxHeight="scroll-3xl" width="popover" overflow="y">
                  <DropdownMenuContent align="start">
                    {forks.map((fork, idx) => {
                      const forkTitle = `분기 ${idx + 1}/${forks.length}${fork.label && !fork.label.startsWith('Sibling') ? ` · ${fork.label}` : ''}`;
                      return (
                        <Box key={fork.nodeId} border={idx > 0 ? 'top' : undefined} borderColor={idx > 0 ? 'subtle' : undefined} paddingTop={idx > 0 ? 'tight' : undefined} marginTop={idx > 0 ? 'tight' : undefined}>
                          <Text asChild variant="caption" tone="muted">
                            <DropdownMenuLabel>
                              {forkTitle}
                            </DropdownMenuLabel>
                          </Text>
                          {fork.options.map((opt) => (
                            <ForkOptionItem key={opt.targetId} label={opt.label} preview={opt.preview} selected={opt.targetId === fork.selectedId} onSelect={() => onPickFork?.(fork.nodeId, opt.targetId)} />
                          ))}
                        </Box>
                      );
                    })}
                  </DropdownMenuContent>
                </Box>
              </DropdownMenu>
              {forks.slice(0, 2).map((fork, idx) => {
                const selectedOption = fork.options.find((opt) => opt.targetId === fork.selectedId) ?? fork.options[0];
                const forkTitle = fork.label && !fork.label.startsWith('Sibling') ? fork.label : `분기 ${idx + 1}`;
                return (
                  <DropdownMenu key={fork.nodeId}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" shrink={false}>
                        <Text truncate maxWidth="label-sm">
                          {forkTitle}: {selectedOption?.label ?? '선택'}
                        </Text>
                        <Icon icon={ChevronDown} size="xs" marginLeft="tight" opacity={60} />
                      </Button>
                    </DropdownMenuTrigger>
                    <Box asChild width="popover">
                      <DropdownMenuContent align="start">
                        <Text asChild variant="caption" tone="muted">
                          <DropdownMenuLabel>
                            {forkTitle} 선택 ({fork.options.length}갈래)
                          </DropdownMenuLabel>
                        </Text>
                        {fork.options.map((opt) => (
                          <ForkOptionItem key={opt.targetId} label={opt.label} preview={opt.preview} selected={opt.targetId === fork.selectedId} onSelect={() => onPickFork?.(fork.nodeId, opt.targetId)} />
                        ))}
                      </DropdownMenuContent>
                    </Box>
                  </DropdownMenu>
                );
              })}
            </>
          )}
        </Inline>
      )}
      <Box ref={parent} minHeight={0} grow overflow="y" data-testid="route-scroll" onScroll={onScroll}>
        {sequence.length === 0 ? <Text as="p" variant="body" tone="muted" padding="spacious">이 길에는 대사가 없습니다.</Text> : (
          <Box role="list" position="relative" width="full" style={{ height: virtualizer.getTotalSize() }}>
            {virtual.map((entry) => (
              <VirtualItem key={entry.key} data-index={entry.index} ref={virtualizer.measureElement} style={{ transform: `translateY(${entry.start}px)` }}>
                {renderLine(entry.index)}
              </VirtualItem>
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
