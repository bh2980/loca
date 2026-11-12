import { STORED, useStored } from './storage';

/** What the dialogue graph shows of each line, on its cards and in its side pane: the source, the translation, or both. */
export type GraphShow = 'both' | 'source' | 'translation';

export const GRAPH_SHOW_ITEMS: { value: GraphShow; label: string }[] = [
  { value: 'source', label: '원문' },
  { value: 'translation', label: '번역' },
  { value: 'both', label: '둘 다' },
];

/** A line card's text by what is shown: the source, the translation alone, or the source over the translation (the main graph and the route view alike). */
export function shownText(show: GraphShow, text: string, translation?: string | null): { body: string; bodyStrong?: boolean; second?: string; missing?: 'body' | 'second' } {
  if (show === 'source') return { body: text };
  if (show === 'translation') return translation ? { body: translation, bodyStrong: true } : { body: '번역 없음', missing: 'body' };
  return { body: text, second: translation ?? '번역 없음', ...(!translation && { missing: 'second' as const }) };
}

/** A preference of this screen (like the speaker column's width), kept in the browser and not in the address; every user of it follows a change. */
export const useGraphShow = (): [GraphShow, (next: GraphShow) => void] => useStored(STORED.graphShow);

/** Which view of the selection the graph's side pane opens in: its `node` or the `flow` through it. The last one used stays. */
export type GraphPaneView = 'node' | 'flow';
export const useGraphPaneView = (): [GraphPaneView, (next: GraphPaneView) => void] => useStored(STORED.graphPaneView);
