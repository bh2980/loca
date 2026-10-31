import { useEffect, useMemo } from 'react';
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { client, unwrap } from './api';
import { heldCollection, useHeld, type Held } from './units';

/**
 * A run's page: which of its items are on the page (a question: GET runs/:id/items/ids), the items
 * themselves from a collection that holds the ones shown and reads one again when the feed names it
 * (or the line or term it is for), how the run is doing (a progress row read again when the run's row
 * changes), and what it started with (definition, models), fetched once and again only when the run
 * itself changes (continued, paused, finished).
 */
export type RunItem = InferResponseType<(typeof client.projects)[':projectId']['run-items']['$post']>['rows'][number];
export type RunProgress = InferResponseType<(typeof client.projects)[':projectId']['run-progress']['$post']>['rows'][number];
type RunDetail = InferResponseType<(typeof client.runs)[':id']['$get']>;

const items = new Map<string, Held<RunItem>>();
const progress = new Map<string, Held<RunProgress>>();

function itemsOf(projectId: string) {
  let held = items.get(projectId);
  if (!held) {
    held = heldCollection<RunItem>({
      id: `run-items:${projectId}`,
      projectId,
      read: (ids) => unwrap(client.projects[':projectId']['run-items'].$post({ param: { projectId }, json: { ids } })),
      signal: (rows) => rows.runItems,
      // An item shows its line (key, source, status) or its term (current form).
      staleBy: (rows) => {
        const changed = new Set([...(rows.units?.changed ?? []), ...((rows.terms?.upsert ?? []) as { id: string }[]).map((term) => term.id)]);
        return changed.size ? (item) => changed.has(item.unitId) : undefined;
      },
    });
    items.set(projectId, held);
  }
  return held;
}

function progressOf(projectId: string) {
  let held = progress.get(projectId);
  if (!held) {
    held = heldCollection<RunProgress>({
      id: `run-progress:${projectId}`,
      projectId,
      read: (ids) => unwrap(client.projects[':projectId']['run-progress'].$post({ param: { projectId }, json: { ids } })),
      // A run's row changes with its items, its steps and itself (0110, 0114).
      signal: (rows) => (rows.runs ? { upsert: [], delete: rows.runs.delete, changed: (rows.runs.upsert as { id: string }[]).map((run) => run.id) } : undefined),
    });
    progress.set(projectId, held);
  }
  return held;
}

export type RunItemQuery = { state?: string; nodeId?: string; offset?: number };

/** A page of a run's items as ids (runs topic: an item may move in or out of a state or a node). */
const runItemIds = (runId: string, query: RunItemQuery) =>
  queryOptions({
    queryKey: ['runs', 'item-ids', runId, query],
    queryFn: () => unwrap(client.runs[':id'].items.ids.$get({ param: { id: runId }, query: { ...query, offset: query.offset?.toString() } as never })),
    placeholderData: keepPreviousData,
  });

/** One page of a run's items: { total, subject, rows } once the page's items are held. */
export function useRunItems(projectId: string, runId: string, query: RunItemQuery) {
  const page = useQuery(runItemIds(runId, query));
  const held = useHeld(itemsOf(projectId), page.data?.ids);
  const data = useMemo(() => (page.data && held.rows ? { total: page.data.total, subject: page.data.subject, rows: held.rows } : undefined), [page.data, held.rows]);
  return { data };
}

/** What a run started with: not under a topic, read again when the run itself changes (useRunDetail). */
const runStart = (runId: string) => queryOptions({ queryKey: ['run-start', runId], queryFn: () => unwrap(client.runs[':id'].$get({ param: { id: runId } })) });

/** A run's detail: what it started with, and how it is doing now from its progress row. */
export function useRunDetail(projectId: string, runId: string) {
  const start = useQuery(runStart(runId));
  const ids = useMemo(() => [runId], [runId]);
  const now = useHeld(progressOf(projectId), ids).rows?.[0];
  // A continue, a switch of models, a pause or the end: the run's own fields change and what it started with is read again.
  const queryClient = useQueryClient();
  const turn = now ? `${now.status}|${now.notice ?? ''}|${now.total}|${now.finishedAt ?? ''}` : '';
  useEffect(() => {
    if (turn && start.data && turn !== `${start.data.status}|${start.data.notice ?? ''}|${start.data.total}|${start.data.finishedAt ?? ''}`) void queryClient.invalidateQueries({ queryKey: runStart(runId).queryKey });
  }, [turn]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo<RunDetail | undefined>(() => (start.data ? (now ? { ...start.data, ...now } : start.data) : undefined), [start.data, now]);
  return { ...start, data };
}
