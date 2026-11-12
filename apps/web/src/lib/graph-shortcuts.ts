import { ownsKeys } from '@/lib/keys';
import { keyOf, useShortcuts } from '@/lib/shortcuts';

/**
 * What a graph can do from the keyboard. Every graph uses this one map, so the same keys do the same
 * thing everywhere; a graph leaves out what it cannot do (a view-only graph passes none).
 */
export interface GraphShortcuts {
  /** ⌘/Ctrl+Z */
  undo?: () => void;
  /** ⌘/Ctrl+Shift+Z, Ctrl+Y */
  redo?: () => void;
  /** ⌘/Ctrl+C */
  copy?: () => void;
  /** ⌘/Ctrl+X */
  cut?: () => void;
  /** ⌘/Ctrl+V */
  paste?: () => void;
  /** Delete, Backspace */
  remove?: () => void;
  /** ⌘/Ctrl+Shift+G: takes the picked container away and keeps what it holds (a workflow frame). */
  ungroup?: () => void;
}

/** The shortcut hints a graph's menus show, in keyLabel form. */
export const GRAPH_KEYS = { undo: keyOf('graphUndo'), redo: keyOf('graphRedo'), copy: keyOf('graphCopy'), cut: keyOf('graphCut'), paste: keyOf('graphPaste'), remove: keyOf('graphRemove'), ungroup: keyOf('frameUngroup') } as const;

/** Where the person last clicked: text picked in the chat leaves the focus on the page body. */
let lastPointer: EventTarget | null = null;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (event) => (lastPointer = event.target), true);
/** Text selected on the page: ⌘/Ctrl+C and X copy it, not the graph's nodes. */
const textPicked = () => Boolean(window.getSelection()?.toString());

/**
 * Listens for the shared graph keys while `enabled`; ⌘ on a Mac, Ctrl elsewhere (both work everywhere). Where typing
 * goes to a field, or a dialog, a menu or the chat panel has the keys, the graph does not act (the shortcuts' own rules).
 */
export function useGraphShortcuts(shortcuts: GraphShortcuts, enabled = true) {
  const act = (run: (() => void) | undefined) => run && (() => void run());
  const unlessText = (run: (() => void) | undefined) => run && (() => (textPicked() ? false : void run()));
  useShortcuts(
    {
      graphUndo: act(shortcuts.undo),
      graphRedo: act(shortcuts.redo),
      graphCopy: unlessText(shortcuts.copy),
      graphCut: unlessText(shortcuts.cut),
      graphPaste: act(shortcuts.paste),
      frameUngroup: act(shortcuts.ungroup),
      graphRemove: act(shortcuts.remove),
    },
    { enabled, when: () => !ownsKeys(lastPointer) },
  );
}
