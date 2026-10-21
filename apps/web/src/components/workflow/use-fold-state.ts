import { useCallback, useState } from 'react';
import { readFoldState, writeFoldState, type FoldState } from '@/components/workflow/fold';

/** Which folds are open, kept in sessionStorage under `key` (one per workflow or run): view state, not part of the definition. */
export function useFoldState(key: string) {
  const [state, setState] = useState(() => readFoldState(key));
  const update = useCallback((next: FoldState | ((previous: FoldState) => FoldState)) => setState((previous) => {
    const value = typeof next === 'function' ? next(previous) : next;
    if (value !== previous) writeFoldState(key, value);
    return value;
  }), [key]);
  return [state, update] as const;
}
