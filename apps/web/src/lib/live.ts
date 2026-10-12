import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';

const BATCH_MS = 250;

/**
 * The server pushes "topics changed" over SSE; we refetch only queries whose key starts with
 * that topic. Events for another project are ignored, bursts are batched into one invalidation
 * per topic, and refetches never touch browser history. No polling.
 */
export function useLiveInvalidation() {
  const queryClient = useQueryClient();
  const openProjectId = useRouterState({
    select: (s) => s.matches.map((m) => (m.params as { projectId?: string }).projectId).find(Boolean),
  });

  useEffect(() => {
    const topics = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opened = false;
    const source = new EventSource('/api/events');
    source.addEventListener('change', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { projectId?: string; topics: string[] };
      if (data.projectId && data.projectId !== openProjectId) return;
      for (const topic of data.topics) topics.add(topic);
      timer ??= setTimeout(() => {
        timer = undefined;
        const batch = [...topics];
        topics.clear();
        for (const topic of batch) void queryClient.invalidateQueries({ queryKey: [topic] });
      }, BATCH_MS);
    });
    // Only a reconnect may have missed events; the first open has nothing stale.
    source.addEventListener('open', () => {
      if (opened) void queryClient.invalidateQueries();
      opened = true;
    });
    return () => {
      source.close();
      clearTimeout(timer);
    };
  }, [queryClient, openProjectId]);
}
