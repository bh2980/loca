import { useState } from 'react';

/**
 * A form's draft over a saved value from a query. The draft follows the saved value whenever it
 * changes (chat, CLI, workflow, another tab) as long as the person has not edited it; once dirty
 * it is kept, so their typing is never overwritten. Values are compared structurally.
 */
export function useFormFrom<T>(saved: T) {
  const key = JSON.stringify(saved);
  const [state, setState] = useState({ key, draft: saved });
  let draft = state.draft;
  if (state.key !== key) {
    // Saved value changed: follow it unless the draft differs from what it was based on.
    const clean = JSON.stringify(state.draft) === state.key;
    draft = clean ? saved : state.draft;
    setState({ key, draft });
  }
  const setDraft = (next: T | ((current: T) => T)) =>
    setState((current) => ({ ...current, draft: typeof next === 'function' ? (next as (current: T) => T)(current.draft) : next }));
  return {
    draft,
    setDraft,
    dirty: JSON.stringify(draft) !== key,
    reset: () => setState({ key, draft: saved }),
  };
}

/** The fields of `draft` that differ from `saved`, for a patch request. */
export function changedFields<T extends object>(draft: T, saved: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) if (JSON.stringify(draft[key]) !== JSON.stringify(saved[key])) out[key] = draft[key];
  return out;
}
