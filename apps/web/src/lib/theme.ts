import { useSyncExternalStore } from 'react';
import { stored, STORED } from './storage';

/**
 * Light (A Slate) or dark (C Night) theme: the `dark` class on <html> (tokens in packages/ui tokens/theme.css).
 * The choice is per browser (STORED.theme, lib/storage.ts), `system` follows the OS. index.html applies it before
 * first paint from the same key and encoding (`loca.theme`, a JSON string), so keep the two in step.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
const slot = stored(STORED.theme);
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Nothing kept: the OS decides. */
export const readTheme = (): ThemeChoice => slot.read() ?? 'system';

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(choice: ThemeChoice) {
  slot.write(choice === 'system' ? null : choice);
  apply(choice);
}

function subscribe(listener: () => void) {
  // The choice changed (here or in another tab), or the OS's did: the class follows, then the readers draw again.
  const onChange = () => {
    apply(readTheme());
    listener();
  };
  const stop = slot.subscribe(onChange);
  media().addEventListener('change', onChange);
  return () => {
    stop();
    media().removeEventListener('change', onChange);
  };
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, readTheme, () => 'system');
}

const isDark = () => document.documentElement.classList.contains('dark');

/** Whether the dark theme is showing now (the choice resolved against the OS), for libraries that take a mode (React Flow). */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}
