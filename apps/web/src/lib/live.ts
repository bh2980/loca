import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { APP_FEED, FEED_EVENT, type ChangeEvent, type Topic } from '@tw/shared';
import { CLIENT_ID } from './api';
import { feed as appFeed, type Feed } from './feed';

const BATCH_MS = 250;
/** No ping (sent every 20 s) for this long: the stream is dead. */
const SILENCE_MS = 45_000;
/** Reconnect waits after a dropped stream: 1 s, doubling to 30 s, back to 1 s once it opens. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

const follows = (changed: Set<unknown>) => (query: { queryKey: readonly unknown[]; meta?: { follows?: readonly Topic[] } }) =>
  changed.has(query.queryKey[0]) || (query.meta?.follows?.some((topic) => changed.has(topic)) ?? false);

/**
 * Refetches the questions of the changed topics: the queries whose key starts with one, and those keyed
 * otherwise that say which topics they follow (`meta.follows`, lib/query-keys.ts). What a topic implies is
 * already in the list (IMPLIES in @tw/shared; the server adds it). Used for events and for a write's own x-changed.
 */
export function refetchTopics(queryClient: QueryClient, topics: Iterable<Topic>) {
  void queryClient.invalidateQueries({ predicate: follows(new Set<unknown>(topics)) });
}

/** The project the app has open (the URL's), read by the stream each time an event comes. */
let openProject: string | undefined;

/** Keeps the stream told which project is open. The stream itself is not tied to it: it lives as long as the app. */
export function useOpenProject() {
  const projectId = useRouterState({ select: (state) => state.matches.map((match) => (match.params as { projectId?: string }).projectId).find(Boolean) });
  useEffect(() => {
    openProject = projectId;
  }, [projectId]);
}

/** What the stream needs of an EventSource (a test brings a fake one). */
export interface LiveSource {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  close: () => void;
}

/**
 * The app's one event stream (GET /events), opened once and kept for as long as the app runs: which project is
 * open changes what an event means here, never the connection. The server pushes "topics changed" and the
 * changed rows; rows go to the collections of their project whichever project is open, topics refetch the
 * questions that follow them (bursts are batched into one refetch per topic), and none of it touches browser
 * history. No polling.
 *
 * Every time the stream opens the feed is told (feed.opened), and the collections read again what they may have
 * missed: after a reconnect everything, at first only what was read before the stream was open. The queries are
 * asked again likewise.
 */
export function startLive(
  queryClient: QueryClient,
  { connect: open = () => new EventSource('/api/events') as LiveSource, feed = appFeed, project = () => openProject }: { connect?: () => LiveSource; feed?: Feed; project?: () => string | undefined } = {},
) {
  const topics = new Set<Topic>();
  const elsewhere = new Set<Topic>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: LiveSource | undefined;
  // The server pings every 20 s. A stream that goes quiet longer (a restarted server behind the
  // dev proxy can leave it open but dead) is reopened.
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
    source?.close();
    clearTimeout(watchdog);
    clearTimeout(retry);
    if (stopped) return;
    feed.connecting();
    retry = setTimeout(connect, wait);
    wait = Math.min(wait * 2, RETRY_MAX_MS);
  };
  const connect = () => {
    feed.connecting();
    const mine = (source = open());
    // A stream that was replaced says nothing any more (its late error must not close the new one).
    const current = <E,>(handle: (event: E) => void) => (event: E) => void (source === mine && !stopped && handle(event));
    alive();
    mine.addEventListener('ping', current(alive));
    mine.addEventListener(FEED_EVENT, current(onChange));
    mine.addEventListener('error', current(reconnect));
    mine.addEventListener(
      'open',
      current(() => {
        alive();
        wait = RETRY_MIN_MS;
        // What was asked before the stream was open (or while it was away) may have changed unheard: the questions are
        // asked again, and the collections read again what they read meanwhile (feed.opened).
        void queryClient.invalidateQueries();
        feed.opened();
      }),
    );
  };
  const onChange = (event: Event) => {
    alive();
    const data = JSON.parse((event as MessageEvent<string>).data) as ChangeEvent;
    // The rows go to the collections whoever made the change and whichever project is open: this tab's own write waits for them (feed.wait).
    if (data.projectId && data.rows && data.seq !== undefined) feed.push(data.projectId, data.rows, data.seq);
    // Made only by this tab's own writes, whose answers (x-changed) already refetched it (#20).
    if (data.origin === CLIENT_ID) return;
    // Another project's questions are not on screen: they are marked to be asked again when they next are, not
    // refetched now (except the project list, which every page shows). The app's own (connections of the home,
    // its defaults) are everyone's.
    const foreign = Boolean(data.projectId) && data.projectId !== APP_FEED && data.projectId !== project();
    for (const topic of data.topics) (foreign && topic !== 'projects' ? elsewhere : topics).add(topic);
    timer ??= setTimeout(() => {
      timer = undefined;
      const batch = [...topics];
      const stale = new Set<unknown>(elsewhere);
      topics.clear();
      elsewhere.clear();
      // An event that also carries a change from elsewhere (a run, another tab) has no origin and is
      // refetched here even if this tab's own answer already did: skipping it would lose that change.
      if (batch.length) refetchTopics(queryClient, batch);
      if (stale.size) void queryClient.invalidateQueries({ predicate: follows(stale), refetchType: 'none' });
    }, BATCH_MS);
  };
  connect();
  return () => {
    stopped = true;
    source?.close();
    clearTimeout(retry);
    clearTimeout(timer);
    clearTimeout(watchdog);
  };
}
