import type { GraphOrder } from './graph-order.ts';

/** The nearest choice or condition upstream of a line, which of its ways leads to the line, and that way's label. */
export type Fork = { point: string; arm: string; label: string | null } | null;

/**
 * Events as a flow for the 사건 흐름 graph. An event leads to another when the player can go from
 * the first one's line to the second one's in the dialogue graph; only direct steps are kept (if A
 * leads to B and B to C, there is no A → C). Where one event leads to several, each step is named
 * by the choice or condition way it takes, when the graph labels it. Events that do not reach each
 * other get no line at all: lines are only drawn from the dialogue graph (scenes a game opens side
 * by side are not branches), and such events simply keep script order.
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
    const steps = direct.map((to) => ({ id: to.id, label: direct.length > 1 ? (forkOf(to.at!.key)?.label ?? null) : null }));
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
            found = { point: parent, arm: id, label: outs.get(parent)!.find((way) => way.to === id)?.label?.trim() || null };
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
