import { useCallback } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';

/**
 * Which tab an inspector opens on: the one the URL names (a shared link, Back/Forward), else the first.
 * Anything that is not one of `tabs` is skipped (the URL may name a tab of another kind of inspector).
 */
export function pickTab<T extends string>(tabs: readonly [T, ...T[]], url: unknown): T {
  return typeof url === 'string' && (tabs as readonly string[]).includes(url) ? (url as T) : tabs[0];
}

/**
 * An inspector's tab, kept in the URL like the rest of the page's state: the page's `pane` search param (every
 * page with an inspector takes it), or the page's own param when it gives one (`url` + `onUrl`: the script's
 * `tab`). Picking another item keeps the param, so the next item opens where the last one was left. A tab
 * change replaces the history entry: Back leaves the page, it does not walk the tabs.
 */
export function useInspectorTab<T extends string>(tabs: readonly [T, ...T[]], url?: T, onUrl?: (tab: T) => void): [T, (tab: T) => void] {
  const pane = useRouterState({ select: (state) => (state.location.search as { pane?: unknown }).pane });
  const navigate = useNavigate();
  const first = tabs[0];
  const setTab = useCallback(
    (next: T) => {
      if (onUrl) return onUrl(next);
      // The first tab is the default: it is not written, so the URL stays as short as the page's state.
      void navigate({ to: '.', search: ((previous: Record<string, unknown>) => ({ ...previous, pane: next === first ? undefined : next })) as never, replace: true });
    },
    [navigate, onUrl, first],
  );
  return [pickTab(tabs, onUrl ? url : pane), setTab];
}
