import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { createCollection, createOptimisticAction, useLiveQuery, type Collection } from '@tanstack/react-db';
import type { InferResponseType } from 'hono/client';
import { client, unwrap } from './api';
import { sent } from './collections';
import { q } from './queries';
import { feed } from './feed';

/**
 * The lines the screens show, one collection per project: unlike the other collections it holds only
 * the lines asked for (POST units/by-ids), not all of them, and the row feed keeps those current. A
 * list asks the server for its page as ids (GET units/ids) and reads the rows from here, so a changed
 * line comes as its own row and only that line is drawn again.
 */
type Api = (typeof client.projects)[':projectId'];
export type Line = InferResponseType<Api['units']['by-ids']['$post']>['rows'][number];
type Write = { begin: () => void; write: (change: { type: 'insert' | 'update'; value: Line } | { type: 'delete'; key: string }) => void; commit: () => void; truncate: () => void };

interface Units {
  collection: Collection<Line, string>;
  /** Loads the lines not held yet (the others are kept current by the feed). */
  ensure: (ids: readonly string[]) => Promise<void>;
  /** Resolves once the lines the feed named so far are read again (a write waits for it, so its row is there when its own change goes). */
  idle: () => Promise<void>;
}

const opened = new Map<string, Units>();
const CHUNK = 200;

export function unitsOf(projectId: string): Units {
  const known = opened.get(projectId);
  if (known) return known;
  let sink: Write | null = null;
  // The feed count each held line was read at: a read only replaces a line with a newer one.
  const readAt = new Map<string, number>();
  const loading = new Set<string>();
  const reading = new Set<Promise<void>>();
  const put = (rows: readonly Line[], seq: number) => {
    const fresh = rows.filter((row) => seq >= (readAt.get(row.id) ?? -1));
    if (!sink || !fresh.length) return;
    sink.begin();
    for (const row of fresh) {
      sink.write({ type: readAt.has(row.id) ? 'update' : 'insert', value: row });
      readAt.set(row.id, seq);
    }
    sink.commit();
  };
  const read = async (ids: readonly string[]) => {
    for (let index = 0; index < ids.length; index += CHUNK) {
      const { rows, seq } = await unwrap(client.projects[':projectId'].units['by-ids'].$post({ param: { projectId }, json: { ids: ids.slice(index, index + CHUNK) } }));
      put(rows, seq);
    }
  };
  const track = (work: Promise<void>) => {
    const done = work.catch(() => undefined).finally(() => reading.delete(done));
    reading.add(done);
    return work;
  };
  // Read again everything shown: the lists ask for their lines again once they are gone.
  const drop = () => {
    if (!sink) return;
    sink.begin();
    sink.truncate();
    sink.commit();
    readAt.clear();
  };
  const collection = createCollection<Line, string>({
    id: `units:${projectId}`,
    getKey: (row) => row.id,
    sync: {
      rowUpdateMode: 'full',
      sync: ({ begin, write, commit, markReady, truncate }) => {
        sink = { begin, write, commit, truncate };
        markReady();
        const unsubscribe = feed.subscribe(projectId, (rows) => {
          const changes = rows.units;
          if (!changes || !sink) return;
          if (changes.reload) return drop();
          const gone = changes.delete.filter((id) => readAt.has(id));
          if (gone.length) {
            begin();
            for (const key of gone) {
              write({ type: 'delete', key });
              readAt.delete(key);
            }
            commit();
          }
          // The feed names changed lines; the ones held (or being loaded, from before the change) are read again.
          const stale = (changes.changed ?? []).filter((id) => readAt.has(id) || loading.has(id));
          if (stale.length) void track(read(stale));
        });
        // A reconnect may have missed events (and a restarted server counts again from 0).
        const stopResync = feed.onResync(drop);
        return () => {
          unsubscribe();
          stopResync();
          sink = null;
          readAt.clear();
        };
      },
    },
  });
  const ensure = async (ids: readonly string[]) => {
    const missing = [...new Set(ids)].filter((id) => !readAt.has(id) && !loading.has(id));
    if (!missing.length) return;
    for (const id of missing) loading.add(id);
    try {
      await collection.preload();
      await track(read(missing));
    } finally {
      for (const id of missing) loading.delete(id);
    }
  };
  const idle = async () => {
    while (reading.size) await Promise.all([...reading]);
  };
  const units = { collection, ensure, idle };
  opened.set(projectId, units);
  return units;
}

/**
 * These lines from the collection, in this order, loading the ones not held. `rows` stays the last
 * complete list while new ones load (a page change), and is undefined only before the first; `byId`
 * has every line held so far (a long list drawing what it has).
 */
export function useLines(projectId: string, ids: readonly string[] | undefined) {
  const units = unitsOf(projectId);
  const query = useLiveQuery(() => units.collection);
  const held = query.data;
  const byId = useMemo(() => new Map((held ?? []).map((row) => [row.id, row] as const)), [held]);
  const missing = (ids ?? []).filter((id) => !byId.has(id));
  const missingKey = missing.join(',');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (missing.length) units.ensure(missing).then(() => setFailed(false), () => setFailed(true));
  }, [missingKey, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const complete = useMemo(() => (ids && !missing.length ? ids.map((id) => byId.get(id)!) : undefined), [ids, byId, missingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = useRef<Line[] | undefined>(undefined);
  if (complete) last.current = complete;
  return { rows: complete ?? last.current, byId, loading: !complete, failed, retry: () => setAttempt((count) => count + 1) };
}

/** The fields a line's detail (GET units/:id) shares with its row: read from the row, so one change shows in the list and the pane together. */
const SHARED = ['source', 'speaker', 'translation', 'statusId', 'statusBy', 'statusRunId', 'listener', 'listenerOrigin', 'listenerConfidence', 'note', 'translate', 'tagIds', 'updatedAt'] as const;

/**
 * A line's detail (its neighbours, candidates, run history, speech rule…) with what it shares with
 * the line's row taken from the units collection; the detail itself is fetched for the open line only.
 */
export function useLineDetail(projectId: string, unitId: string, options: { enabled?: boolean } = {}) {
  const enabled = (options.enabled ?? true) && Boolean(unitId);
  const detail = useQuery({ ...q.unit(unitId), enabled });
  const row = useLineRow(projectId, enabled ? unitId : undefined);
  const data = useMemo(() => (detail.data && row ? { ...detail.data, ...Object.fromEntries(SHARED.map((field) => [field, row[field]])) } as typeof detail.data : detail.data), [detail.data, row]);
  return { ...detail, data };
}

/** One line from the collection (undefined until held). */
export function useLineRow(projectId: string, unitId: string | undefined) {
  const ids = useMemo(() => (unitId ? [unitId] : []), [unitId]);
  return useLines(projectId, ids).rows?.[0];
}

export type LineQuery = { groupId?: string; section?: string; kind?: 'scene' | 'document' | 'ui'; statusId?: string; tagIds?: string; q?: string; speaker?: string; listener?: string; review?: '1'; marks?: string; decidedBy?: 'ai' | 'human'; excluded?: 'hide' | 'only'; focus?: string; offset?: number; limit?: number };

/** A page of a line filter as ids, its total and lines per scene (units topic: a change may move lines in or out). */
export const lineIds = (projectId: string, query: LineQuery) =>
  queryOptions({
    queryKey: ['units', 'ids', projectId, query],
    queryFn: () => unwrap(client.projects[':projectId'].units.ids.$get({ param: { projectId }, query: { ...query, offset: query.offset?.toString(), limit: query.limit?.toString() } as never })),
    placeholderData: keepPreviousData,
  });

/** A page of lines: which lines and in what order from the server, the lines themselves from the collection. */
export function useLinePage(projectId: string, query: LineQuery) {
  const page = useQuery(lineIds(projectId, query));
  const lines = useLines(projectId, page.data?.ids);
  const data = useMemo(() => (page.data && lines.rows ? { total: page.data.total, offset: page.data.offset, scenes: page.data.scenes, rows: lines.rows } : undefined), [page.data, lines.rows]);
  return { data, isPlaceholderData: page.isPlaceholderData || lines.loading, isError: page.isError };
}

/** What a line patch looks like on the line before the server echoes it. */
export function patchedLine(json: { statusId?: string; listener?: string | null; tagIds?: string[]; translation?: string; addTagIds?: string[]; removeTagIds?: string[]; checked?: true; note?: string; translate?: 'include' | 'exclude' | null }) {
  return (row: Line): Partial<Line> => ({
    ...(json.statusId !== undefined && { statusId: json.statusId }),
    // A person's status or translation (or 확인함) makes the status theirs: the ✦ goes.
    ...((json.statusId !== undefined || json.translation !== undefined || json.checked) && { statusBy: 'human' as const, statusRunId: null }),
    ...(json.listener !== undefined && { listener: json.listener, listenerOrigin: 'human' as const, listenerConfidence: null }),
    ...(json.translation !== undefined && { translation: json.translation, origin: 'human' as const, model: null }),
    ...(json.tagIds !== undefined && { tagIds: json.tagIds }),
    ...(json.note !== undefined && { note: json.note.trim() }),
    ...(json.translate !== undefined && { translate: json.translate }),
    ...((json.addTagIds || json.removeTagIds) && { tagIds: [...new Set([...row.tagIds.filter((id) => !json.removeTagIds?.includes(id)), ...(json.addTagIds ?? [])])] }),
  });
}

/**
 * The one way the screens change lines: the held lines change at once, the request goes to the
 * server, and the saved rows replace them when the feed brings them; a refusal puts them back
 * (and rejects, for the caller's message).
 */
export function changeLines<T extends Response & { json(): Promise<unknown> }>(projectId: string, ids: Iterable<string>, change: (row: Line) => Partial<Line>, request: () => Promise<T>) {
  const { collection } = unitsOf(projectId);
  const targets = [...new Set(ids)];
  let body: Awaited<ReturnType<T['json']>> | undefined;
  const run = createOptimisticAction<void>({
    onMutate: () => {
      for (const id of targets) if (collection.has(id)) collection.update(id, (draft) => void Object.assign(draft, change(draft as Line)));
    },
    mutationFn: async () => {
      body = await sent(projectId, request());
      // The feed named the lines; they are read again before the change counts as done (no flash of the old row).
      await unitsOf(projectId).idle();
    },
  });
  return run().when('settled').then(() => body as Awaited<ReturnType<T['json']>>);
}
