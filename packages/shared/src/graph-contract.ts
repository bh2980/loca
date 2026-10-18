/**
 * Leaving nodes out of a directed graph without cutting the flow through them: every visible node
 * gets a derived edge to each visible node it reaches through hidden nodes only, however far.
 * `via` lists the hidden nodes on those paths (what the edge stands for). Pairs already joined by a
 * visible edge get none. Each derived edge stands for real paths in the graph; nothing is invented.
 */
export function contractEdges(edges: readonly { from: string; to: string }[], hidden: ReadonlySet<string>): { from: string; to: string; via: string[] }[] {
  if (!hidden.size) return [];
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const edge of edges) {
    (out.get(edge.from) ?? out.set(edge.from, []).get(edge.from)!).push(edge.to);
    (into.get(edge.to) ?? into.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  const direct = new Set(edges.filter((edge) => !hidden.has(edge.from) && !hidden.has(edge.to)).map((edge) => `${edge.from}\n${edge.to}`));
  // Hidden nodes from which `to` is reached through hidden nodes only (cached per target).
  const leadsTo = new Map<string, Set<string>>();
  const backFrom = (to: string) => {
    let found = leadsTo.get(to);
    if (found) return found;
    found = new Set<string>();
    const queue = (into.get(to) ?? []).filter((id) => hidden.has(id));
    while (queue.length) {
      const id = queue.pop()!;
      if (found.has(id)) continue;
      found.add(id);
      for (const prev of into.get(id) ?? []) if (hidden.has(prev)) queue.push(prev);
    }
    leadsTo.set(to, found);
    return found;
  };
  const derived: { from: string; to: string; via: string[] }[] = [];
  for (const [from, targets] of out) {
    if (hidden.has(from)) continue;
    const reached = new Set<string>();
    const ends = new Set<string>();
    const queue = targets.filter((id) => hidden.has(id));
    while (queue.length) {
      const id = queue.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const to of out.get(id) ?? []) {
        if (hidden.has(to)) queue.push(to);
        else if (to !== from && !direct.has(`${from}\n${to}`)) ends.add(to);
      }
    }
    for (const to of ends) {
      const back = backFrom(to);
      derived.push({ from, to, via: [...reached].filter((id) => back.has(id)) });
    }
  }
  return derived;
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
