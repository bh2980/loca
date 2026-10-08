import { useCallback, useEffect, useState } from 'react';

/**
 * Unsaved edits survive navigation, Back/Forward and reloads (sessionStorage), and
 * are never overwritten by a server refetch: the draft only exists while it differs.
 */
export function useDraft(key: string, saved: string): [string, (value: string) => void, () => void] {
  const storageKey = `tw.draft.${key}`;
  const read = () => {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
  const [draft, setDraftState] = useState<string | null>(read);
  useEffect(() => setDraftState(read()), [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDraft = useCallback(
    (value: string) => {
      setDraftState(value);
      try {
        sessionStorage.setItem(storageKey, value);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );
  const clear = useCallback(() => {
    setDraftState(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  return [draft ?? saved, setDraft, clear];
}
