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
