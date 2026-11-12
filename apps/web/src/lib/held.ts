import { useEffect, useMemo, useRef, useState } from 'react';
import { createCollection, useLiveQuery, type Collection } from '@tanstack/react-db';
import { APP_FEED, type FeedChanges, type FeedRows, type HeldCollection } from '@loca/shared';
import { client, unwrap } from './api';
import type { FeedRow } from './collections';
import { feed } from './feed';

/**
 * Collections the browser holds only part of: lines, a line's extras, run items, proposals and the AI log are
 * too many to load whole, so a screen asks for the rows it shows by id and the row feed names the ones that
 * changed (HELD_COLLECTIONS in @loca/shared). Which rows a screen shows is its own question, answered with ids.
 */
type Row = { id: string };
type Write<T> = { begin: () => void; write: (change: { type: 'insert' | 'update'; value: T } | { type: 'delete'; key: string }) => void; commit: () => void; truncate: () => void };

export interface Held<T extends Row> {
  collection: Collection<T, string>;
  /** Loads the rows not held yet (the others are kept current by the feed). */
  ensure: (ids: readonly string[]) => Promise<void>;
  /** Resolves once the rows the feed named so far are read again (a write waits for it, so its row is there when its own change goes). */
  idle: () => Promise<void>;
}

const CHUNK = 200;
/** How long a read waits for the event stream to open before it is made without it. */
const LIVE_WAIT_MS = 1_000;

export interface HeldOptions<T extends Row> {
  id: string;
  projectId: string;
  /** The rows by id, with the feed's count when read. */
  read: (ids: string[]) => Promise<{ rows: T[]; seq: number }>;
  /** The part of a change event that names these rows. */
  signal: (rows: FeedRows) => FeedChanges | undefined;
  /**
   * Held rows that also go stale through another part of the event. Only for what the database cannot say:
   * a proposal names rows inside its input (lib/proposals.ts). A table a row is read from notes the row itself.
   */
  staleBy?: (rows: FeedRows) => ((row: T) => boolean) | undefined;
  /** Hears the ids each event names. */
  named?: (ids: readonly string[]) => void;
}

/**
 * A collection of a project's rows that holds only the ones asked for: they are read by id (`read`,
 * with the feed's count when read) and read again whenever the feed names them (`signal`, `staleBy`);
 * a read only replaces a row with a newer one. A bulk change (reload) or a reconnect of the event stream drops
 * them all, and the screens ask again for what they show.
 */
export function heldCollection<T extends Row>({ id, projectId, read, signal, staleBy, named }: HeldOptions<T>): Held<T> {
  let sink: Write<T> | null = null;
  const readAt = new Map<string, number>();
  const loading = new Set<string>();
  const reading = new Set<Promise<void>>();
  const put = (rows: readonly T[], seq: number) => {
    const fresh = rows.filter((row) => seq >= (readAt.get(row.id) ?? -1));
    if (!sink || !fresh.length) return;
    sink.begin();
    for (const row of fresh) {
      sink.write({ type: readAt.has(row.id) ? 'update' : 'insert', value: row });
      readAt.set(row.id, seq);
    }
    sink.commit();
  };
  /** Whether rows were read while the event stream was not open: events about them may have been missed. */
  let unfollowed = false;
  const readAll = async (ids: readonly string[]) => {
    for (let index = 0; index < ids.length; index += CHUNK) {
      if (!feed.live) unfollowed = true;
      const { rows, seq } = await read(ids.slice(index, index + CHUNK));
      put(rows, seq);
    }
  };
  const track = (work: Promise<void>) => {
    const done = work.catch(() => undefined).finally(() => reading.delete(done));
    reading.add(done);
    return work;
  };
  const drop = () => {
    if (!sink) return;
    sink.begin();
    sink.truncate();
    sink.commit();
    readAt.clear();
  };
  const collection = createCollection<T, string>({
    id,
    getKey: (row) => row.id,
    sync: {
      rowUpdateMode: 'full',
      sync: ({ begin, write, commit, markReady, truncate }) => {
        sink = { begin, write, commit, truncate };
        markReady();
        const unsubscribe = feed.subscribe(projectId, (rows) => {
          if (!sink) return;
          const also = staleBy?.(rows);
          const alsoStale = also ? [...readAt.keys()].filter((key) => { const row = collection.get(key); return row !== undefined && also(row); }) : [];
          const changes = signal(rows);
          if (!changes) {
            if (alsoStale.length) void track(readAll(alsoStale));
            return;
          }
          if (changes.reload) return drop();
          const gone = changes.delete.filter((key) => readAt.has(key));
          if (gone.length) {
            begin();
            for (const key of gone) {
              write({ type: 'delete', key });
              readAt.delete(key);
            }
            commit();
          }
          // The feed names changed lines; the ones held (or being loaded, from before the change) are read again.
          const stale = [...new Set([...(changes.changed ?? []).filter((key) => readAt.has(key) || loading.has(key)), ...alsoStale])];
          if (stale.length) void track(readAll(stale));
          named?.([...(changes.changed ?? []), ...changes.delete]);
        });
        // The stream opened: after a reconnect events were missed (and a restarted server counts again from 0), and rows
        // read while it was not open may have missed some. They are dropped, and the screens ask again for what they show.
        const stopOpen = feed.onOpen((missed) => {
          if (missed || unfollowed) drop();
          unfollowed = false;
        });
        return () => {
          unsubscribe();
          stopOpen();
          sink = null;
          readAt.clear();
        };
      },
    },
  });
  const ensure = async (ids: readonly string[]) => {
    const missing = [...new Set(ids)].filter((key) => !readAt.has(key) && !loading.has(key));
    if (!missing.length) return;
    for (const key of missing) loading.add(key);
    try {
      await collection.preload();
      // Read once the event stream is open, so every later event about these rows comes (after a while without it: read anyway, and again when it opens).
      await feed.whenLive(LIVE_WAIT_MS);
      await track(readAll(missing));
    } finally {
      for (const key of missing) loading.delete(key);
    }
  };
  const idle = async () => {
    while (reading.size) await Promise.all([...reading]);
  };
  return { collection, ensure, idle };
}

/**
 * One of the feed's held collections (HELD_COLLECTIONS) in a project, or the app's scope: its rows are read by id
 * through the server's reader of that collection (POST sync/:name) and read again when an event names them.
 */
export function heldFeed<C extends HeldCollection>(name: C, scope: string, options: Pick<HeldOptions<FeedRow[C]>, 'staleBy' | 'named'> = {}): Held<FeedRow[C]> {
  return heldCollection<FeedRow[C]>({
    id: `${name}:${scope}`,
    projectId: scope,
    // The wire carries rows untyped: they are this collection's, as its reader returns them.
    read: async (ids) =>
      (await unwrap(scope === APP_FEED ? client.app.sync.aiCalls.$post({ json: { ids } }) : client.projects[':projectId'].sync[':collection'].$post({ param: { projectId: scope, collection: name }, json: { ids } }))) as { rows: FeedRow[C][]; seq: number },
    signal: (rows) => rows[name],
    ...options,
  });
}

/**
 * These rows from a held collection, in this order, loading the ones not held. `rows` stays the last
 * complete list while new ones load (a page change), and is undefined only before the first; `byId`
 * has every row held so far (a long list drawing what it has).
 */
export function useHeld<T extends Row>(held: Held<T>, ids: readonly string[] | undefined) {
  const query = useLiveQuery(() => held.collection);
  const rows = query.data;
  const byId = useMemo(() => new Map((rows ?? []).map((row) => [row.id, row] as const)), [rows]);
  const missing = (ids ?? []).filter((key) => !byId.has(key));
  const missingKey = missing.join(',');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (missing.length) held.ensure(missing).then(() => setFailed(false), () => setFailed(true));
  }, [missingKey, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const complete = useMemo(() => (ids && !missing.length ? ids.map((key) => byId.get(key)!) : undefined), [ids, byId, missingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = useRef<T[] | undefined>(undefined);
  if (complete) last.current = complete;
  return { rows: complete ?? last.current, byId, loading: !complete, failed, retry: () => setAttempt((count) => count + 1) };
}

