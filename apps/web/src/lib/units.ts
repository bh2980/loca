import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { createCollection, createOptimisticAction, useLiveQuery, type Collection } from '@tanstack/react-db';
import type { InferResponseType } from 'hono/client';
import type { FeedChanges, FeedRows } from '@tw/shared';
import { client, unwrap } from './api';
import { sent } from './collections';
import { feed } from './feed';
import { queryClient } from './query-client';

/**
 * The lines the screens show, one collection per project: unlike the other collections it holds only
 * the lines asked for (POST units/by-ids), not all of them, and the row feed keeps those current. A
 * list asks the server for its page as ids (GET units/ids) and reads the rows from here, so a changed
 * line comes as its own row and only that line is drawn again. The open lines' candidates and run
 * history (POST units/extras) are held the same way, beside them.
 */
type Api = (typeof client.projects)[':projectId'];
export type Line = InferResponseType<Api['units']['by-ids']['$post']>['rows'][number];
export type LineExtras = InferResponseType<Api['units']['extras']['$post']>['rows'][number];
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

export interface HeldOptions<T extends Row> {
  id: string;
  projectId: string;
  /** The rows by id, with the feed's count when read. */
  read: (ids: string[]) => Promise<{ rows: T[]; seq: number }>;
  /** The part of a change event that names these rows (default: the lines). */
  signal?: (rows: FeedRows) => FeedChanges | undefined;
  /** Held rows that also go stale through another part of the event (an item whose line changed). */
  staleBy?: (rows: FeedRows) => ((row: T) => boolean) | undefined;
  /** Hears the ids each event names. */
  named?: (ids: readonly string[]) => void;
}

/**
 * A collection of a project's rows that holds only the ones asked for: they are read by id (`read`,
 * with the feed's count when read) and read again whenever the feed names them (`signal`, `staleBy`);
 * a read only replaces a row with a newer one. A bulk change (reload) or a reconnect drops them all,
 * and the screens ask again for what they show.
 */
export function heldCollection<T extends Row>({ id, projectId, read, signal = (rows) => rows.units, staleBy, named }: HeldOptions<T>): Held<T> {
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
  const readAll = async (ids: readonly string[]) => {
    for (let index = 0; index < ids.length; index += CHUNK) {
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
    const missing = [...new Set(ids)].filter((key) => !readAt.has(key) && !loading.has(key));
    if (!missing.length) return;
    for (const key of missing) loading.add(key);
    try {
      await collection.preload();
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

/** A line's context (GET units/:id): read again when the feed names the line or a neighbour; knowledge and graph changes reach it through live.ts. */
export const lineContext = (unitId: string) => queryOptions({ queryKey: ['line-context', unitId], queryFn: () => unwrap(client.units[':unitId'].$get({ param: { unitId } })) });
type Context = InferResponseType<(typeof client.units)[':unitId']['$get']>;

/** The open lines whose context reads one of these lines (itself or a neighbour) are read again. */
function refreshContexts(ids: readonly string[]) {
  if (!ids.length) return;
  const named = new Set(ids);
  for (const [key, data] of queryClient.getQueriesData<Context>({ queryKey: ['line-context'] })) {
    const unitId = key[1] as string;
    if (named.has(unitId) || (data && (named.has(data.neighbors.previous?.id ?? '') || named.has(data.neighbors.next?.id ?? '')))) void queryClient.invalidateQueries({ queryKey: key, exact: true });
  }
}

/**
 * A list's page, ready before a line of it is picked: the contexts not cached yet in one request (POST units/contexts, put
 * where each line's own query reads it) and the lines' candidates and runs in another. Picking a line then draws its whole
 * detail at once; a context the feed names later is read again as usual.
 */
export function preloadLineDetails(projectId: string, ids: readonly string[]) {
  const missing = ids.filter((id) => queryClient.getQueryData(lineContext(id).queryKey) === undefined);
  for (let at = 0; at < missing.length; at += 200) {
    void unwrap(client.projects[':projectId'].units.contexts.$post({ param: { projectId }, json: { ids: missing.slice(at, at + 200) } })).then(
      ({ rows }) => { for (const row of rows) queryClient.setQueryData(lineContext(row.id).queryKey, row as Context); },
      () => undefined, // A failed preload costs nothing: picking the line asks for it as before.
    );
  }
  void extrasOf(projectId).ensure(ids).catch(() => undefined);
}

const units = new Map<string, Held<Line>>();
const extras = new Map<string, Held<LineExtras>>();

export function unitsOf(projectId: string): Held<Line> {
  let held = units.get(projectId);
  if (!held) {
    held = heldCollection<Line>({ id: `units:${projectId}`, projectId, read: (ids) => unwrap(client.projects[':projectId'].units['by-ids'].$post({ param: { projectId }, json: { ids } })), named: refreshContexts });
    units.set(projectId, held);
  }
  return held;
}

/** The open lines' candidates and run history. */
export function extrasOf(projectId: string): Held<LineExtras> {
  let held = extras.get(projectId);
  if (!held) {
    // Read again when the line is named (its AI 제안) or its run history is (a run item moving, 0120).
    held = heldCollection<LineExtras>({
      id: `line-extras:${projectId}`,
      projectId,
      read: (ids) => unwrap(client.projects[':projectId'].units.extras.$post({ param: { projectId }, json: { ids } })),
      signal: (rows) => {
        if (!rows.units && !rows.lineExtras) return undefined;
        const parts = [rows.units, rows.lineExtras].filter((part) => part !== undefined);
        return { upsert: [], delete: parts.flatMap((part) => part.delete), changed: parts.flatMap((part) => part.changed ?? []), ...(parts.some((part) => part.reload) && { reload: true as const }) };
      },
    });
    extras.set(projectId, held);
  }
  return held;
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

/** These lines from the units collection, in this order (useHeld). */
export function useLines(projectId: string, ids: readonly string[] | undefined) {
  return useHeld(unitsOf(projectId), ids);
}

/** The fields a line's context (GET units/:id) shares with its row: read from the row, so one change shows in the list and the pane together. */
const SHARED = ['source', 'speaker', 'translation', 'statusId', 'statusBy', 'statusRunId', 'listener', 'listenerOrigin', 'listenerConfidence', 'note', 'translate', 'tagIds', 'updatedAt'] as const;

export type LineDetail = Context & Pick<LineExtras, 'candidates' | 'history'>;

/**
 * A line's detail: its context (neighbours, speech rule, graph nodes, the scene's names), fetched for
 * the open line only; what it shares with the line's row, from the units collection; and its
 * candidates and run history, from the line extras collection. Undefined until all three are there,
 * unless `partial`: then it is there as soon as the row is (a line picked in a list is held already),
 * with the context's own fields empty until it comes (`contextReady`, `extrasReady` say which came),
 * so a pane draws the line at once instead of a loading skeleton on every pick.
 */
export function useLineDetail(projectId: string, unitId: string, options: { enabled?: boolean; partial?: boolean } = {}) {
  const enabled = (options.enabled ?? true) && Boolean(unitId);
  const context = useQuery({ ...lineContext(unitId), enabled });
  const ids = useMemo(() => (enabled ? [unitId] : []), [enabled, unitId]);
  const row = useLines(projectId, ids).rows?.[0];
  const more = useHeld(extrasOf(projectId), ids).rows?.[0];
  const partial = options.partial ?? false;
  const data = useMemo<LineDetail | undefined>(() => {
    if (!row || (!partial && (!context.data || !more))) return undefined;
    // Until the context comes: the row's own fields, its scene from the row, nothing known about its neighbours, rule or nodes.
    const base = context.data?.id === row.id ? context.data : ({ ...row, seq: undefined, candidateId: null, group: { id: row.groupId, title: row.groupTitle, key: '' }, neighbors: {}, graphNodes: [], speech: null, sceneNames: [] } as unknown as Context);
    return { ...base, ...(Object.fromEntries(SHARED.map((field) => [field, row[field]])) as Partial<Context>), candidates: more?.candidates ?? [], history: more?.history ?? [] };
  }, [context.data, row, more, partial]);
  return { ...context, data, isPending: enabled && !data, contextReady: Boolean(context.data && context.data.id === unitId), extrasReady: Boolean(more) };
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
export function useLinePage(projectId: string, query: LineQuery, { enabled = true }: { enabled?: boolean } = {}) {
  const page = useQuery({ ...lineIds(projectId, query), enabled });
  const lines = useLines(projectId, enabled ? page.data?.ids : undefined);
  const data = useMemo(() => (page.data && lines.rows ? { total: page.data.total, offset: page.data.offset, scenes: page.data.scenes, rows: lines.rows } : undefined), [page.data, lines.rows]);
  return { data, isPlaceholderData: page.isPlaceholderData || lines.loading, isError: page.isError };
}

/** Lines by key in script order (evidence, where a speech rule starts): the keys' ids are a question, the lines come from the collection. */
export function useLinesByKeys(projectId: string, keys: readonly string[]) {
  const page = useQuery({
    queryKey: ['units', 'by-keys', projectId, keys],
    queryFn: () => unwrap(client.projects[':projectId'].units['by-keys'].$post({ param: { projectId }, json: { keys: [...keys] } })),
    enabled: keys.length > 0,
    placeholderData: keepPreviousData,
  });
  const lines = useLines(projectId, keys.length ? page.data?.ids : undefined);
  return { data: keys.length ? lines.rows : [] };
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
