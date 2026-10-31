import { useEffect, useMemo } from 'react';
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { client, unwrap } from './api';
import { heldCollection, useHeld, useLines, type Held } from './units';
import { useTaxonomy } from './knowledge';

/**
 * A run's page: which of its items are on the page (a question: GET runs/:id/items/ids), the items
 * themselves from a collection that holds the ones shown and reads one again when the feed names it
 * (a line's item takes its line from the units collection, a term's carries the term), how the run is doing (a progress row read again when the run's row
 * changes), and what it started with (definition, models), fetched once and again only when the run
 * itself changes (continued, paused, finished).
 */
export type RunItem = InferResponseType<(typeof client.projects)[':projectId']['run-items']['$post']>['rows'][number];
/** A run item as the run page lists it: with its line's (or term's) words and the line's status. */
export type RunItemRow = RunItem & { key: string; speaker: string | null; source: string; target: string | null; statusName: string | null; statusColor: string | null };
export type RunProgress = InferResponseType<(typeof client.projects)[':projectId']['run-progress']['$post']>['rows'][number];
type RunDetail = InferResponseType<(typeof client.runs)[':id']['$get']>;
export type RunStep = InferResponseType<(typeof client.projects)[':projectId']['run-steps']['$post']>['rows'][number];

const items = new Map<string, Held<RunItem>>();
const progress = new Map<string, Held<RunProgress>>();
const steps = new Map<string, Held<RunStep>>();

function itemsOf(projectId: string) {
  let held = items.get(projectId);
  if (!held) {
    held = heldCollection<RunItem>({
      id: `run-items:${projectId}`,
      projectId,
      read: (ids) => unwrap(client.projects[':projectId']['run-items'].$post({ param: { projectId }, json: { ids } })),
      signal: (rows) => rows.runItems,
      // A term's item carries the term's words (the glossary leaves out rejected terms); a line's reads its line from the units collection.
      staleBy: (rows) => {
        const changed = new Set(((rows.terms?.upsert ?? []) as { id: string }[]).map((term) => term.id));
        return changed.size ? (item) => item.term !== null && changed.has(item.unitId) : undefined;
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

function stepsOf(projectId: string) {
  let held = steps.get(projectId);
  if (!held) {
    // A model call is written once and never changes: each is read the first time its run's page lists it.
    held = heldCollection<RunStep>({
      id: `run-steps:${projectId}`,
      projectId,
      read: (ids) => unwrap(client.projects[':projectId']['run-steps'].$post({ param: { projectId }, json: { ids } })),
      signal: () => undefined,
    });
    steps.set(projectId, held);
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

/** One page of a run's items: { total, subject, rows } once the page's items and their lines are held; each row with its line's (or term's) words and status. */
export function useRunItems(projectId: string, runId: string, query: RunItemQuery) {
  const page = useQuery(runItemIds(runId, query));
  const held = useHeld(itemsOf(projectId), page.data?.ids);
  const lineIds = useMemo(() => held.rows?.flatMap((item) => (item.term ? [] : [item.unitId])), [held.rows]);
  const lines = useLines(projectId, lineIds);
  const { statuses } = useTaxonomy(projectId);
  const data = useMemo(() => {
    if (!page.data || !held.rows || !lines.rows) return undefined;
    const status = new Map((statuses ?? []).map((row) => [row.id, row]));
    const rows = held.rows.flatMap((item): RunItemRow[] => {
      if (item.term) return [{ ...item, key: item.term.source, speaker: null, source: item.term.source, target: item.term.target, statusName: null, statusColor: null }];
      const line = lines.byId.get(item.unitId);
      if (!line) return [];
      const shown = status.get(line.statusId);
      return [{ ...item, key: line.key, speaker: line.speaker, source: line.source, target: null, statusName: shown?.name ?? null, statusColor: shown?.color ?? null }];
    });
    return { total: page.data.total, subject: page.data.subject, rows };
  }, [page.data, held.rows, lines.rows, lines.byId, statuses]);
  return { data };
}

/** A run's latest model calls as ids (runs topic: a call is logged as the run goes). */
const runStepIds = (runId: string) =>
  queryOptions({
    queryKey: ['runs', 'step-ids', runId],
    queryFn: () => unwrap(client.runs[':id'].steps.ids.$get({ param: { id: runId } })),
    placeholderData: keepPreviousData,
  });

/** A run's latest model calls, newest first, once they are held; only while `enabled` (its tab is open). */
export function useRunSteps(projectId: string, runId: string, enabled: boolean) {
  const page = useQuery({ ...runStepIds(runId), enabled });
  return { data: useHeld(stepsOf(projectId), enabled ? page.data?.ids : undefined).rows };
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
