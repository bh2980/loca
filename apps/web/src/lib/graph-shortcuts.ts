import { useEffect, useRef } from 'react';

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
}

/** The shortcut hints a graph's menus show, in keyLabel form. */
export const GRAPH_KEYS = { undo: 'Mod+Z', redo: 'Mod+Shift+Z', copy: 'Mod+C', cut: 'Mod+X', paste: 'Mod+V', remove: 'Delete' } as const;

/** Where typing goes to a field (or a dialog or menu has the keys), the graph does not act. */
const typingIn = (target: EventTarget | null) =>
  Boolean((target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"]'));

/** A region that keeps its own keys (the chat panel): marked `data-own-keys`. */
const ownKeys = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest?.('[data-own-keys]'));
/** Where the person last clicked: text picked in the chat leaves the focus on the page body. */
let lastPointer: EventTarget | null = null;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (event) => (lastPointer = event.target), true);
/** Text selected on the page: ⌘/Ctrl+C and X copy it, not the graph's nodes. */
const textPicked = () => Boolean(window.getSelection()?.toString());

/** Listens for the shared graph keys while `enabled`; ⌘ on a Mac, Ctrl elsewhere (both work everywhere). */
export function useGraphShortcuts(shortcuts: GraphShortcuts, enabled = true) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typingIn(event.target) || ownKeys(event.target) || ownKeys(lastPointer)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const act = (run: (() => void) | undefined) => {
        if (!run) return;
        event.preventDefault();
        run();
      };
      if (mod && key === 'z') return act(event.shiftKey ? latest.current.redo : latest.current.undo);
      if (mod && key === 'y') return act(latest.current.redo);
      if (mod && (key === 'c' || key === 'x') && textPicked()) return;
      if (mod && key === 'c') return act(latest.current.copy);
      if (mod && key === 'x') return act(latest.current.cut);
      if (mod && key === 'v') return act(latest.current.paste);
      if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) return act(latest.current.remove);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
