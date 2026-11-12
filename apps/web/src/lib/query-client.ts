import { QueryClient, type QueryKey } from '@tanstack/react-query';
import type { Topic } from '@loca/shared';
import { toast } from 'sonner';
import { isServerDown } from './api';

declare module '@tanstack/react-query' {
  interface Register {
    /** `follows`: topics a query whose key does not start with one is refetched on (lib/live.ts refetchTopics). */
    queryMeta: { follows?: readonly Topic[] };
  }
}

/** The app's one query client: main.tsx provides it, and the collections reach it to refresh the queries that read their rows (lib/units.ts). */
export const queryClient = new QueryClient({
  defaultOptions: {
    // While the server is unreachable (starting, restarting) queries keep retrying with react-query's growing delay; a failure with the server up is retried once.
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: (count) => count < (isServerDown() ? 8 : 1) },
    mutations: { onError: (error) => toast.error(error.message) },
  },
});

/**
 * Whether a question's cached answer is as of now: there is one, no change has marked it since and it is not being
 * asked again. A write that must send what a question says (or is done only when a question shows its result)
 * takes the cached answer when it is current and waits for the fresh one otherwise:
 * `queryClient.fetchQuery({ ...options, staleTime: isCurrent(options.queryKey) ? Infinity : 0 })`.
 */
export function isCurrent(queryKey: QueryKey) {
  const state = queryClient.getQueryState(queryKey);
  return state?.data !== undefined && !state.isInvalidated && state.fetchStatus === 'idle';
}
