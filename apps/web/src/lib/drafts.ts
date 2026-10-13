import { useCallback, useSyncExternalStore } from 'react';

/**
 * Unsaved edits survive navigation, Back/Forward and reloads (sessionStorage), and are never
 * overwritten by a server refetch: the draft only exists while it differs. Every component using
 * the same key sees the same draft as it is typed (the row editor and the line pane's checks).
 */
const listeners = new Map<string, Set<() => void>>();
const storageKey = (key: string) => `tw.draft.${key}`;

const read = (key: string) => {
  try {
    return sessionStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) sessionStorage.removeItem(storageKey(key));
    else sessionStorage.setItem(storageKey(key), value);
  } catch {
    /* private mode */
  }
  listeners.get(key)?.forEach((listener) => listener());
};

/**
 * The third item clears the draft. After a save, pass what was sent: the draft is cleared only if it
 * is still that text, so edits typed while the save was on its way are kept. Says whether it cleared.
 */
export function useDraft(key: string, saved: string): [string, (value: string) => void, (sent?: string) => boolean] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => {
        set.delete(listener);
      };
    },
    [key],
  );
  const draft = useSyncExternalStore(subscribe, () => read(key));
  const setDraft = useCallback((value: string) => write(key, value), [key]);
  const clear = useCallback((sent?: string) => {
    if (sent !== undefined && read(key) !== sent) return false;
    write(key, null);
    return true;
  }, [key]);
  return [draft ?? saved, setDraft, clear];
}
