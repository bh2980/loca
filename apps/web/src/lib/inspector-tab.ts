import { useCallback, useState } from 'react';

const key = (kind: string) => `tw.inspector.${kind}.tab`;

/**
 * Which tab an inspector opens on: the one the URL names (a shared link), else the one last used on this kind of
 * inspector, else the first. Anything that is not one of `tabs` is skipped.
 */
export function pickTab<T extends string>(tabs: readonly [T, ...T[]], url: unknown, stored: unknown): T {
  const known = (value: unknown): value is T => typeof value === 'string' && (tabs as readonly string[]).includes(value);
  if (known(url)) return url;
  if (known(stored)) return stored;
  return tabs[0];
}

const readStored = (kind: string) => {
  try {
    return window.localStorage.getItem(key(kind));
  } catch {
    return null;
  }
};

/**
 * An inspector's tab, remembered per kind (`tw.inspector.<kind>.tab`) so the next item opens where the last one was
 * left. When the URL carries the tab (`url` + `onUrl`), changing it writes the URL too.
 */
export function useInspectorTab<T extends string>(kind: string, tabs: readonly [T, ...T[]], url?: T, onUrl?: (tab: T) => void): [T, (tab: T) => void] {
  const [local, setLocal] = useState<T>(() => pickTab(tabs, undefined, readStored(kind)));
  const tab = pickTab(tabs, url, local);
  const setTab = useCallback(
    (next: T) => {
      setLocal(next);
      try {
        window.localStorage.setItem(key(kind), next);
      } catch {
        // Storage off: the tab still changes, it just is not remembered.
      }
      onUrl?.(next);
    },
    [kind, onUrl],
  );
  return [tab, setTab];
}
