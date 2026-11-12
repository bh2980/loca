import { createCollection, type Collection } from '@tanstack/react-db';
import type { FeedRow } from '@loca/server/app';
import { APP_FEED, type AppCollection, type FeedChanges, type FeedCollection, type FeedSnapshot, type SnapshotCollection } from '@loca/shared';
import { client, unwrap, unwrapSeq } from './api';
import { feed, type Feed } from './feed';

/**
 * A collection's row type: what the server's reader of that collection returns (READERS, apps/server/src/feed.ts).
 * The feed's wire carries rows untyped; the constructors here are where they take their collection's type, so
 * no screen declares a row of its own.
 */
export type { FeedRow };

type Row = { id: string };

export interface FeedCollectionOptions<C extends FeedCollection> {
  projectId: string;
  name: C;
  /** The collection's rows now and the feed's count (GET /projects/:id/sync/:name). */
  load: () => Promise<FeedSnapshot>;
  /** The feed it listens to (the app's one, unless a test brings its own). */
  feed?: Feed;
}

/**
 * A collection of one project's rows that the server's row feed keeps current: the snapshot first,
 * then each change event's rows for it. Events that arrive while the snapshot loads wait and are
 * applied after it; one older than the snapshot is dropped (its rows are already in it).
 *
 * The snapshot is asked for once the event stream is open, so no event falls between the two; when the stream
 * does not open in time (the server is away) it is asked for anyway and read again when the stream opens. A
 * reconnect reads it again too (events were missed). A snapshot that cannot be loaded (the server is not up or
 * is restarting) is tried again, waiting longer each time up to RETRY_MAX_MS: a collection does not fail
 * for good, so screens show it loading rather than an error with a retry button.
 */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** How long a snapshot waits for the event stream to open before it is read without it. */
const LIVE_WAIT_MS = 1_000;

export function feedCollection<C extends FeedCollection>({ projectId, name, load, feed: source = feed }: FeedCollectionOptions<C>): Collection<FeedRow[C], string> {
  const collection = createCollection<Row, string>({
    id: `${name}:${projectId}`,
    getKey: (row) => row.id,
    sync: {
      rowUpdateMode: 'full',
      sync: ({ begin, write, commit, markReady }) => {
        let seen = -1;
        let waiting: [FeedChanges | undefined, number][] | null = [];
        let ready = false;
        let retry: ReturnType<typeof setTimeout> | undefined;
        let delay = RETRY_MIN_MS;
        /** Each load's number: an answer that a later load has overtaken is thrown away. */
        let loads = 0;
        /** Whether the snapshot held was asked for with the stream open (every event since has come). */
        let followed = false;
        let stopped = false;
        const synced = new Set<string>();
        const progress = source.track(projectId);
        const apply = (changes: FeedChanges | undefined, seq: number) => {
          if (seq <= seen) return;
          seen = seq;
          if (changes) {
            begin();
            for (const value of changes.upsert as Row[]) {
              write({ type: synced.has(value.id) ? 'update' : 'insert', value });
              synced.add(value.id);
            }
            for (const key of changes.delete) {
              if (!synced.delete(key)) continue;
              write({ type: 'delete', key });
            }
            commit();
          }
          progress.seen(seen);
        };
        const unsubscribe = source.subscribe(projectId, (rows, seq) => {
          if (waiting) waiting.push([rows[name], seq]);
          else apply(rows[name], seq);
        });
        const loadSnapshot = async () => {
          clearTimeout(retry);
          waiting ??= [];
          progress.loading();
          const turn = ++loads;
          const live = await source.whenLive(LIVE_WAIT_MS);
          if (turn !== loads || stopped) return;
          try {
            const snapshot = await load();
            if (turn !== loads || stopped) return;
            begin({ snapshot: true });
            synced.clear();
            for (const value of snapshot.rows as Row[]) {
              write({ type: 'insert', value });
              synced.add(value.id);
            }
            commit();
            seen = snapshot.seq;
            followed = live;
            if (!ready) markReady();
            ready = true;
            delay = RETRY_MIN_MS;
            const queued = waiting ?? [];
            waiting = null;
            for (const [changes, seq] of queued) apply(changes, seq);
            progress.seen(seen);
          } catch {
            if (turn !== loads || stopped) return;
            progress.failed();
            // Events keep waiting for the snapshot that will hold them.
            retry = setTimeout(() => void loadSnapshot(), delay);
            delay = Math.min(delay * 2, RETRY_MAX_MS);
          }
        };
        void loadSnapshot();
        // The stream opened: after a reconnect events were missed; and a snapshot read without the stream may have missed some.
        const stopOpen = source.onOpen((missed) => {
          if (missed || !followed) void loadSnapshot();
        });
        return () => {
          stopped = true;
          clearTimeout(retry);
          unsubscribe();
          stopOpen();
          progress.stop();
        };
      },
    },
  });
  // The rows are this collection's, as its reader on the server returns them.
  return collection as unknown as Collection<FeedRow[C], string>;
}

const opened = new Map<string, Collection<Row, string>>();

/** A project's collection of `name` (one per project, shared by every screen), loaded from its snapshot route. */
export function projectCollection<C extends SnapshotCollection>(name: C, projectId: string): Collection<FeedRow[C], string> {
  return scopeCollection(name, projectId);
}

/** The app's collection of `name` (the projects list, the home defaults, the home connections): the feed's scope APP_FEED. */
export function appCollection<C extends AppCollection>(name: C): Collection<FeedRow[C], string> {
  return scopeCollection(name, APP_FEED);
}

function scopeCollection<C extends SnapshotCollection | AppCollection>(name: C, scope: string): Collection<FeedRow[C], string> {
  const id = `${name}:${scope}`;
  let collection = opened.get(id);
  if (!collection) {
    collection = feedCollection({
      projectId: scope,
      name,
      load: () =>
        scope === APP_FEED
          ? unwrap(client.app.sync[':collection'].$get({ param: { collection: name as AppCollection } }))
          : unwrap(client.projects[':projectId'].sync[':collection'].$get({ param: { projectId: scope, collection: name as SnapshotCollection } })),
    }) as unknown as Collection<Row, string>;
    opened.set(id, collection);
  }
  return collection as unknown as Collection<FeedRow[C], string>;
}

/**
 * A live query's rows by the collection's own readiness: TanStack hands an empty list until the first sync, which a
 * screen cannot tell from "no rows", so `data` is there only once the query `isReady` (and never while it is not
 * `enabled`); `isLoading` is the time before that.
 */
export function liveRows<T>(query: { isReady: boolean; data: T | undefined }, enabled = true): { data: T | undefined; isLoading: boolean } {
  return { data: enabled && query.isReady ? query.data : undefined, isLoading: enabled && !query.isReady };
}

/** Waits for the row feed to bring a write's rows back (its x-seq), so the screen shows the saved row. */
export async function sent<T extends Response & { json(): Promise<unknown> }>(projectId: string, request: Promise<T>): Promise<Awaited<ReturnType<T['json']>>> {
  const { body, seq } = await unwrapSeq(request);
  await feed.wait(projectId, seq);
  return body;
}
