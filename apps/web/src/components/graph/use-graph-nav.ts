import { useCallback } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import type { GraphSearchChange } from './graph-search';

const route = getRouteApi('/p/$projectId/graph');

/**
 * The graph page's URL state for its parts: the search as it is, and the two ways to change it. `go` is navigation
 * (a history entry: another section, a mode, a route); `set` replaces the entry (a selection, a pane, a filter of
 * what is drawn), so Back leaves the page rather than stepping through every node that was clicked. The changes
 * themselves are graph-search.ts's.
 */
export function useGraphNav() {
  const { projectId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const go = useCallback((change: GraphSearchChange) => void navigate({ search: change }), [navigate]);
  const set = useCallback((change: GraphSearchChange) => void navigate({ search: change, replace: true }), [navigate]);
  return { projectId, search, navigate, go, set };
}

export type GraphNav = ReturnType<typeof useGraphNav>;
