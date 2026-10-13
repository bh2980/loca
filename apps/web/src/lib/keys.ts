/** The app runs on Windows and Linux as well: shortcut hints follow the platform. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent);

const MAC: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↵', Up: '↑', Down: '↓' };
const OTHER: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Up: '↑', Down: '↓' };

/** A shortcut as the user's keyboard says it: 'Mod+Shift+S' is ⌘⇧S on a Mac, Ctrl+Shift+S elsewhere. */
export function keyLabel(combo: string) {
  const names = isMac ? MAC : OTHER;
  const parts = combo.split('+').map((part) => names[part] ?? part.toUpperCase());
  return isMac ? parts.join('') : parts.join('+');
}
