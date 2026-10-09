import { useSyncExternalStore } from 'react';

/** Chat dock visibility is a per-browser preference, kept outside the URL so it never adds history entries. */
const KEY = 'tw.chat.open';
let open = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export const chatDock = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => open,
  set(next: boolean) {
    open = next;
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
    listeners.forEach((listener) => listener());
  },
  toggle: () => chatDock.set(!open),
};

export const useChatDockOpen = () => useSyncExternalStore(chatDock.subscribe, chatDock.get);
