import { useSyncExternalStore } from 'react';

/** What the dialogue graph shows of each line, on its cards and in its side pane: the source, the translation, or both. */
export type GraphShow = 'both' | 'source' | 'translation';

export const GRAPH_SHOW_ITEMS: { value: GraphShow; label: string }[] = [
  { value: 'source', label: '원문' },
  { value: 'translation', label: '번역' },
  { value: 'both', label: '둘 다' },
];

const KEY = 'tw.graph.flowShow';
const listeners = new Set<() => void>();

const read = (): GraphShow => {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'source' || saved === 'translation' ? saved : 'both';
  } catch {
    return 'both';
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** A preference of this screen (like the speaker column's width), kept in the browser and not in the address; every user of it follows a change. */
export function useGraphShow(): [GraphShow, (next: GraphShow) => void] {
  const show = useSyncExternalStore(subscribe, read, () => 'both' as GraphShow);
  const set = (next: GraphShow) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode */
    }
    for (const listener of listeners) listener();
  };
  return [show, set];
}

/** Which view of the selection the graph's side pane opens in: its `node` or the `flow` through it. The last one used stays. */
export type GraphPaneView = 'node' | 'flow';
const PANE_KEY = 'tw.graph.paneView';
const paneListeners = new Set<() => void>();
const readPane = (): GraphPaneView => {
  try {
    return localStorage.getItem(PANE_KEY) === 'node' ? 'node' : 'flow';
  } catch {
    return 'flow';
  }
};
const subscribePane = (listener: () => void) => {
  paneListeners.add(listener);
  return () => void paneListeners.delete(listener);
};
export function useGraphPaneView(): [GraphPaneView, (next: GraphPaneView) => void] {
  const view = useSyncExternalStore(subscribePane, readPane, () => 'flow' as GraphPaneView);
  const set = (next: GraphPaneView) => {
    try {
      localStorage.setItem(PANE_KEY, next);
    } catch {
      /* private mode */
    }
    for (const listener of paneListeners) listener();
  };
  return [view, set];
}
