import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { FEED_EVENT, type ChangeEvent, type Topic } from '@tw/shared';
import { CLIENT_ID } from './api';
import { feed } from './feed';

const BATCH_MS = 250;
/** No ping (sent every 20 s) for this long: the stream is dead. */
const SILENCE_MS = 45_000;
/** Reconnect waits after a dropped stream: 1 s, doubling to 30 s, back to 1 s once it opens. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/**
 * Refetches the questions of the changed topics: the queries whose key starts with one, and those keyed
 * otherwise that say which topics they follow (`meta.follows`, query-client.ts). What a topic implies is
 * already in the list (IMPLIES in @tw/shared; the server adds it). Used for events and for a write's own x-changed.
 */
export function refetchTopics(queryClient: QueryClient, topics: Iterable<Topic>) {
  const changed = new Set<unknown>(topics);
  void queryClient.invalidateQueries({ predicate: (query) => changed.has(query.queryKey[0]) || (query.meta?.follows?.some((topic) => changed.has(topic)) ?? false) });
}

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
    const topics = new Set<Topic>();
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
      source.addEventListener(FEED_EVENT, onChange);
      source.addEventListener('error', reconnect);
      // Only a reconnect may have missed events; the first open has nothing stale.
      source.addEventListener('open', () => {
        alive();
        wait = RETRY_MIN_MS;
        if (opened) {
          void queryClient.invalidateQueries();
          feed.resync();
        }
        opened = true;
      });
    };
    const onChange = (event: Event) => {
      alive();
      const data = JSON.parse((event as MessageEvent<string>).data) as ChangeEvent;
      // The rows go to the collections whoever made the change: this tab's own write waits for them (feed.wait).
      if (data.projectId && data.rows && data.seq !== undefined) feed.push(data.projectId, data.rows, data.seq);
      // Made only by this tab's own writes, whose answers (x-changed) already refetched it (#20).
      if (data.origin === CLIENT_ID) return;
      // Another project's events are ignored, except the project list, which every page shows.
      const foreign = data.projectId && data.projectId !== openProjectId;
      if (foreign && !data.topics.includes('projects')) return;
      for (const topic of foreign ? (['projects'] as const) : data.topics) topics.add(topic);
      timer ??= setTimeout(() => {
        timer = undefined;
        const batch = [...topics];
        topics.clear();
        // An event that also carries a change from elsewhere (a run, another tab) has no origin and is
        // refetched here even if this tab's own answer already did: skipping it would lose that change.
        refetchTopics(queryClient, batch);
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
