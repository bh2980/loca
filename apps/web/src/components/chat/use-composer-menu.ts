import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ATTACH_KINDS, runKindsLeft, shortLabel, type AttachKind, type ChatChip } from '@tw/shared';
import { allCommands, filterCommands, findAtTrigger, findSlashTrigger, narrowAtTrigger, openNextTarget, parseAtQuery, removeAtTrigger, replaceAtTrigger, type Command, type WorkflowCommand } from '@/lib/chat-triggers';
import { chipHref } from '@/lib/chat-links';
import { keyLabel } from '@/lib/keys';
import { q } from '@/lib/queries';
import type { ViewItem } from '@/lib/view-context';
import { useDebounced } from './conversation-menu';
import type { ComposerGroup, ComposerRow } from '@loca/ui';
import { useWorkflows } from '@/lib/workflows';

/** A /workflow that is waiting for its target: what has been picked so far. */
export interface RunMode {
  command: WorkflowCommand;
  chips: ChatChip[];
}

const sameChip = (a: { kind: string; id: string }, b: { kind: string; id: string }) => a.kind === b.kind && a.id === b.id;

/**
 * The @ (attach) and / (commands) lists over the chat box (docs/CHAT-INPUT-DESIGN.md 2, 3): what is shown
 * follows from the text and the caret, so Back, Backspace and the paperclip all work on the text itself.
 * The box keeps focus; `onKeyDown` is called first from its key handler and says whether it took the key.
 */
export function useComposerMenu(args: {
  projectId: string;
  input: string;
  caret: number;
  /** Puts new text in the box with the caret, and focuses it. */
  put: (value: string, caret: number) => void;
  box: RefObject<HTMLTextAreaElement | null>;
  /** What the page reports (useReportView): the first thing @ offers. */
  onPage: ViewItem[];
  picked: ChatChip[];
  setPicked: (update: (list: ChatChip[]) => ChatChip[]) => void;
  run: RunMode | null;
  setRun: (run: RunMode | null) => void;
  /** Where a saved prompt's `{대상}` was opened as an @: that @ takes the pick's short name instead of vanishing. */
  slot: number | null;
  setSlot: (start: number | null) => void;
}) {
  const { projectId, input, caret, put, onPage, picked, setPicked, run, setRun, slot, setSlot } = args;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>();

  const allowed: readonly AttachKind[] = run ? runKindsLeft(run.command.input, run.chips) : ATTACH_KINDS;
  const at = findAtTrigger(input, caret);
  const slash = at || run ? null : findSlashTrigger(input, caret);
  const parsed = at ? parseAtQuery(at.query, allowed) : null;
  const kind = parsed?.kind ?? null;
  const term = parsed?.term.trim() ?? '';
  const triggerKey = at ? `at:${at.start}` : slash ? 'slash' : null;
  useEffect(() => {
    if (!triggerKey) setDismissed(null);
  }, [triggerKey]);

  const workflows = useWorkflows(projectId);
  const prompts = useQuery(q.prompts(projectId));
  const commands = allCommands(workflows.data ?? [], prompts.data ?? []);
  const shownCommands = slash ? filterCommands(commands, slash.query) : [];
  // A message that merely starts with a slash and has no command to match is a message, not a search.
  const commandMenu = slash !== null && (shownCommands.length > 0 || !/\s/.test(slash.query));
  const menuShown = triggerKey !== null && dismissed !== triggerKey && (at !== null || commandMenu);

  const debounced = useDebounced(term, 150);
  const combined = useQuery({ ...q.attach(projectId, debounced), enabled: menuShown && at !== null && kind === null && term !== '' });
  const inKind = useInfiniteQuery({ ...q.attachKind(projectId, kind ?? '대사', debounced), enabled: menuShown && kind !== null });

  const taken = (run ? run.chips : picked);
  const chips = new Map<string, ChatChip>();
  const groups: ComposerGroup[] = [];
  const chipRow = (type: 'screen' | 'item', chip: ChatChip, tag?: string): ComposerRow => {
    const id = `${type}:${chip.kind}:${chip.id}`;
    chips.set(id, chip);
    return { id, type, label: shortLabel(chip.label, 60), detail: chip.detail, tag };
  };
  if (menuShown && at) {
    if (kind) {
      const rows = (inKind.data?.pages ?? []).flatMap((page) => page.groups.flatMap((group) => group.items)).filter((item) => !taken.some((chip) => sameChip(chip, item)));
      const items = rows.map((item) => chipRow('item', { kind: item.kind, id: item.id, label: item.label, detail: item.detail, href: item.href }));
      if (inKind.hasNextPage) items.push({ id: `more:${kind}`, type: 'more', label: '더 보기', busy: inKind.isFetchingNextPage });
      groups.push({ key: kind, heading: kind, rows: items });
    } else if (term === '') {
      const screen = onPage.filter((item) => (run ? (allowed as readonly string[]).includes(item.kind) : true) && !taken.some((chip) => sameChip(chip, item)));
      if (screen.length) groups.push({ key: 'screen', heading: '지금 화면', rows: screen.map((item) => chipRow('screen', { kind: item.kind, id: item.id, label: item.label, detail: item.detail && !item.detail.startsWith('{') ? item.detail : undefined, href: chipHref(projectId, item) }, item.kind)) });
      groups.push({ key: 'kinds', heading: '종류', rows: allowed.map((value) => ({ id: `kind:${value}`, type: 'kind', label: value })) });
    } else {
      for (const group of combined.data?.groups ?? []) {
        if (!allowed.includes(group.kind)) continue;
        const items = group.items.filter((item) => !taken.some((chip) => sameChip(chip, item))).map((item) => chipRow('item', { kind: item.kind, id: item.id, label: item.label, detail: item.detail, href: item.href }));
        if (items.length) groups.push({ key: group.kind, rows: [{ id: `header:${group.kind}`, type: 'header', label: group.kind, detail: `${keyLabel('Tab')} 이 종류만 보기${group.more ? ' · 더 있음' : ''}` }, ...items] });
      }
    }
  } else if (menuShown && slash) {
    const rowOf = (command: Command): ComposerRow => ({ id: `command:${command.id}`, type: 'command', label: `/${command.name}`, detail: command.kind === 'workflow' ? command.blocked ?? command.description : command.description });
    const flows = shownCommands.filter((command) => command.kind === 'workflow');
    const saved = shownCommands.filter((command) => command.kind === 'prompt');
    if (flows.length) groups.push({ key: 'workflows', heading: '워크플로', rows: flows.map(rowOf) });
    if (saved.length) groups.push({ key: 'prompts', heading: '저장한 지시', rows: saved.map(rowOf) });
  }

  const rows = groups.flatMap((group) => group.rows);
  // With nothing chosen yet, Enter takes the first thing that can be attached, not a kind's title above it.
  const active = rows.find((row) => row.id === activeId) ?? rows.find((row) => row.type === 'item' || row.type === 'screen' || row.type === 'command') ?? rows[0];
  useEffect(() => setActiveId(undefined), [triggerKey, at?.query, slash?.query]);

  const loading = at !== null && (kind ? inKind.isFetching : term !== '' && combined.isFetching);
  const empty = at ? (kind ? '찾은 항목이 없습니다.' : term ? '찾은 항목이 없습니다.' : '붙일 종류가 없습니다.') : '맞는 명령이 없습니다.';
  const hint = at
    ? kind
      ? `${keyLabel('Up')}${keyLabel('Down')} 이동 · ${keyLabel('Enter')} 선택 · ${keyLabel('Shift+Tab')} 또는 ${keyLabel('Backspace')}(검색어가 비었을 때) 종류 목록으로 · ${keyLabel('Esc')} 닫기`
      : term === ''
        ? `${keyLabel('Up')}${keyLabel('Down')} 이동 · ${keyLabel('Enter')} 선택 (종류는 그 종류만 보기) · 글자를 치면 모든 종류에서 찾기 · ${keyLabel('Esc')} 닫기`
        : `${keyLabel('Up')}${keyLabel('Down')} 이동 · ${keyLabel('Enter')} 선택 · 제목 줄에서 ${keyLabel('Tab')}: 그 종류만 · ${keyLabel('Esc')} 닫기`
    : `${keyLabel('Up')}${keyLabel('Down')} 이동 · ${keyLabel('Enter')} 선택 · ${keyLabel('Esc')} 닫기`;

  const addChip = (chip: ChatChip) => {
    if (!at) return;
    if (run) {
      if (!run.chips.some((other) => sameChip(other, chip))) setRun({ ...run, chips: [...run.chips, chip] });
    } else setPicked((list) => (list.some((other) => sameChip(other, chip)) ? list : [...list, chip]));
    if (slot !== null && slot === at.start && !run) {
      // The prompt's {대상} slot: the pick's short name stands in its place, and the next {대상} (if any) opens.
      const filled = replaceAtTrigger(input, at, caret, shortLabel(chip.label));
      const next = openNextTarget(filled.value);
      setSlot(next ? next.start : null);
      return next ? put(next.value, next.caret) : put(filled.value, filled.caret);
    }
    const next = removeAtTrigger(input, at, caret);
    put(next.value, next.caret);
  };
  const narrow = (value: AttachKind | null) => {
    if (!at) return;
    const next = narrowAtTrigger(input, at, caret, value, term);
    put(next.value, next.caret);
  };
  const pickCommand = (command: Command) => {
    if (command.kind === 'workflow') {
      if (command.blocked) return void toast.error(command.blocked);
      // The target comes next: the @ list, limited to what the workflow can run on.
      setRun({ command, chips: [] });
      return put('@', 1);
    }
    const next = openNextTarget(command.text);
    setSlot(next ? next.start : null);
    if (next) put(next.value, next.caret);
    else put(command.text, command.text.length);
  };
  const pickRow = (row: ComposerRow) => {
    if (row.type === 'command') {
      const command = shownCommands.find((candidate) => `command:${candidate.id}` === row.id);
      if (command) pickCommand(command);
    } else if (row.type === 'kind') narrow(row.label as AttachKind);
    else if (row.type === 'header') narrow(row.label as AttachKind);
    else if (row.type === 'more') void inKind.fetchNextPage();
    else {
      const chip = chips.get(row.id);
      if (chip) addChip(chip);
    }
  };

  /** True when the key was the list's. Called before the box's own handling of the key. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (!menuShown || composing || event.altKey || event.ctrlKey || event.metaKey) return false;
    const take = () => event.preventDefault();
    if (event.key === 'Tab' && event.shiftKey) {
      // One level up: out of a kind to the list of kinds (the search text stays), out of the list altogether.
      take();
      if (at && kind) narrow(null);
      else setDismissed(triggerKey);
      return true;
    }
    if (event.shiftKey) return false;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length) {
      take();
      const at$ = active ? rows.indexOf(active) : -1;
      setActiveId(rows[(at$ + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].id);
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && active) {
      take();
      pickRow(active);
      return true;
    }
    if (event.key === 'Escape') {
      // Closes the list only; a second Esc does what Esc does without one.
      take();
      setDismissed(triggerKey);
      return true;
    }
    if (event.key === 'Backspace' && at && kind && term === '' && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      take();
      narrow(null);
      return true;
    }
    return false;
  };

  return {
    menuShown,
    groups,
    activeId: active?.id,
    setActiveId,
    pickRow,
    onKeyDown,
    loading,
    empty,
    hint,
    title: at ? '첨부할 항목' : '명령',
    /** Opens the list again after Esc (the paperclip). */
    reopen: () => setDismissed(null),
    atOpen: at !== null,
    commands,
  };
}
