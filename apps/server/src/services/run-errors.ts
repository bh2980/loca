import { and, eq, inArray, sql } from 'drizzle-orm';
import { FUNCTIONS, nodeName, type FunctionName, type WorkflowNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

type Run = Pick<typeof s.runs.$inferSelect, 'id' | 'subject' | 'definition'>;
export type RunError = { unitId: string; key: string | null; nodeId: string; node: string; kind: string; message: string };

/** Nodes that call out (AI, HTTP, script) and so can fail; a 재요청 node only passes a failure on. */
const callsOut = (node: WorkflowNode | undefined) => node?.type === 'ai' || (node?.type === 'function' && Boolean((FUNCTIONS[node.config.fn as FunctionName] as { async?: boolean } | undefined)?.async));

/**
 * Items of a run that failed, or that finished after their last call went out through its error exit
 * (a workflow that routes errors to e.g. a 검토 필요 status node finishes them as done). The item's
 * error is cleared once a node takes it, so its path says where it failed and the last 재요청 says why.
 */
export function runErrors(db: Db, run: Run): RunError[] {
  const byId = new Map(run.definition.nodes.map((node) => [node.id, node]));
  const rows = db
    .select({
      unitId: s.runItems.subjectId,
      key: run.subject === 'terms' ? s.terms.source : s.units.key,
      state: s.runItems.state,
      itemError: s.runItems.error,
      path: sql<string>`json_extract(${s.runItems.data}, '$.path')`,
      last: sql<string | null>`json_extract(${s.runItems.data}, '$.retry.last')`,
      error: sql<string | null>`json_extract(${s.runItems.data}, '$.error')`,
      lastError: sql<string | null>`json_extract(${s.runItems.data}, '$.lastError')`,
    })
    .from(s.runItems)
    .leftJoin(s.units, eq(s.units.id, s.runItems.subjectId))
    .leftJoin(s.terms, eq(s.terms.id, s.runItems.subjectId))
    .where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['done', 'failed'])))
    .all();
  const found = new Map<string, RunError>();
  for (const row of rows) {
    // A line copied onto parallel ways counts once.
    if (found.has(row.unitId)) continue;
    const path = JSON.parse(row.path ?? '[]') as { nodeId: string; port: string }[];
    const attempt = path.findLast((visit) => callsOut(byId.get(visit.nodeId)));
    if (row.state !== 'failed' && attempt?.port !== 'error') continue;
    // The error itself while the line carries it; once a node took it, the one it last went out with.
    const why = (JSON.parse(row.error ?? row.lastError ?? row.last ?? 'null') as { kind?: string; message?: string; nodeId?: string } | null) ?? {};
    // A failed line failed where its error says (a check can fail after an AI step went well).
    const nodeId = (row.state === 'failed' ? why.nodeId : undefined) ?? attempt?.nodeId ?? path.at(-1)?.nodeId ?? '';
    const node = byId.get(nodeId);
    found.set(row.unitId, { unitId: row.unitId, key: row.key, nodeId, node: node ? nodeName(node) : nodeId, kind: why.kind ?? 'unknown', message: why.message ?? row.itemError ?? '' });
  }
  return [...found.values()];
}

/** runErrors by node and kind, most first, with one message for each. */
export function groupRunErrors(errors: RunError[]) {
  const groups = new Map<string, { nodeId: string; node: string; kind: string; message: string; count: number }>();
  for (const error of errors) {
    const key = `${error.nodeId}\u0000${error.kind}`;
    const group = groups.get(key) ?? { nodeId: error.nodeId, node: error.node, kind: error.kind, message: error.message, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
