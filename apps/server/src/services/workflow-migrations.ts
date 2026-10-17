import { eq } from 'drizzle-orm';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;

const idOf = () => `e-${crypto.randomUUID().slice(0, 8)}`;

/**
 * #42: translations are written when a node produces them, so the status-change node no longer
 * applies a candidate. This drops `applyCandidate` from every setStatus node; a node that only
 * applied a candidate (no status, no tags) is removed and its incoming and outgoing edges are bridged,
 * and the default template's 'confirm' node is relabelled '확정으로'. Returns null when the
 * definition already satisfies this, so callers can skip a write and stay idempotent.
 */
export function stripApplyCandidate(definition: WorkflowDefinition): WorkflowDefinition | null {
  let changed = false;
  const removed = new Set<string>();
  const nodes: WorkflowNode[] = [];
  for (const node of definition.nodes) {
    if (node.type !== 'function' || node.config.fn !== 'setStatus') {
      nodes.push(node);
      continue;
    }
    const params = { ...node.config.params };
    const applied = params.applyCandidate === true;
    if ('applyCandidate' in params) {
      delete params.applyCandidate;
      changed = true;
    }
    const statusId = params.statusId as string | undefined;
    const add = (params.addTagIds as string[] | undefined) ?? [];
    const remove = (params.removeTagIds as string[] | undefined) ?? [];
    if (applied && !statusId && !add.length && !remove.length) {
      // A node that only applied a candidate (the default '번역에 적용') is now a no-op. One the
      // person left empty on purpose without that switch is theirs to keep.
      removed.add(node.id);
      changed = true;
      continue;
    }
    let next: FunctionNode = { ...node, config: { ...node.config, params } };
    if (next.id === 'confirm' && next.label === '확정') {
      next = { ...next, label: '확정으로' };
      changed = true;
    }
    nodes.push(next);
  }
  if (!changed) return null;

  // Bridge around every removed node through any chain of removed nodes, keeping the endpoints' handles.
  const incoming = (id: string) => definition.edges.filter((edge) => edge.target === id);
  const outgoing = (id: string) => definition.edges.filter((edge) => edge.source === id);
  const predecessors = (id: string, seen = new Set<string>()): WorkflowEdge[] =>
    incoming(id).flatMap((edge) => (removed.has(edge.source) ? (seen.has(edge.source) ? [] : (seen.add(edge.source), predecessors(edge.source, seen))) : [edge]));
  const successors = (id: string, seen = new Set<string>()): WorkflowEdge[] =>
    outgoing(id).flatMap((edge) => (removed.has(edge.target) ? (seen.has(edge.target) ? [] : (seen.add(edge.target), successors(edge.target, seen))) : [edge]));
  const edges: WorkflowEdge[] = definition.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
  const seen = new Set(edges.map((edge) => `${edge.source}|${edge.sourceHandle}|${edge.target}`));
  for (const id of removed)
    for (const before of predecessors(id))
      for (const after of successors(id)) {
        const key = `${before.source}|${before.sourceHandle}|${after.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ id: idOf(), source: before.source, sourceHandle: before.sourceHandle, target: after.target });
      }
  return { ...definition, nodes, edges };
}

/** Applies stripApplyCandidate to every saved workflow, bumping its version only where it changed. */
export function migrateApplyCandidate(db: Db): number {
  let changed = 0;
  for (const row of db.select().from(s.workflows).all()) {
    const next = stripApplyCandidate(row.definition);
    if (!next) continue;
    db.update(s.workflows).set({ definition: next, version: row.version + 1 }).where(eq(s.workflows.id, row.id)).run();
    changed++;
  }
  return changed;
}
