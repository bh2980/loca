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
export function useDraft(key: string, saved: string): [string, (value: string) => void, (sent?: string) => boolean, string | null] {
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
  const snapshot = useSyncExternalStore(subscribe, () => JSON.stringify([read(key), read(`${key}:base`)]));
  const [draft, base] = JSON.parse(snapshot) as [string | null, string | null];
  const setDraft = useCallback((value: string) => {
    if (read(key) === null) write(`${key}:base`, saved);
    write(key, value);
  }, [key, saved]);
  const clear = useCallback((sent?: string) => {
    if (sent !== undefined && read(key) !== sent) {
      // A successful save becomes the base of typing that continued during the request.
      write(`${key}:base`, sent);
      listeners.get(key)?.forEach((listener) => listener());
      return false;
    }
    write(`${key}:base`, null);
    write(key, null);
    return true;
  }, [key]);
  return [draft ?? saved, setDraft, clear, draft === null ? saved : base];
}

/**
 * Which of several drafts differ from what is saved, kept current as they are typed (a pane's tab dots for editors
 * it does not show right now). Reads the same storage as useDraft.
 */
export function useDirtyDrafts(entries: readonly { key: string; saved: string }[]): boolean[] {
  const keys = entries.map((entry) => entry.key).join('\n');
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = keys ? keys.split('\n') : [];
      for (const key of list) {
        const set = listeners.get(key) ?? new Set();
        set.add(listener);
        listeners.set(key, set);
      }
      return () => {
        for (const key of list) listeners.get(key)?.delete(listener);
      };
    },
    [keys],
  );
  const snapshot = useSyncExternalStore(subscribe, () => entries.map((entry) => (read(entry.key) ?? entry.saved) !== entry.saved ? '1' : '0').join(''));
  return [...snapshot].map((flag) => flag === '1');
}
