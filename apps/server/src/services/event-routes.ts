import type { GraphOrder } from './graph-order.ts';

/** The nearest choice or condition upstream of a line, which of its ways leads to the line, its label, and whether it is a player's choice (not a condition). */
export type Fork = { point: string; arm: string; label: string | null; choice: boolean } | null;

/**
 * Events as a flow for the 사건 흐름 graph. An event leads to another when the player can go from
 * the first one's line to the second one's in the dialogue graph; only direct steps are kept (if A
 * leads to B and B to C, there is no A → C). One event leads to several only where they part at a
 * single choice or condition (a branch); a choice's ways carry its labels. Anything else — scenes a
 * state opens side by side, events that do not reach each other — gets no line and keeps script
 * order: lines are only drawn from the dialogue graph, never guessed.
 */
export function eventFlow<T extends { id: string; at: { seq: number; key: string } | null }>(order: Pick<GraphOrder, 'leadsTo'>, forkOf: (key: string) => Fork, events: T[]) {
  const placed = events.filter((event) => event.at).sort((a, b) => a.at!.seq - b.at!.seq);
  // Steps in one direction only: lines that reach each other both ways (a loop) are not an order.
  const leads = (a: T, b: T) => a.id !== b.id && order.leadsTo(a.at!.key, b.at!.key) && !order.leadsTo(b.at!.key, a.at!.key);
  const next = new Map<string, { id: string; label: string | null }[]>();
  for (const from of placed) {
    const reached = placed.filter((to) => leads(from, to));
    // Direct steps: reached events no other reached event leads to.
    const direct = reached.filter((to) => !reached.some((via) => via !== to && leads(via, to)));
    // Several ways out are a branch only when they part at one choice or condition. Scenes a
    // state node opens side by side (or that merely all come later) are not: no lines then.
    const forksOut = direct.map((to) => forkOf(to.at!.key));
    const branch = direct.length > 1 && forksOut.every((fork) => fork && fork.point === forksOut[0]!.point) && new Set(forksOut.map((fork) => fork!.arm)).size > 1;
    const steps = direct.length === 1 ? [{ id: direct[0].id, label: null }] : branch ? direct.map((to, i) => ({ id: to.id, label: forksOut[i]!.choice ? forksOut[i]!.label : null })) : [];
    if (steps.length) next.set(from.id, steps);
  }
  return events.map((event) => ({ ...event, next: next.get(event.id) ?? [] }));
}

/**
 * forkOf for a project's dialogue graph: walking back from a line's node, the first node that
 * splits the way (a condition, or a line whose ways out are labelled choices) and the node right
 * after it on the way back. Nodes are looked up by line key.
 */
export function forks(nodes: { id: string; kind: string; unitIds: string[] }[], edges: { fromId: string; toId: string; label: string | null }[], keyOf: Map<string, string>) {
  const outs = new Map<string, { to: string; label: string | null }[]>();
  const ins = new Map<string, string[]>();
  for (const edge of edges) {
    (outs.get(edge.fromId) ?? outs.set(edge.fromId, []).get(edge.fromId)!).push({ to: edge.toId, label: edge.label });
    (ins.get(edge.toId) ?? ins.set(edge.toId, []).get(edge.toId)!).push(edge.fromId);
  }
  const kind = new Map(nodes.map((node) => [node.id, node.kind]));
  const splits = (id: string) => {
    const ways = outs.get(id) ?? [];
    if (new Set(ways.map((way) => way.to)).size < 2) return false;
    return kind.get(id) === 'condition' || (kind.get(id) === 'script' && ways.every((way) => way.label?.trim()));
  };
  const nodeOfKey = new Map<string, string>();
  for (const node of nodes) for (const unitId of node.unitIds) {
    const key = keyOf.get(unitId);
    if (key && !nodeOfKey.has(key)) nodeOfKey.set(key, node.id);
  }
  const cache = new Map<string, Fork>();
  return (key: string): Fork => {
    const start = nodeOfKey.get(key);
    if (!start) return null;
    if (cache.has(start)) return cache.get(start)!;
    let found: Fork = null;
    const seen = new Set([start]);
    let frontier = [start];
    while (frontier.length && !found) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const parent of ins.get(id) ?? []) {
          if (splits(parent)) {
            found = { point: parent, arm: id, label: outs.get(parent)!.find((way) => way.to === id)?.label?.trim() || null, choice: kind.get(parent) !== 'condition' };
            break;
          }
          if (!seen.has(parent)) (seen.add(parent), next.push(parent));
        }
        if (found) break;
      }
      frontier = next;
    }
    cache.set(start, found);
    return found;
  };
}
