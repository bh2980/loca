import { useCallback, useSyncExternalStore } from 'react';
import { stored, STORED } from './storage';

/**
 * The one draft mechanism: an unsaved edit kept as text under a key, with what it was begun from (its base).
 * Drafts survive navigation, Back/Forward and reloads (this tab's storage, lib/storage.ts), and are never
 * overwritten by a server refetch: the draft only exists while it differs. Every component using the same key
 * sees the same draft as it is typed (the row editor and the line pane's checks). A form keeps its fields as
 * JSON text here (use-form-from.ts), and so do the workflow editor and the chat box.
 */
const slot = (key: string) => stored(STORED.draft, key);

/** A draft outside React: the text kept under `key` (null: none), set or dropped. */
export const draftText = (key: string) => ({
  read: () => slot(key).read()?.text ?? null,
  write: (text: string | null) => (text === null ? slot(key).remove() : slot(key).write({ text, base: slot(key).read()?.base ?? null })),
});

/**
 * The third item clears the draft. After a save, pass what was sent: the draft is cleared only if it
 * is still that text, so edits typed while the save was on its way are kept. Says whether it cleared.
 * The fourth is what the draft was begun from (the saved text when there is no draft).
 */
export function useDraft(key: string, saved: string): [string, (value: string) => void, (sent?: string) => boolean, string | null] {
  const subscribe = useCallback((listener: () => void) => slot(key).subscribe(listener), [key]);
  const draft = useSyncExternalStore(subscribe, () => slot(key).read(), () => null);
  const setDraft = useCallback((value: string) => {
    const now = slot(key).read();
    slot(key).write({ text: value, base: now ? now.base : saved });
  }, [key, saved]);
  const clear = useCallback((sent?: string) => {
    const now = slot(key).read();
    if (sent !== undefined && now && now.text !== sent) {
      // A successful save becomes the base of typing that continued during the request.
      slot(key).write({ text: now.text, base: sent });
      return false;
    }
    slot(key).remove();
    return true;
  }, [key]);
  return [draft?.text ?? saved, setDraft, clear, draft ? draft.base : saved];
}

/**
 * Which of several drafts differ from what is saved, kept current as they are typed (a pane's tab dots for editors
 * it does not show right now). Reads the same storage as useDraft.
 */
export function useDirtyDrafts(entries: readonly { key: string; saved: string }[]): boolean[] {
  const keys = entries.map((entry) => entry.key).join('\n');
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = (keys ? keys.split('\n') : []).map((key) => slot(key).subscribe(listener));
      return () => stops.forEach((stop) => stop());
    },
    [keys],
  );
  const snapshot = useSyncExternalStore(subscribe, () => entries.map((entry) => ((slot(entry.key).read()?.text ?? entry.saved) !== entry.saved ? '1' : '0')).join(''), () => '');
  return entries.map((_entry, index) => snapshot[index] === '1');
}
