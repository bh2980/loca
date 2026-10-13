import { useCallback, useSyncExternalStore } from 'react';

/**
 * Rows picked by checkbox, kept in sessionStorage per screen so Back/Forward and reloads bring them
 * back. The key names the list (screen + project + tab/group where picks belong to one list).
 */
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; set: ReadonlySet<string> }>();
const EMPTY: ReadonlySet<string> = new Set();
const storageKey = (key: string) => `tw.picked.${key}`;

function read(key: string): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(storageKey(key));
  } catch {
    // Storage blocked: fall back to what this page holds.
    return cache.get(key)?.set ?? EMPTY;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.set;
  let set: ReadonlySet<string> = EMPTY;
  if (raw) {
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids) && ids.length) set = new Set(ids.filter((id): id is string => typeof id === 'string'));
    } catch {
      /* corrupt: treat as empty */
    }
  }
  cache.set(key, { raw, set });
  return set;
}

function write(key: string, ids: ReadonlySet<string>) {
  const raw = ids.size ? JSON.stringify([...ids]) : null;
  try {
    if (raw === null) sessionStorage.removeItem(storageKey(key));
    else sessionStorage.setItem(storageKey(key), raw);
  } catch {
    /* private mode */
  }
  cache.set(key, { raw, set: ids });
  listeners.get(key)?.forEach((listener) => listener());
}

export function usePicked(key: string) {
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
  const picked = useSyncExternalStore(subscribe, () => read(key)) as ReadonlySet<string>;
  const pick = useCallback(
    (ids: string[], on: boolean) => {
      const next = new Set(read(key));
      for (const id of ids) if (on) next.add(id);
      else next.delete(id);
      write(key, next);
    },
    [key],
  );
  const clear = useCallback(() => write(key, EMPTY), [key]);
  return { picked, pick, clear };
}
