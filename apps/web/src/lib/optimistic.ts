import type { QueryClient, QueryKey } from '@tanstack/react-query';

type Change = { key: QueryKey; update: (data: never) => unknown };

/**
 * Shows a change in every cached query it touches before the server answers, and returns how to
 * refetch them if it fails, without restoring a stale snapshot over concurrent saves.
 */
export async function optimistic(queryClient: QueryClient, changes: Change[]) {
  await Promise.all(changes.map((change) => queryClient.cancelQueries({ queryKey: change.key })));
  for (const change of changes) queryClient.setQueriesData({ queryKey: change.key }, (data: unknown) => (data === undefined ? data : change.update(data as never)));
  return () => {
    // Refetch authoritative values; an old list snapshot can erase another successful save.
    for (const change of changes) void queryClient.invalidateQueries({ queryKey: change.key });
  };
}

