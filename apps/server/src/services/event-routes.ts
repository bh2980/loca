import type { GraphOrder } from './graph-order.ts';

/**
 * Events on different routes, for the timeline: in script order, an event the dialogue graph
 * cannot reach from an earlier one nor lead to (both in the same connected part) is on another
 * branch. Such runs become one block with a lane per branch; an event every lane leads to (where
 * the routes meet) starts the next block. Events outside the graph stay in script order.
 */
export function withRoutes<T extends { id: string; at: { seq: number; key: string } | null }>(order: Pick<GraphOrder, 'has' | 'passage' | 'leadsTo'>, events: T[]) {
  const apart = (a: string, b: string) => order.has(a) && order.has(b) && order.passage(a, b) !== 'unknown' && !order.leadsTo(a, b) && !order.leadsTo(b, a);
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
