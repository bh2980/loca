/** The app runs on Windows and Linux as well: shortcut hints follow the platform. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent);

const MAC: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↵', Up: '↑', Down: '↓', ArrowRight: '→' };
const OTHER: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Up: '↑', Down: '↓', ArrowRight: '→' };

/** A shortcut as the user's keyboard says it: 'Mod+Shift+S' is ⌘⇧S on a Mac, Ctrl+Shift+S elsewhere. */
export function keyLabel(combo: string) {
  const names = isMac ? MAC : OTHER;
  const parts = combo.split('+').map((part) => names[part] ?? part.toUpperCase());
  return isMac ? parts.join('') : parts.join('+');
}

/** Where the OS keeps secrets (API keys are stored there, never in the DB). */
export const keyStoreLabel = isMac ? 'macOS 키체인' : typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent) ? 'Windows 자격 증명 관리자' : 'OS 키체인(Secret Service)';
