/** The app runs on Windows and Linux as well: shortcut hints follow the platform. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent);

const MAC: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↵', Tab: 'Tab', Backspace: '⌫', Delete: 'Delete', Esc: 'Esc', Up: '↑', Down: '↓', Left: '←', Right: '→', Plus: '+', Minus: '-', Space: 'Space' };
const OTHER: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Esc: 'Esc', Up: '↑', Down: '↓', Left: '←', Right: '→', Plus: '+', Minus: '-', Space: 'Space' };

/** A shortcut as the user's keyboard says it: 'Mod+Shift+S' is ⌘⇧S on a Mac, Ctrl+Shift+S elsewhere. */
export function keyLabel(combo: string, mac = isMac) {
  const names = mac ? MAC : OTHER;
  const parts = combo.split('+').map((part) => names[part] ?? part.toUpperCase());
  return mac ? parts.join('') : parts.join('+');
}

/** What a key event says, as far as a shortcut reads it (a DOM or React keyboard event has all of these). */
export interface KeyPress {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const MODIFIERS = new Set(['Mod', 'Ctrl', 'Alt', 'Shift']);
/** The names a combination uses for keys that are not one character, and the `event.key` each one is. */
const NAMED: Record<string, string[]> = {
  Enter: ['Enter'], Tab: ['Tab'], Esc: ['Escape'], Backspace: ['Backspace'], Delete: ['Delete'], Space: [' '],
  Up: ['ArrowUp'], Down: ['ArrowDown'], Left: ['ArrowLeft'], Right: ['ArrowRight'],
  // '+' is the '=' key with Shift on most layouts; both zoom in.
  Plus: ['+', '='], Minus: ['-'],
};
/** The physical key of a character, for combinations with Alt. */
const CODE: Record<string, string> = { '.': 'Period', '/': 'Slash', ',': 'Comma', ';': 'Semicolon' };
const codeOf = (key: string) => (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : CODE[key]);

/**
 * Whether a key press is the combination ('Mod+Shift+S', 'Alt+Up', 'Enter', '?'). `Mod` is ⌘ or Ctrl on every
 * platform. The modifiers must be exactly the ones named, except Shift with a key that is a symbol (whether '?' or
 * '+' needs Shift depends on the layout). With Alt the key is read by its place on the keyboard: Alt turns letters
 * into other characters on a Mac, and a Korean input method sends them as composing keys.
 */
export function matchesKey(event: KeyPress, combo: string): boolean {
  const parts = combo.split('+');
  const key = parts[parts.length - 1]!;
  const wants = new Set(parts.slice(0, -1).filter((part) => MODIFIERS.has(part)));
  const mod = Boolean(event.metaKey || event.ctrlKey);
  if (wants.has('Mod')) {
    if (!mod) return false;
  } else if (wants.has('Ctrl')) {
    if (!event.ctrlKey || event.metaKey) return false;
  } else if (mod) return false;
  if (wants.has('Alt') !== Boolean(event.altKey)) return false;
  const named = NAMED[key];
  const symbol = named ? key === 'Plus' || key === 'Minus' : !/^[a-z0-9]$/i.test(key);
  if (!(symbol && !wants.has('Shift')) && wants.has('Shift') !== Boolean(event.shiftKey)) return false;
  if (named) return named.includes(event.key);
  if (event.altKey && event.code && codeOf(key)) return event.code === codeOf(key);
  return event.key.toLowerCase() === key.toLowerCase();
}

/** The first of the combinations the key press is. */
export const matchedKey = (event: KeyPress, combos: readonly string[]): string | undefined => combos.find((combo) => matchesKey(event, combo));

/** A combination in CodeMirror's keymap spelling: 'Mod+Shift+S' → 'Mod-Shift-s', 'Esc' → 'Escape', 'Right' → 'ArrowRight'. */
export function codeMirrorKey(combo: string): string {
  const parts = combo.split('+');
  const key = parts[parts.length - 1]!;
  const name = NAMED[key]?.[0] ?? (key.length === 1 ? key.toLowerCase() : key);
  return [...parts.slice(0, -1), name === ' ' ? 'Space' : name].join('-');
}

const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const CONTROL = 'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"]';
const closest = (target: EventTarget | null, selector: string) => Boolean((target as Element | null)?.closest?.(selector));

/** The key press goes to a field: the person is typing. */
export const isTyping = (target: EventTarget | null): boolean => closest(target, FIELD);
/** The key press is on a button, link or other control that Enter and Space press. */
export const onControl = (target: EventTarget | null): boolean => closest(target, CONTROL);
/** The key press comes from inside a dialog, menu or list that is open on top. */
export const inOverlay = (target: EventTarget | null): boolean => closest(target, OVERLAY);
/** A dialog, menu or list is open on top of the screen (it closes on its own Esc and moves on its own arrows). */
export const overlayOpen = (): boolean => typeof document !== 'undefined' && Boolean(document.querySelector(OVERLAY));
/** The key press comes from a region that keeps its own keys (the chat panel): marked `data-own-keys`. */
export const ownsKeys = (target: EventTarget | null): boolean => closest(target, '[data-own-keys]');
