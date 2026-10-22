/**
 * A run's definition has every 워크플로 호출 expanded into the called workflow's nodes (ids
 * `${call}/${inner}`, all at the call's position). The run graph shows each top-level call as ONE card
 * again; these helpers fold the definition, the edges and the live counts, and list what is inside.
 */
import { callTrail, nodeName, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@tw/shared';

/** The top-level calls of a run's definition that have nodes inside (a call to a workflow with nothing in it left none). */
export const topCallIds = (definition: Pick<WorkflowDefinition, 'nodes' | 'calls'>): string[] =>
  Object.keys(definition.calls ?? {}).filter((id) => !id.includes('/') && definition.nodes.some((node) => node.id.startsWith(`${id}/`)));

/** The top-level call a node sits in (the node itself when it is such a call's id), if any. */
export function callOf(definition: Pick<WorkflowDefinition, 'nodes' | 'calls'>, nodeId: string): string | undefined {
  return topCallIds(definition).find((id) => nodeId === id || nodeId.startsWith(`${id}/`));
}

/**
 * The definition with each top-level call folded into one `call` node (id = the call's prefix, label =
 * the call's name, at the position of its inner nodes). Lines into any inner node go into the card;
 * lines leaving the call go out of its 오류 exit when they left an inner `error` exit, else out of 완료.
 * Lines among the inner nodes are dropped; duplicates (several inner nodes leading to the same place) are merged.
 */
export function collapseCalls(definition: WorkflowDefinition): WorkflowDefinition {
  const calls = topCallIds(definition);
  if (!calls.length) return definition;
  const callOfNode = (id: string) => calls.find((call) => id.startsWith(`${call}/`));
  const nodes: WorkflowNode[] = definition.nodes.filter((node) => !callOfNode(node.id));
  for (const call of calls) {
    const first = definition.nodes.find((node) => node.id.startsWith(`${call}/`));
    nodes.push({ id: call, type: 'call', label: definition.calls![call]!.name, position: first?.position ?? { x: 0, y: 0 }, config: { workflowId: definition.calls![call]!.workflowId } });
  }
  const edges: WorkflowEdge[] = [];
  const seen = new Set<string>();
  for (const edge of definition.edges) {
    const from = callOfNode(edge.source);
    const to = callOfNode(edge.target);
    if (from && from === to) continue;
    const source = from ?? edge.source;
    const sourceHandle = from ? (edge.sourceHandle === 'error' ? 'error' : 'out') : edge.sourceHandle;
    const target = to ?? edge.target;
    const key = `${source}|${sourceHandle}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: from || to ? `${source}:${sourceHandle}>${target}` : edge.id, source, sourceHandle, target });
  }
  return { ...definition, nodes, edges };
}

/** `retrying`: on a 재요청 node, the lines it sent back that wait for the AI node again, with the failure kinds. */
export type LiveCounts = { queued: number; running: number; failed: number; calls?: number; limit?: number; passed?: number; retrying?: { count: number; kinds: Record<string, number> } };
interface RunCounts {
  nodes: { nodeId: string; state: string; count: number }[];
  passed: Record<string, number>;
  calls: Record<string, number>;
  callLimits: Record<string, number>;
  retrying?: Record<string, { count: number; kinds: Record<string, number> }>;
}

/**
 * Each node's live counts for the run graph, a folded call's card summing everything inside it (lines
 * waiting, running, failed; requests in flight against the 동시 처리 수 of its AI nodes). "지나감" is a
 * per-node count of distinct lines and cannot be added up, so a call card has none: see its nodes.
 */
export function liveCounts(definition: Pick<WorkflowDefinition, 'nodes' | 'calls'>, run: RunCounts): Map<string, LiveCounts> {
  const counts = new Map<string, LiveCounts>();
  const entry = (id: string) => counts.get(id) ?? (counts.set(id, { queued: 0, running: 0, failed: 0 }), counts.get(id)!);
  const holder = (nodeId: string) => callOf(definition, nodeId) ?? nodeId;
  for (const row of run.nodes) if (row.state === 'queued' || row.state === 'running' || row.state === 'failed') entry(holder(row.nodeId))[row.state] += row.count;
  for (const [nodeId, count] of Object.entries(run.passed)) if (!callOf(definition, nodeId)) entry(nodeId).passed = count;
  for (const [nodeId, retrying] of Object.entries(run.retrying ?? {})) entry(holder(nodeId)).retrying = retrying;
  for (const [nodeId, limit] of Object.entries(run.callLimits)) {
    const live = entry(holder(nodeId));
    live.limit = (live.limit ?? 0) + limit;
    live.calls = (live.calls ?? 0) + (run.calls[nodeId] ?? 0);
  }
  return counts;
}

export interface CallMember {
  node: WorkflowNode;
  /** The name within the call: nested calls read "안쪽 호출 › 노드 이름". */
  name: string;
  /** How many calls deeper than `call` the node sits (0 = in the call itself). */
  depth: number;
  counts: Record<string, number>;
}

/** The nodes inside a top-level call in definition order, each with its lines per state, for the list that opens from a call card. */
export function callMembers(definition: WorkflowDefinition, call: string, rows: RunCounts['nodes']): CallMember[] {
  return definition.nodes.filter((node) => node.id.startsWith(`${call}/`)).map((node) => {
    const trail = callTrail(definition, node.id).slice(1);
    const counts: Record<string, number> = {};
    for (const row of rows) if (row.nodeId === node.id) counts[row.state] = (counts[row.state] ?? 0) + row.count;
    return { node, name: [...trail, nodeName(node)].join(' › '), depth: trail.length, counts };
  });
}
