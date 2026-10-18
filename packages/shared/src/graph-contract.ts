/**
 * Hiding nodes of a directed graph without cutting the flow through them: every visible node gets
 * a derived edge to each visible node it reaches through hidden nodes only (at most `maxDepth`
 * hidden steps). Pairs already joined by a visible edge get none. Each derived edge stands for a
 * real path in the graph; no connection is invented.
 */
export function contractEdges(edges: readonly { from: string; to: string }[], hidden: ReadonlySet<string>, maxDepth = 12): { from: string; to: string }[] {
  if (!hidden.size) return [];
  const out = new Map<string, string[]>();
  for (const edge of edges) (out.get(edge.from) ?? out.set(edge.from, []).get(edge.from)!).push(edge.to);
  const direct = new Set(edges.filter((edge) => !hidden.has(edge.from) && !hidden.has(edge.to)).map((edge) => `${edge.from}\n${edge.to}`));
  const derived = new Map<string, { from: string; to: string }>();
  for (const [from, targets] of out) {
    if (hidden.has(from)) continue;
    const seen = new Set<string>();
    let frontier = targets.filter((id) => hidden.has(id));
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        if (seen.has(id)) continue;
        seen.add(id);
        for (const to of out.get(id) ?? []) {
          if (hidden.has(to)) next.push(to);
          else if (to !== from && !direct.has(`${from}\n${to}`)) derived.set(`${from}\n${to}`, { from, to });
        }
      }
      frontier = next;
    }
  }
  return [...derived.values()];
}

/**
 * Every node on some path from a start node to an end node (both included): reachable forwards
 * from `start` and backwards from `end`. All branches between the two, not one route.
 */
export function nodesBetween(edges: readonly { from: string; to: string }[], start: Iterable<string>, end: Iterable<string>): Set<string> {
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const edge of edges) {
    (out.get(edge.from) ?? out.set(edge.from, []).get(edge.from)!).push(edge.to);
    (into.get(edge.to) ?? into.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  const reach = (from: Iterable<string>, next: Map<string, string[]>) => {
    const seen = new Set(from);
    const queue = [...seen];
    while (queue.length) for (const id of next.get(queue.pop()!) ?? []) if (!seen.has(id)) (seen.add(id), queue.push(id));
    return seen;
  };
  const forward = reach(start, out);
  const backward = reach(end, into);
  return new Set([...forward].filter((id) => backward.has(id)));
}

/** Nodes that carry no line: conditions, waits, state changes, connectors. Choices stay (they are branches the reader sees). */
export const isControlNode = (node: { kind: string; unitIds: readonly string[] }) => node.kind !== 'script' && node.kind !== 'choice' && node.unitIds.length === 0;
