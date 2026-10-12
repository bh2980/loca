import type { GraphOrder } from './graph-order.ts';

/** The nearest choice or condition upstream of a line, and which of its ways leads to the line. */
export type Fork = { point: string; arm: string } | null;

/**
 * Events on different routes, for the timeline: two events are on different branches only when
 * their nearest choice or condition upstream is the same node and they lie down different ways
 * out of it, and neither leads to the other. Lines that merely do not reach each other (scenes a
 * game opens side by side from its state flow) are not branches: they keep script order. Branch
 * runs become one block with a lane per branch; an event every lane leads to starts the next block.
 */
export function withRoutes<T extends { id: string; at: { seq: number; key: string } | null }>(order: Pick<GraphOrder, 'has' | 'leadsTo'>, forkOf: (key: string) => Fork, events: T[]) {
  const apart = (a: string, b: string) => {
    const [x, y] = [forkOf(a), forkOf(b)];
    return !!x && !!y && x.point === y.point && x.arm !== y.arm && !order.leadsTo(a, b) && !order.leadsTo(b, a);
  };
  const route = new Map<string, { block: number; lane: number }>();
  const blocks: { lanes: T[][] }[] = [];
  for (const event of events.filter((candidate) => candidate.at).sort((a, b) => a.at!.seq - b.at!.seq)) {
    const current = blocks.at(-1);
    if (current && current.lanes.flat().some((other) => apart(other.at!.key, event.at!.key))) {
      const lane = current.lanes.findIndex((list) => order.leadsTo(list.at(-1)!.at!.key, event.at!.key));
      if (lane >= 0) current.lanes[lane].push(event);
      else current.lanes.push([event]);
    } else blocks.push({ lanes: [[event]] });
  }
  blocks.forEach((block, index) => block.lanes.forEach((lane, laneIndex) => lane.forEach((event) => route.set(event.id, { block: index, lane: laneIndex }))));
  return events.map((event) => ({ ...event, route: route.get(event.id) ?? null, lanes: route.has(event.id) ? blocks[route.get(event.id)!.block].lanes.length : 1 }));
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
            found = { point: parent, arm: id };
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
