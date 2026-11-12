import { useCallback, useMemo, useState } from 'react';

/**
 * The picked set of a graph, the same in every graph: a Shift+drag box or a ⌘/Ctrl+click picks nodes (ringed,
 * even a single one), a plain click is the page's selection (its pane, in the URL). The keys and menus act on the
 * picked set when there is one, else on the open item. The rules are the pure functions below; `useGraphSelection`
 * holds the set.
 */
const NONE: ReadonlySet<string> = new Set();

/** What the keys and toolboxes act on: the picked set, else the one open item. */
export const selectionOf = (picked: ReadonlySet<string>, single?: string | null): string[] => (picked.size ? [...picked] : single ? [single] : []);

/** What a menu opened on `id` acts on: the whole picked set when `id` is one of it, else that one alone. */
export const menuTargets = (picked: ReadonlySet<string>, id: string): string[] => (picked.has(id) ? [...picked] : [id]);

/** `id` added to the set, or taken back if it was in it. */
export function toggled(picked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(picked);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The selection after React Flow's select changes (a box, a ⌘/Ctrl+click), starting from what was selected. */
export function afterSelectChanges(selection: readonly string[], changes: readonly { id: string; selected: boolean }[]): Set<string> {
  const next = new Set(selection);
  for (const change of changes) {
    if (change.selected) next.add(change.id);
    else next.delete(change.id);
  }
  return next;
}

/**
 * The picked set after a canvas reports a box or a modifier-click (the source graph draws its own): `additive`
 * (⌘/Ctrl held, or a mode that collects) adds to what is picked, starting from the open item when nothing is; a
 * modifier-click on a picked node takes it back; a plain box replaces the set. `pickable` leaves out what cannot be
 * picked (stand-ins for another section).
 */
export function afterBoxPick({ picked, single, ids, additive, keep = additive, pickable = () => true }: {
  picked: ReadonlySet<string>;
  single?: string | null;
  ids: readonly string[];
  additive: boolean;
  /** Start from the picked set (defaults to `additive`). */
  keep?: boolean;
  pickable?: (id: string) => boolean;
}): Set<string> {
  const next = new Set(keep ? picked : []);
  if (additive && single && !next.size) next.add(single);
  for (const id of ids) {
    if (!pickable(id)) continue;
    if (additive && ids.length === 1 && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return next;
}

export interface GraphSelection {
  picked: ReadonlySet<string>;
  /** The picked set, else the open item (`single`). */
  ids: string[];
  set: (next: Iterable<string>) => void;
  clear: () => void;
  toggle: (id: string) => void;
  /** What a menu opened on `id` acts on. */
  targetsOf: (id: string) => string[];
  /** Takes React Flow's select changes; returns the new picked set (empty changes: null, nothing set). */
  apply: (changes: readonly { id: string; selected: boolean }[]) => Set<string> | null;
}

export function useGraphSelection(single?: string | null): GraphSelection {
  const [picked, setPicked] = useState<ReadonlySet<string>>(NONE);
  const ids = useMemo(() => selectionOf(picked, single), [picked, single]);
  const set = useCallback((next: Iterable<string>) => {
    // Read here, once: an iterator handed in cannot be read again if React runs the update twice.
    const value = new Set(next);
    // The same empty set again is no change (a click on the empty canvas with nothing picked draws nothing anew).
    setPicked((current) => (!value.size && !current.size ? current : value));
  }, []);
  const clear = useCallback(() => setPicked((current) => (current.size ? NONE : current)), []);
  const toggle = useCallback((id: string) => setPicked((current) => toggled(current, id)), []);
  return {
    picked,
    ids,
    set,
    clear,
    toggle,
    targetsOf: (id) => menuTargets(picked, id),
    apply: (changes) => {
      if (!changes.length) return null;
      const next = afterSelectChanges(ids, changes);
      setPicked(next);
      return next;
    },
  };
}
