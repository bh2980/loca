import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';

const BATCH_MS = 250;
/** No ping (sent every 20 s) for this long: the stream is dead. */
const SILENCE_MS = 45_000;

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
    let source: EventSource;
    // The server pings every 20 s. A stream that goes quiet longer (a restarted server behind the
    // dev proxy can leave it open but dead) is reopened, which refetches everything (see 'open').
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        source.close();
        connect();
      }, SILENCE_MS);
    };
    const connect = () => {
      source = new EventSource('/api/events');
      alive();
      source.addEventListener('ping', alive);
      source.addEventListener('change', onChange);
      // Only a reconnect may have missed events; the first open has nothing stale.
      source.addEventListener('open', () => {
        alive();
        if (opened) void queryClient.invalidateQueries();
        opened = true;
      });
    };
    const onChange = (event: Event) => {
      alive();
      const data = JSON.parse((event as MessageEvent<string>).data) as { projectId?: string; topics: string[] };
      // Another project's events are ignored, except the project list, which every page shows.
      const foreign = data.projectId && data.projectId !== openProjectId;
      if (foreign && !data.topics.includes('projects')) return;
      for (const topic of foreign ? ['projects'] : data.topics) topics.add(topic);
      timer ??= setTimeout(() => {
        timer = undefined;
        const batch = [...topics];
        topics.clear();
        // A topic the write's own answer already refetched is not fetched again.
        for (const topic of batch) void queryClient.invalidateQueries({ queryKey: [topic] });
      }, BATCH_MS);
    };
    connect();
    return () => {
      source.close();
      clearTimeout(timer);
      clearTimeout(watchdog);
    };
  }, [queryClient, openProjectId]);
}
