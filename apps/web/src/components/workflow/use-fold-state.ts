import { useCallback } from 'react';
import { NO_OPEN_FOLDS, type FoldState } from '@/components/workflow/fold';
import { stored, STORED, useStored } from '@/lib/storage';

/** Which folds are open, kept for the tab under `graph` (one per workflow or run): view state, not part of the definition. */
export function useFoldState(graph: string) {
  const [kept, setKept] = useStored(STORED.folds, graph);
  const update = useCallback(
    (next: FoldState | ((previous: FoldState) => FoldState)) => {
      const previous = stored(STORED.folds, graph).read() ?? NO_OPEN_FOLDS;
      const value = typeof next === 'function' ? next(previous) : next;
      if (value !== previous) setKept(value.open.length ? value : null);
    },
    [graph, setKept],
  );
  return [kept ?? NO_OPEN_FOLDS, update] as const;
}
