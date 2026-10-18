import { useSyncExternalStore } from 'react';

/**
 * Light (A Slate) or dark (C Night) theme: the `dark` class on <html> (tokens in packages/ui tokens/theme.css).
 * The choice is per browser (localStorage), `system` follows the OS. index.html applies it before first
 * paint with the same key, so keep the two in step.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'tw.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: this page only */
  }
  apply(choice);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onSystem = () => {
    if (readTheme() === 'system') apply('system');
    listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      apply(readTheme());
      listener();
    }
  };
  media().addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    media().removeEventListener('change', onSystem);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, readTheme, () => 'system');
}
