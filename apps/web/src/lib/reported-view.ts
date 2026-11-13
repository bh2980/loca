import { useEffect, useSyncExternalStore } from 'react';

/**
 * The chat agent's "what is on screen" harness. Pages report what the user is looking at
 * (selected scene, line, graph node, workflow node…); the chat panel attaches it to messages.
 */
export interface ViewItem {
  kind: string;
  id: string;
  label: string;
  /** Extra facts for the agent (e.g. a node's current unsaved config as JSON). */
  detail?: string;
  /** Set by the chat's @ picker: the person attached it, the page did not report it. */
  attached?: boolean;
}

interface ViewState {
  page: string;
  items: Record<string, ViewItem[]>;
}

let state: ViewState = { page: '', items: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const viewStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => state,
  setPage(page: string) {
    if (state.page !== page) {
      state = { ...state, page };
      emit();
    }
  },
  set(source: string, items: ViewItem[]) {
    const { [source]: _previous, ...rest } = state.items;
    state = { ...state, items: items.length ? { ...rest, [source]: items } : rest };
    emit();
  },
};

export function useViewState() {
  return useSyncExternalStore(viewStore.subscribe, viewStore.get);
}

/** Report items while the component is mounted. `source` keeps reports from different panels apart. */
export function useReportView(source: string, items: (ViewItem | null | undefined | false)[]) {
  const present = items.filter((item): item is ViewItem => Boolean(item));
  const key = JSON.stringify(present);
  useEffect(() => {
    viewStore.set(source, JSON.parse(key) as ViewItem[]);
    return () => {
      viewStore.set(source, []);
    };
  }, [source, key]);
}

export function usePageTitle(page: string) {
  useEffect(() => {
    viewStore.setPage(page);
  }, [page]);
}

/** Lines picked with checkboxes, as one item for the chat: the same set gives the same id wherever it is reported or pinned. */
export function pickedLinesItem(ids: readonly string[]): ViewItem {
  const sorted = [...ids].sort();
  return {
    kind: '고른 대사',
    id: `picked:${sorted.length}:${sorted[0] ?? ''}:${sorted.at(-1) ?? ''}`,
    label: `고른 대사 ${sorted.length.toLocaleString()}개`,
    detail: JSON.stringify({ unitIds: sorted.slice(0, 200), ...(sorted.length > 200 && { more: sorted.length - 200 }) }),
  };
}
