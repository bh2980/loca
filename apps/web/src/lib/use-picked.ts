import { useCallback, useMemo } from 'react';
import { stored, STORED, useStored } from './storage';

/**
 * Rows picked by checkbox, kept for this tab per screen (lib/storage.ts) so Back/Forward and reloads bring them
 * back. The key names the list (screen + project + tab/group where picks belong to one list).
 */
export function usePicked(key: string) {
  const [ids, setIds] = useStored(STORED.picked, key);
  const picked = useMemo<ReadonlySet<string>>(() => new Set(ids), [ids]);
  const pick = useCallback(
    (which: string[], on: boolean) => {
      // From what is kept now, not from this render: two picks in one tick both count.
      const next = new Set(stored(STORED.picked, key).read());
      for (const id of which) if (on) next.add(id);
      else next.delete(id);
      setIds([...next]);
    },
    [key, setIds],
  );
  const clear = useCallback(() => setIds([]), [setIds]);
  return { picked, pick, clear };
}
