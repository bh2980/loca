import { useCallback } from 'react';
import { usePicked } from '@/lib/use-picked';
import { useReportView, type ViewItem } from '@/lib/reported-view';

/**
 * What a search becomes when a row of a list is clicked: the row's pane opens, and a click on the row whose pane is
 * open closes it. One rule for every list screen. (A row that is a page of its own navigates instead; a row's
 * checkbox only picks it.)
 */
export function toggledSelection(current: string | undefined, clicked: string): string | undefined {
  return current === clicked ? undefined : clicked;
}

/** A route's own `navigate`, as far as a list screen uses it: the search changes, never the path. */
type SetSearch<Search> = (options: { search: (previous: Search) => Search; replace: boolean }) => unknown;

/**
 * The wiring every list screen has: the URL's search is the screen's state (filters and the open row, AGENTS.md "Page
 * state"), a row click opens or closes the row's pane, the checkboxes' picks are kept per list, and what is open is
 * reported to the chat.
 *
 * `selection` names the search param that holds the open row's id, or the params of a screen with several tables
 * (one pane is open at a time: opening a row of one table closes the other's); `picks` names the list the checkboxes
 * belong to (a screen without checkboxes leaves it out); `report` is the screen's name for the chat and what it
 * shows now.
 */
export function useListScreen<Search extends object, Param extends keyof Search & string>({ search, navigate, selection, picks, report }: {
  search: Search;
  navigate: SetSearch<Search>;
  selection: Param | readonly [Param, ...Param[]];
  picks?: string;
  report: [source: string, items: (ViewItem | null | undefined | false)[]];
}) {
  const params: readonly Param[] = typeof selection === 'string' ? [selection] : selection;
  /**
   * Changes search params. In place by default: filters and the selection never add a history entry of their own;
   * `'push'` is for a change Back should undo (another view of the screen, another page of the list).
   */
  const setSearch = useCallback((next: Partial<Search>, history: 'replace' | 'push' = 'replace') => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: history === 'replace' }), [navigate]);
  const none = Object.fromEntries(params.map((name) => [name, undefined])) as Partial<Search>;
  /** Opens a row's pane (of the first table unless `param` names another), or with no id closes it. */
  const open = (id: string | undefined, param: Param = params[0]!) => setSearch({ ...none, [param]: id });
  const close = () => setSearch(none);
  /** A row was clicked. */
  const toggle = (id: string, param: Param = params[0]!) => open(toggledSelection(search[param] as string | undefined, id), param);
  // A screen without checkboxes keeps nothing: the key is never written.
  const { picked, pick, clear: clearPicked } = usePicked(picks ?? 'none');
  useReportView(...report);
  return { setSearch, open, close, toggle, picked, pick, clearPicked };
}
