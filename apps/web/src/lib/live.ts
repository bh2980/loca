import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';

const BATCH_MS = 250;
/** No ping (sent every 20 s) for this long: the stream is dead. */
const SILENCE_MS = 45_000;
/** Reconnect waits after a dropped stream: 1 s, doubling to 30 s, back to 1 s once it opens. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/**
 * Queries that also follow another topic: a work analysis is a run now (#47), so the analysis list
 * (자료's '마지막 분석', 시작하기, notices) is refetched when runs change, e.g. when one finishes.
 */
const ALSO: Record<string, string[]> = { runs: ['analysis'] };

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
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = RETRY_MIN_MS;
    let stopped = false;
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(reconnect, SILENCE_MS);
    };
    // The browser's own retry hammers a stopped server every few seconds (a console error each
    // time); we close the stream and come back with a growing wait instead.
    const reconnect = () => {
      source.close();
      clearTimeout(watchdog);
      clearTimeout(retry);
      if (stopped) return;
      retry = setTimeout(connect, wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    };
    const connect = () => {
      source = new EventSource('/api/events');
      alive();
      source.addEventListener('ping', alive);
      source.addEventListener('change', onChange);
      source.addEventListener('error', reconnect);
      // Only a reconnect may have missed events; the first open has nothing stale.
      source.addEventListener('open', () => {
        alive();
        wait = RETRY_MIN_MS;
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
      for (const topic of foreign ? ['projects'] : data.topics) for (const key of [topic, ...(ALSO[topic] ?? [])]) topics.add(key);
      timer ??= setTimeout(() => {
        timer = undefined;
        const batch = [...topics];
        topics.clear();
        // Refetched even when the write's own answer (x-changed) already did: the event may also
        // carry a background change made right after that save, which skipping would lose.
        for (const topic of batch) void queryClient.invalidateQueries({ queryKey: [topic] });
      }, BATCH_MS);
    };
    connect();
    return () => {
      stopped = true;
      source.close();
      clearTimeout(retry);
      clearTimeout(timer);
      clearTimeout(watchdog);
    };
  }, [queryClient, openProjectId]);
}
