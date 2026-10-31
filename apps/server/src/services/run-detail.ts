import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { CONNECTION_KIND_INFO, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import type { Runner } from '../engine/runner.ts';
import { FILLING } from '../engine/run-create.ts';

/**
 * A run's detail in two parts. Its items (lines or terms, each where it is in the workflow) are rows
 * the browser holds for the page it shows (runItemRows), named by the row feed when one changes. Its
 * progress (counts by node, usage, retries, requests in flight) is one row per run (runProgress), read
 * again when the run's row changes. What stays the same while it runs (definition, models, limits) is
 * GET /runs/:id.
 */

/** A line waiting to go through an AI node again: it was last sent back by a 재요청 node (the AI node has not answered since). */
export const RETRYING = sql`(${s.runItems.state} in ('queued', 'running') and json_extract(${s.runItems.data}, '$.path[#-1].port') = 'retry' and json_extract(${s.runItems.data}, '$.retry.last.kind') is not null)`;

/**
 * Why a line is being sent again: the resend count at the 재요청 node that sent it (of that node's limit), the failure that
 * sent it, how long it still waits (`waitsUntil`, ms) and the model it goes on when that node picked one.
 */
export function retryOf(item: { state: s.ItemState; data: s.ItemData; notBefore: Date | null }, run: { definition: WorkflowDefinition; models: Record<string, s.AiSnapshot> }) {
  const last = item.data.retry?.last;
  const path = item.data.path;
  if (!last || (item.state !== 'queued' && item.state !== 'running') || path[path.length - 1]?.port !== 'retry') return null;
  const node = run.definition.nodes.find((candidate) => candidate.id === last.nodeId);
  const times = item.data.retry!.times[last.nodeId] ?? 0;
  const model = item.data.retry!.model;
  return {
    times,
    max: node?.type === 'retry' ? node.config.maxTimes : times,
    kind: last.kind,
    message: last.message,
    nodeId: last.nodeId,
    waitsUntil: item.state === 'queued' && item.notBefore && item.notBefore.getTime() > Date.now() ? item.notBefore.getTime() : null,
    model: model ? (run.models[model.key]?.label ?? null) : null,
  };
}

/** Connection names now, for logs that keep only the id; a deleted connection reads as its kind. */
export const connectionNames = (db: Db) => new Map(db.select({ id: s.connections.id, name: s.connections.name }).from(s.connections).all().map((row) => [row.id, row.name]));
export const connectionName = (names: Map<string, string>, id: string | null, kind: string | null) =>
  (id && names.get(id)) ?? (kind ? (CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.label ?? kind) : null);

export type RunItemQuery = { state?: string; nodeId?: string; offset: number; limit: number };

/** A run's items in a state or at a node (a call's id also matches every node inside it: the run graph's call card opens them all). */
function itemsWhere(runId: string, { state, nodeId }: Pick<RunItemQuery, 'state' | 'nodeId'>): SQL {
  const conditions = [eq(s.runItems.runId, runId)];
  if (state === 'retrying') conditions.push(RETRYING);
  else if (state) conditions.push(eq(s.runItems.state, state as s.ItemState));
  if (nodeId) conditions.push(or(eq(s.runItems.nodeId, nodeId), sql`substr(${s.runItems.nodeId}, 1, ${nodeId.length + 1}) = ${`${nodeId}/`}`)!);
  return and(...conditions)!;
}

/** One page of a run's items as ids, with how many there are: lines in script order, terms most used first. */
export function runItemIds(db: Db, runId: string, query: RunItemQuery) {
  const where = itemsWhere(runId, query);
  const total = db.select({ count: count() }).from(s.runItems).where(where).get()!.count;
  const run = db.select({ subject: s.runs.subject }).from(s.runs).where(eq(s.runs.id, runId)).get();
  const subject = run?.subject === 'terms' ? ('terms' as const) : ('lines' as const);
  const ids =
    subject === 'terms'
      ? db.select({ id: s.runItems.id }).from(s.runItems).innerJoin(s.terms, eq(s.terms.id, s.runItems.subjectId)).where(where).orderBy(desc(sql`coalesce(${s.terms.lines}, 0)`), asc(s.terms.source)).limit(query.limit).offset(query.offset).all()
      : db.select({ id: s.runItems.id }).from(s.runItems).innerJoin(s.units, eq(s.units.id, s.runItems.subjectId)).where(where).orderBy(asc(s.units.seq)).limit(query.limit).offset(query.offset).all();
  return { total, subject, ids: ids.map((row) => row.id) };
}

/** The project's run items by id, in the order asked: each with its line (or term), the line's status and why it is being sent again. */
export function runItemRows(db: Db, projectId: string, ids: readonly string[]) {
  if (!ids.length) return [];
  const items = inChunks(ids, (slice) =>
    db
      .select({ id: s.runItems.id, runId: s.runItems.runId, subject: s.runs.subject, unitId: s.runItems.subjectId, nodeId: s.runItems.nodeId, state: s.runItems.state, visits: s.runItems.visits, data: s.runItems.data, error: s.runItems.error, notBefore: s.runItems.notBefore, updatedAt: s.runItems.updatedAt })
      .from(s.runItems)
      .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
      .where(and(eq(s.runs.projectId, projectId), inArray(s.runItems.id, slice)))
      .all(),
  );
  const units = new Map(
    inChunks(items.filter((item) => item.subject !== 'terms').map((item) => item.unitId), (slice) =>
      db.select({ id: s.units.id, key: s.units.key, speaker: s.units.speaker, source: s.units.source, statusName: s.statuses.name, statusColor: s.statuses.color }).from(s.units).leftJoin(s.statuses, eq(s.statuses.id, s.units.statusId)).where(inArray(s.units.id, slice)).all(),
    ).map((unit) => [unit.id, unit]),
  );
  const terms = new Map(
    inChunks(items.filter((item) => item.subject === 'terms').map((item) => item.unitId), (slice) => db.select({ id: s.terms.id, source: s.terms.source, target: s.terms.target }).from(s.terms).where(inArray(s.terms.id, slice)).all()).map((term) => [term.id, term]),
  );
  const runs = new Map(
    inChunks([...new Set(items.map((item) => item.runId))], (slice) => db.select({ id: s.runs.id, definition: s.runs.definition, models: s.runs.models }).from(s.runs).where(inArray(s.runs.id, slice)).all()).map((run) => [run.id, run]),
  );
  const byId = new Map(
    items.flatMap(({ subject, runId, ...item }) => {
      const run = runs.get(runId);
      const retry = run ? retryOf(item, run) : null;
      if (subject === 'terms') {
        const term = terms.get(item.unitId);
        return term ? [[item.id, { ...item, runId, key: term.source, speaker: null as string | null, source: term.source, target: term.target as string | null, statusName: null as string | null, statusColor: null as string | null, retry }] as const] : [];
      }
      const unit = units.get(item.unitId);
      return unit ? [[item.id, { ...item, runId, key: unit.key, speaker: unit.speaker, source: unit.source, target: null as string | null, statusName: unit.statusName, statusColor: unit.statusColor, retry }] as const] : [];
    }),
  );
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * How runs are doing now, one row per run: items by node and state, model calls and tokens (in all
 * and by model), how many items went through each node (지나감), the lines waiting to be sent again by
 * each 재요청 node, and the requests each node has in flight.
 */
export function runProgress(db: Db, runner: Runner, projectId: string, ids: readonly string[]) {
  const runs = inChunks(ids, (slice) => db.select({ id: s.runs.id, status: s.runs.status, notice: s.runs.notice, total: s.runs.total, finishedAt: s.runs.finishedAt }).from(s.runs).where(and(eq(s.runs.projectId, projectId), inArray(s.runs.id, slice))).all());
  const names = connectionNames(db);
  return runs.map((run) => {
    const nodes = db.select({ nodeId: s.runItems.nodeId, state: s.runItems.state, count: count() }).from(s.runItems).where(eq(s.runItems.runId, run.id)).groupBy(s.runItems.nodeId, s.runItems.state).all();
    const usage = db
      .select({ steps: count(), failed: sql<number>`sum(case when ${s.runSteps.ok} then 0 else 1 end)`, inputTokens: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${s.runSteps.outputTokens}), 0)`, cachedInputTokens: sql<number>`coalesce(sum(${s.runSteps.cachedInputTokens}), 0)`, reasoningTokens: sql<number>`coalesce(sum(${s.runSteps.reasoningTokens}), 0)`, costUsd: sql<number | null>`sum(${s.runSteps.costUsd})` })
      .from(s.runSteps)
      .where(eq(s.runSteps.runId, run.id))
      .get();
    // Which connection and model did the calls (a switched or shared step, a 재요청 node's other model).
    const byModel = db
      .select({ connectionId: s.runSteps.connectionId, model: s.runSteps.model, steps: count(), failed: sql<number>`sum(case when ${s.runSteps.ok} then 0 else 1 end)`, inputTokens: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${s.runSteps.outputTokens}), 0)`, costUsd: sql<number | null>`sum(${s.runSteps.costUsd})` })
      .from(s.runSteps)
      .where(eq(s.runSteps.runId, run.id))
      .groupBy(s.runSteps.connectionId, s.runSteps.model)
      .all()
      .map((row) => ({ ...row, name: connectionName(names, row.connectionId, null) }));
    // Items that went through each node (a line that visited a node twice counts once): the run graph's "지나감".
    const passed = Object.fromEntries(
      db
        .all<{ nodeId: string; count: number }>(sql`select json_extract(step.value, '$.nodeId') as nodeId, count(distinct item.id) as count from ${s.runItems} item, json_each(item.data, '$.path') step where item.run_id = ${run.id} group by nodeId`)
        .map((row) => [row.nodeId, row.count]),
    );
    // Lines waiting to go through an AI node again, by the 재요청 node that sent them back: how many, and the failure kinds that sent them back.
    const retrying: Record<string, { count: number; kinds: Record<string, number> }> = {};
    for (const row of db.all<{ nodeId: string; kind: string; count: number }>(sql`select json_extract(data, '$.retry.last.nodeId') as nodeId, json_extract(data, '$.retry.last.kind') as kind, count(*) as count from ${s.runItems} where run_id = ${run.id} and ${RETRYING} group by nodeId, kind`)) {
      const entry = (retrying[row.nodeId] ??= { count: 0, kinds: {} });
      entry.count += row.count;
      entry.kinds[row.kind] = row.count;
    }
    return { id: run.id, status: run.status, notice: run.notice, total: run.total, finishedAt: run.finishedAt, nodes, calls: runner.liveCalls(run.id), usage, byModel, passed, retrying, filling: run.notice === FILLING };
  });
}

export type RunProgress = ReturnType<typeof runProgress>[number];
