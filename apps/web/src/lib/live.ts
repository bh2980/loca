import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * The server pushes "topics changed" over SSE; we refetch only queries whose key starts with
 * that topic. No polling, and refetches never touch browser history.
 */
export function useLiveInvalidation() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('change', (event) => {
      const { topics } = JSON.parse((event as MessageEvent<string>).data) as { projectId?: string; topics: string[] };
      for (const topic of topics) void queryClient.invalidateQueries({ queryKey: [topic] });
    });
    // After a reconnect we may have missed events.
    source.addEventListener('open', () => void queryClient.invalidateQueries());
    return () => source.close();
  }, [queryClient]);
}
