import { useEffect, useState } from 'react';
import { useDraft } from './drafts';

/**
 * An edit in progress: `base` is what the item was when the person began (per field, rebased as
 * untouched fields move on), `draft` what they have typed. Only fields where the two differ are
 * the person's; every other field shows the saved value as it is now.
 */
export interface FormEdit<T> {
  base: T;
  draft: T;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A value's fields; anything but a plain object is one field. */
const fieldsOf = (value: unknown) => (isRecord(value) ? Object.keys(value) : null);
const pick = (value: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((key) => [key, value[key]]));

/**
 * The form as shown, given the saved value now and the edit (if any). `mine`: fields the person
 * changed. `conflicts`: those of them that also changed elsewhere since they began, to something
 * else than what they typed — shown, never silently resolved either way.
 */
export function resolveForm<T>(saved: T, edit: FormEdit<T> | null): { draft: T; mine: string[]; conflicts: string[] } {
  if (!edit) return { draft: saved, mine: [], conflicts: [] };
  const fields = fieldsOf(saved);
  if (!fields || !isRecord(edit.draft) || !isRecord(edit.base)) {
    const mine = !same(edit.draft, edit.base);
    return { draft: mine ? edit.draft : saved, mine: mine ? ['value'] : [], conflicts: mine && !same(saved, edit.base) && !same(saved, edit.draft) ? ['value'] : [] };
  }
  const draft = edit.draft as Record<string, unknown>, base = edit.base as Record<string, unknown>, now = saved as Record<string, unknown>;
  const mine = fields.filter((field) => !same(draft[field], base[field]));
  const conflicts = mine.filter((field) => !same(now[field], base[field]) && !same(now[field], draft[field]));
  return { draft: { ...now, ...pick(draft, mine) } as T, mine, conflicts };
}

/** The edit after the person sets the form to `next`: untouched fields take today's saved value as their base. */
export function nextEdit<T>(saved: T, edit: FormEdit<T> | null, next: T): FormEdit<T> {
  const { mine } = resolveForm(saved, edit);
  if (!edit || !isRecord(saved) || !isRecord(edit.base)) return { base: edit && mine.length ? edit.base : saved, draft: next };
  return { base: { ...saved, ...pick(edit.base, mine) } as T, draft: next };
}

/** The edit with the given fields set to what they are now elsewhere (their base moves on too). */
function takeSaved<T>(saved: T, edit: FormEdit<T>, fields: string[]): FormEdit<T> {
  if (!isRecord(saved)) return { base: saved, draft: saved };
  const now = pick(saved, fields);
  return { base: { ...edit.base, ...now } as T, draft: { ...edit.draft, ...now } as T };
}

const parse = <T,>(stored: string): FormEdit<T> | null => {
  try {
    return stored ? (JSON.parse(stored) as FormEdit<T>) : null;
  } catch {
    return null;
  }
};

/**
 * A form's draft over a saved value from a query. Fields the person has not touched follow the
 * saved value whenever it changes (chat, CLI, workflow, another tab); fields they edited keep their
 * typing, and one that changed elsewhere meanwhile is reported in `conflicts` (keepMine / takeSaved).
 * With a `key` (the item's id) the unsaved edit lives in sessionStorage, so it survives moving to
 * another item, Back/Forward and reloads; without one (a new item's form) it is kept in memory.
 * The edit is dropped once the saved value has caught up with it (after a save) or it is typed back.
 */
export function useFormFrom<T>(saved: T, key?: string) {
  const [stored, write, clear] = useDraft(`form.${key ?? ''}`, '');
  const [memory, setMemory] = useState<FormEdit<T> | null>(null);
  const edit = key ? parse<T>(stored) : memory;
  const set = (next: FormEdit<T> | null) => (key ? (next ? write(JSON.stringify(next)) : clear()) : setMemory(next));
  const { draft, conflicts } = resolveForm(saved, edit);
  const dirty = !same(draft, saved);
  useEffect(() => {
    if (edit && !dirty) set(null);
  });
  const setDraft = (next: T | ((current: T) => T)) => set(nextEdit(saved, edit, typeof next === 'function' ? (next as (current: T) => T)(draft) : next));
  return {
    draft,
    setDraft,
    dirty,
    /** Fields edited here that also changed elsewhere since editing began. */
    conflicts,
    /** Keep what was typed in the conflicting fields: their base becomes the saved value. */
    keepMine: () => edit && set({ base: (isRecord(saved) ? { ...edit.base, ...pick(saved, conflicts) } : saved) as T, draft: edit.draft }),
    /** Show the conflicting fields as they are saved now, keeping the rest of the edit. */
    takeSaved: () => edit && set(takeSaved(saved, edit, conflicts)),
    reset: () => set(null),
  };
}

/** The fields of `draft` that differ from `saved`, for a patch request. */
export function changedFields<T extends object>(draft: T, saved: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) if (JSON.stringify(draft[key]) !== JSON.stringify(saved[key])) out[key] = draft[key];
  return out;
}
