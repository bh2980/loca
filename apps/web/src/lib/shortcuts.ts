import { useEffect, useRef } from 'react';
import { inOverlay, isTyping, keyLabel, matchedKey, onControl, overlayOpen, ownsKeys, type KeyPress } from '@/lib/keys';

/**
 * Every keyboard shortcut of the app, declared once: the keys, what they do (as the shortcut list says it) and where
 * they act. Handlers take their keys from here (`useShortcuts` for the window, `matchedKey`/`codeMirrorKey` for a part
 * that reads its own key events), and the shortcut list (`?`) prints this table, so a key cannot work without being
 * listed or be listed without working (`shortcuts.test.ts` checks each one has a handler).
 */
export interface ShortcutSpec {
  section: ShortcutPlace;
  /** The combinations, in `keyLabel` spelling; a handler is told which one was pressed. */
  keys: readonly string[];
  /** What the list prints when it is not the keys one by one (a range: 'Alt+1…9'). */
  shown?: readonly string[];
  label: string;
  /** Acts while the caret is in a field. Without it: a combination with ⌘/Ctrl or Alt does, a plain key does not. */
  typing?: boolean;
  /** Acts everywhere: over an open dialog or menu, and from a region that keeps its own keys (the chat panel). */
  global?: boolean;
}

export const SHORTCUT_SECTIONS = ['어디서나', '번역 화면', '번역 편집기', '경로', '그래프 편집', '워크플로 그래프', '대사 그래프'] as const;
export type ShortcutPlace = (typeof SHORTCUT_SECTIONS)[number];

const spec = (section: ShortcutPlace, keys: string | readonly string[], label: string, more: Pick<ShortcutSpec, 'shown' | 'typing' | 'global'> = {}): ShortcutSpec => ({ section, keys: typeof keys === 'string' ? [keys] : keys, label, ...more });
const range = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

export const SHORTCUTS = {
  search: spec('어디서나', 'Mod+K', '장면·용어·인물·자료·대사 검색', { global: true }),
  chat: spec('어디서나', 'Mod+I', '에이전트 채팅 열기·닫기', { global: true }),
  attachToChat: spec('어디서나', 'Mod+Shift+I', '지금 화면의 항목을 채팅에 넣기', { global: true }),
  sidebar: spec('어디서나', 'Mod+B', '사이드바 접기·펴기', { global: true }),
  help: spec('어디서나', '?', '이 단축키 목록', { global: true }),

  lineMove: spec('번역 화면', ['Up', 'Down'], '줄 이동'),
  lineMoveTyping: spec('번역 화면', ['Alt+Up', 'Alt+Down'], '줄 이동 (편집 중에도)'),
  lineEdit: spec('번역 화면', 'Enter', '편집 시작'),
  findStep: spec('번역 화면', ['Alt+Up', 'Alt+Down'], '찾아가기 중에는 이전·다음 찾은 줄', { global: true }),
  sourceBack: spec('번역 화면', 'Esc', '원문 편집에서 묶음으로 돌아가기', { typing: true }),

  editorSave: spec('번역 편집기', 'Mod+S', '저장'),
  editorAdvance: spec('번역 편집기', 'Mod+Enter', '확정하고 다음 줄'),
  editorLeave: spec('번역 편집기', 'Esc', '편집 끝내기'),
  editorToken: spec('번역 편집기', range('Alt+', 9), '서식 넣기', { shown: ['Alt+1…9'] }),
  editorPlaceTags: spec('번역 편집기', 'Alt+T', '빠진 서식 제자리에'),
  editorPick: spec('번역 편집기', range('Alt+Shift+', 9), '제안 넣기', { shown: ['Alt+Shift+1…3'] }),
  editorCopySource: spec('번역 편집기', 'Mod+Shift+S', '원문 복사'),
  editorAssist: spec('번역 편집기', 'Alt+.', '다듬기 / AI 번역'),
  editorContinue: spec('번역 편집기', 'Alt+/', 'AI 자동완성'),
  editorTake: spec('번역 편집기', 'Tab', '흐린 글씨 받기'),
  editorTakeWord: spec('번역 편집기', 'Mod+Right', '흐린 글씨 한 단어 받기'),

  routeMove: spec('경로', ['Up', 'Down'], '목록의 줄 이동'),
  routeMoveTyping: spec('경로', ['Alt+Up', 'Alt+Down'], '편집 중 줄 이동'),
  routeEdit: spec('경로', 'Enter', '편집 시작'),
  routeNextUntranslated: spec('경로', 'Alt+N', '다음 미번역 줄'),
  routePreviousUntranslated: spec('경로', 'Alt+Shift+N', '이전 미번역 줄'),

  // A field has its own undo, copy and paste: these act on the graph only outside one.
  graphUndo: spec('그래프 편집', 'Mod+Z', '되돌리기', { typing: false }),
  graphRedo: spec('그래프 편집', ['Mod+Shift+Z', 'Mod+Y'], '다시 하기', { typing: false }),
  graphCopy: spec('그래프 편집', 'Mod+C', '고른 노드 복사', { typing: false }),
  graphCut: spec('그래프 편집', 'Mod+X', '고른 노드 잘라내기', { typing: false }),
  graphPaste: spec('그래프 편집', 'Mod+V', '붙여넣기', { typing: false }),
  graphRemove: spec('그래프 편집', ['Delete', 'Backspace'], '고른 노드·선 삭제 (워크플로 프레임은 안의 노드까지)', { shown: ['Delete'] }),

  frameUngroup: spec('워크플로 그래프', 'Mod+Shift+G', '고른 프레임만 삭제 (노드는 남음)', { typing: false }),
  exitPickCancel: spec('워크플로 그래프', 'Esc', '고른 끝 동작 붙이기 취소', { typing: true }),

  canvasOpen: spec('대사 그래프', 'Enter', '고른 노드 옆에 번역 카드'),
  cardStep: spec('대사 그래프', ['Alt+Up', 'Alt+Down'], '흐름을 따라 앞·다음 줄'),
  cardClose: spec('대사 그래프', 'Esc', '번역 카드 닫기'),
  canvasFit: spec('대사 그래프', 'F', '전체 맞춤'),
  canvasZoom: spec('대사 그래프', ['Plus', 'Minus'], '확대·축소'),
  canvasPan: spec('대사 그래프', ['Up', 'Down', 'Left', 'Right'], '화면 이동'),
  canvasDeselect: spec('대사 그래프', 'Esc', '선택 풀기'),
  collectStop: spec('대사 그래프', 'Esc', '노드 모으기 끝내기', { typing: true }),
} satisfies Record<string, ShortcutSpec>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** The first combination of a shortcut, for a hint beside its button or menu item: `keyLabel(keyOf('graphCopy'))`. */
export const keyOf = (id: ShortcutId): string => SHORTCUTS[id].keys[0]!;

/** The key that puts in format token `number` (the first nine have one). */
export const tokenKey = (number: number): string | undefined => SHORTCUTS.editorToken.keys[number - 1];

/** The shortcut list: every shortcut by where it works, its keys as the person's keyboard says them. */
export function shortcutSections(mac?: boolean): { title: ShortcutPlace; rows: { id: ShortcutId; label: string; keys: string[] }[] }[] {
  const ids = Object.keys(SHORTCUTS) as ShortcutId[];
  return SHORTCUT_SECTIONS.map((title) => ({
    title,
    rows: ids.filter((id) => SHORTCUTS[id].section === title).map((id) => {
      const shortcut: ShortcutSpec = SHORTCUTS[id];
      return { id, label: shortcut.label, keys: (shortcut.shown ?? shortcut.keys).map((combo) => keyLabel(combo, mac)) };
    }),
  }));
}

/** Where a key press comes from, as far as a shortcut's rules read it. */
export interface KeyOrigin {
  /** The caret is in a field. */
  typing: boolean;
  /** A dialog, menu or list has the keys: the press comes from inside one, or one is open and no field has the caret. */
  overlay: boolean;
  /** The press comes from a region that keeps its own keys. */
  own: boolean;
  /** The press is on a button or link, which Enter and Space press. */
  control: boolean;
}

const hasModifier = (combo: string) => /(?:^|\+)(?:Mod|Ctrl|Alt)\+/.test(combo);

/** Whether a shortcut acts on a press of `combo` that comes from `origin`. */
export function shortcutActs(shortcut: ShortcutSpec, combo: string, origin: KeyOrigin): boolean {
  if (origin.typing && !(shortcut.typing ?? hasModifier(combo))) return false;
  if ((origin.overlay || origin.own) && !shortcut.global) return false;
  if (origin.control && (combo === 'Enter' || combo === 'Space')) return false;
  return true;
}

/** The shortcut among `ids` (in their order) that the key press is and that acts where it comes from. */
export function pickShortcut(event: KeyPress, ids: readonly ShortcutId[], origin: KeyOrigin): { id: ShortcutId; combo: string } | undefined {
  for (const id of ids) {
    const shortcut: ShortcutSpec = SHORTCUTS[id];
    const combo = matchedKey(event, shortcut.keys);
    if (combo && shortcutActs(shortcut, combo, origin)) return { id, combo };
  }
  return undefined;
}

/** What a shortcut does; it is told which of its combinations was pressed. Returning `false` leaves the key to others. */
export type ShortcutHandler = (event: KeyboardEvent, combo: string) => unknown;
export type ShortcutHandlers = { [id in ShortcutId]?: ShortcutHandler | false | undefined };

const originOf = (event: KeyboardEvent): KeyOrigin => {
  const typing = isTyping(event.target);
  return { typing, overlay: inOverlay(event.target) || (!typing && overlayOpen()), own: ownsKeys(event.target), control: onControl(event.target) };
};

/**
 * Listens on the window for the shortcuts it is given handlers for, while `enabled`. A key another handler already
 * took (`defaultPrevented`) is left alone; a handler that takes the key stops the browser's own action. `when` narrows
 * where the whole set acts (a list that takes keys only from itself).
 */
export function useShortcuts(handlers: ShortcutHandlers, { enabled = true, when }: { enabled?: boolean; when?: (event: KeyboardEvent) => boolean } = {}) {
  const latest = useRef({ handlers, when });
  latest.current = { handlers, when };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { handlers, when } = latest.current;
      if (when && !when(event)) return;
      const origin = originOf(event);
      for (const id of Object.keys(handlers) as ShortcutId[]) {
        const run = handlers[id];
        if (!run || !pickShortcut(event, [id], origin)) continue;
        if (run(event, matchedKey(event, SHORTCUTS[id].keys)!) === false) continue;
        event.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
