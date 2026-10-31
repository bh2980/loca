import { createCollection, type Collection } from '@tanstack/react-db';
import type { FeedChanges, FeedCollection, FeedSnapshot } from '@tw/shared';
import { client, unwrap, unwrapSeq } from './api';
import { feed } from './feed';

type Row = { id: string };

export interface FeedCollectionOptions<T extends Row> {
  projectId: string;
  name: FeedCollection;
  /** The collection's rows now and the feed's count (GET /projects/:id/sync/:name). */
  load: () => Promise<FeedSnapshot>;
  /** Writes: each sends the change to the server and waits for the feed to bring it back (feed.wait). */
  handlers?: Pick<Parameters<typeof createCollection<T, string>>[0], 'onInsert' | 'onUpdate' | 'onDelete'>;
}

/**
 * A collection of one project's rows that the server's row feed keeps current: the snapshot first,
 * then each change event's rows for it. Events that arrive while the snapshot loads wait and are
 * applied after it; one older than the snapshot is dropped (its rows are already in it). A reconnect
 * loads the snapshot again (feed.resync).
 */
export function feedCollection<T extends Row>({ projectId, name, load, handlers }: FeedCollectionOptions<T>): Collection<T, string> {
  return createCollection<T, string>({
    id: `${name}:${projectId}`,
    getKey: (row) => row.id,
    ...handlers,
    sync: {
      rowUpdateMode: 'full',
      sync: ({ begin, write, commit, markReady, fail }) => {
        let seen = -1;
        let waiting: [FeedChanges | undefined, number][] | null = [];
        let first = true;
        const synced = new Set<string>();
        const apply = (changes: FeedChanges | undefined, seq: number) => {
          if (seq <= seen) return;
          seen = seq;
          if (!changes) return;
          begin();
          for (const value of changes.upsert as unknown as T[]) {
            write({ type: synced.has(value.id) ? 'update' : 'insert', value });
            synced.add(value.id);
          }
          for (const key of changes.delete) {
            if (!synced.delete(key)) continue;
            write({ type: 'delete', key });
          }
          commit();
        };
        const unsubscribe = feed.subscribe(projectId, (rows, seq) => {
          if (waiting) waiting.push([rows[name], seq]);
          else apply(rows[name], seq);
        });
        const loadSnapshot = async () => {
          const again = !first;
          first = false;
          waiting ??= [];
          try {
            const snapshot = await load();
            begin({ snapshot: true });
            synced.clear();
            for (const value of snapshot.rows as unknown as T[]) {
              write({ type: 'insert', value });
              synced.add(value.id);
            }
            commit();
            seen = snapshot.seq;
            feed.markSeen(projectId, snapshot.seq, again);
            if (!again) markReady();
            const queued = waiting;
            waiting = null;
            for (const [changes, seq] of queued) apply(changes, seq);
          } catch (error) {
            waiting = null;
            if (!again) fail(error);
          }
        };
        void loadSnapshot();
        const stopResync = feed.onResync(() => void loadSnapshot());
        return () => {
          unsubscribe();
          stopResync();
        };
      },
    },
  });
}

const opened = new Map<string, Collection<Row, string>>();

/** A project's collection of `name` (one per project, shared by every screen), loaded from its snapshot route. */
export function projectCollection<T extends Row>(name: FeedCollection, projectId: string): Collection<T, string> {
  const id = `${name}:${projectId}`;
  let collection = opened.get(id);
  if (!collection) {
    collection = feedCollection<Row>({
      projectId,
      name,
      load: () => unwrap(client.projects[':projectId'].sync[':collection'].$get({ param: { projectId, collection: name } })) as Promise<FeedSnapshot>,
    });
    opened.set(id, collection);
  }
  return collection as unknown as Collection<T, string>;
}

/** A live query's rows as the old queries gave them: `data` undefined until loaded (and while not `enabled`). */
export function loaded<T>(query: { isReady: boolean; data: unknown }, enabled = true) {
  const data = enabled && query.isReady ? (query.data as T[]) : undefined;
  const loading = enabled && !query.isReady;
  return { data, isPending: loading, isLoading: loading, isFetching: loading, isSuccess: Boolean(data) };
}

/** Waits for the row feed to bring a write's rows back (its x-seq), so the screen shows the saved row. */
export async function sent<T extends Response & { json(): Promise<unknown> }>(projectId: string, request: Promise<T>): Promise<Awaited<ReturnType<T['json']>>> {
  const { body, seq } = await unwrapSeq(request);
  await feed.wait(projectId, seq);
  return body;
}
