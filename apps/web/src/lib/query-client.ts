import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isServerDown } from './api';

/** The app's one query client: main.tsx provides it, and the collections reach it to refresh the queries that read their rows (lib/units.ts). */
export const queryClient = new QueryClient({
  defaultOptions: {
    // While the server is unreachable (starting, restarting) queries keep retrying with react-query's growing delay; a failure with the server up is retried once.
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: (count) => count < (isServerDown() ? 8 : 1) },
    mutations: { onError: (error) => toast.error(error.message) },
  },
});
