import { useMemo } from 'react';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { LineFilterInput } from '@loca/shared';
import { client, unwrap } from './api';
import type { FeedRow } from './collections';
import { useGroupsById } from './groups';
import { heldFeed, useHeld, type Held } from './held';
import { queryClient } from './query-client';
import { key, ownFamily, ownKey } from './query-keys';

/**
 * The lines the screens show, one collection per project: unlike the other collections it holds only
 * the lines asked for (POST sync/units), not all of them, and the row feed keeps those current. A
 * list asks the server for its page as ids (POST units/ids) and reads the rows from here, so a changed
 * line comes as its own row and only that line is drawn again. The open lines' candidates and run
 * history (line extras) are held the same way, beside them. A line names its scene by id: the scene's
 * title, section and kind are the groups collection's (useGroupsById).
 */
export type Line = FeedRow['units'];
export type LineExtras = FeedRow['lineExtras'];
/**
 * A line's surroundings (GET units/:id/surroundings): its neighbours by id, its graph nodes, the speech rule it falls
 * under and the names around it. Nothing of the line's own row: that is the units collection's. Read again when the
 * feed names the line or a neighbour (refreshSurroundings), and when what it reads besides lines changes: speech rules
 * and characters (knowledge) and the graph's nodes.
 */
export const lineSurroundings = (unitId: string) =>
  queryOptions({ ...ownKey('line-surroundings', unitId), queryFn: () => unwrap(client.units[':unitId'].surroundings.$get({ param: { unitId } })) });
export type LineSurroundings = InferResponseType<(typeof client.units)[':unitId']['surroundings']['$get']>;

/** The open lines whose surroundings read one of these lines (itself or a neighbour) are read again. */
function refreshSurroundings(ids: readonly string[]) {
  if (!ids.length) return;
  const named = new Set(ids);
  for (const [queryKey, data] of queryClient.getQueriesData<LineSurroundings>({ queryKey: ownFamily('line-surroundings') })) {
    const unitId = queryKey[1] as string;
    if (named.has(unitId) || (data && (named.has(data.neighbors.previous ?? '') || named.has(data.neighbors.next ?? '')))) void queryClient.invalidateQueries({ queryKey, exact: true });
  }
}

/**
 * A list's page, ready before a line of it is picked: the surroundings not asked yet in one request (POST
 * units/surroundings, each answer put under the line's own question, as if it had been asked) and the lines'
 * candidates and runs in another. Picking a line then draws its whole detail at once; surroundings the feed names
 * later are read again as usual.
 */
export function preloadLineDetails(projectId: string, ids: readonly string[]) {
  const missing = ids.filter((id) => queryClient.getQueryData(lineSurroundings(id).queryKey) === undefined);
  for (let at = 0; at < missing.length; at += 200) {
    void unwrap(client.projects[':projectId'].units.surroundings.$post({ param: { projectId }, json: { ids: missing.slice(at, at + 200) } })).then(
      ({ rows }) => { for (const row of rows) queryClient.setQueryData(lineSurroundings(row.id).queryKey, row); },
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
    held = heldFeed('units', projectId, { named: refreshSurroundings });
    units.set(projectId, held);
  }
  return held;
}

/** The open lines' candidates and run history. */
export function extrasOf(projectId: string): Held<LineExtras> {
  let held = extras.get(projectId);
  if (!held) {
    held = heldFeed('lineExtras', projectId);
    extras.set(projectId, held);
  }
  return held;
}

/** These lines from the units collection, in this order (useHeld). */
export function useLines(projectId: string, ids: readonly string[] | undefined) {
  return useHeld(unitsOf(projectId), ids);
}

/** A line's detail: its row, its scene's names, its surroundings, and its candidates and run history. */
export type LineDetail = Line & { group: { id: string; title: string; key: string } } & Pick<LineSurroundings, 'graphNodes' | 'speech' | 'sceneNames'> & Pick<LineExtras, 'candidates' | 'history' | 'events'>;

/**
 * A line's detail, joined from where each part lives: the line's row from the units collection (one change shows
 * in the list and the pane together), its scene from the groups collection, its surroundings (asked for the open
 * line only) and its candidates and run history from the line extras collection. Undefined until all are there,
 * unless `partial`: then it is there as soon as the row is (a line picked in a list is held already), with the
 * surroundings empty until they come (`contextReady`, `extrasReady` say which came), so a pane draws the line at
 * once instead of a loading skeleton on every pick.
 */
export function useLineDetail(projectId: string, unitId: string, options: { enabled?: boolean; partial?: boolean } = {}) {
  const enabled = (options.enabled ?? true) && Boolean(unitId);
  const around = useQuery({ ...lineSurroundings(unitId), enabled });
  const ids = useMemo(() => (enabled ? [unitId] : []), [enabled, unitId]);
  const row = useLines(projectId, ids).rows?.[0];
  const more = useHeld(extrasOf(projectId), ids).rows?.[0];
  const partial = options.partial ?? false;
  const group = useGroupsById(projectId).get(row?.groupId ?? '');
  const known = around.data?.id === unitId ? around.data : undefined;
  const data = useMemo<LineDetail | undefined>(() => {
    if (!row || (!partial && (!known || !more))) return undefined;
    return {
      ...row,
      group: { id: row.groupId, title: group?.title ?? '', key: group?.key ?? '' },
      graphNodes: known?.graphNodes ?? [],
      speech: known?.speech ?? null,
      sceneNames: known?.sceneNames ?? [],
      candidates: more?.candidates ?? [],
      history: more?.history ?? [],
      events: more?.events ?? [],
    };
  }, [known, row, more, partial, group]);
  return { data, isPending: enabled && !data, isError: around.isError, error: around.error, refetch: around.refetch, contextReady: Boolean(known), extrasReady: Boolean(more) };
}


/** A page of a line filter as ids, its total and lines per scene (units topic: a change may move lines in or out). `focus`: open the page holding this line. */
export const lineIds = (projectId: string, filter: LineFilterInput, focus?: string) =>
  queryOptions({
    queryKey: key('units', 'ids', projectId, filter, focus ?? null),
    queryFn: () => unwrap(client.projects[':projectId'].units.ids.$post({ param: { projectId }, json: { filter, focus } })),
    placeholderData: keepPreviousData,
  });

/** A page of lines: which lines and in what order from the server (the one line filter, as JSON), the lines themselves from the collection. */
export function useLinePage(projectId: string, filter: LineFilterInput, { enabled = true, focus }: { enabled?: boolean; focus?: string } = {}) {
  const page = useQuery({ ...lineIds(projectId, filter, focus), enabled });
  const lines = useLines(projectId, enabled ? page.data?.ids : undefined);
  const data = useMemo(() => (page.data && lines.rows ? { total: page.data.total, offset: page.data.offset, scenes: page.data.scenes, rows: lines.rows } : undefined), [page.data, lines.rows]);
  return { data, isPlaceholderData: page.isPlaceholderData || lines.loading, isError: page.isError, error: page.error };
}

/** Lines by key in script order (evidence, where a speech rule starts): the keys' ids are a question, the lines come from the collection. */
export function useLinesByKeys(projectId: string, keys: readonly string[]) {
  const page = useQuery({
    queryKey: key('units', 'by-keys', projectId, keys),
    queryFn: () => unwrap(client.projects[':projectId'].units['by-keys'].$post({ param: { projectId }, json: { keys: [...keys] } })),
    enabled: keys.length > 0,
    placeholderData: keepPreviousData,
  });
  const lines = useLines(projectId, keys.length ? page.data?.ids : undefined);
  return { data: keys.length ? lines.rows : [] };
}
