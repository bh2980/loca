/**
 * Scene-level connections are derived, never extracted: scene A → scene B exists when some
 * dialogue node of A reaches a node of B through nodes that belong to no scene (conditions,
 * waits, documents, UI…). Edges inside one scene are not scene connections. Callers pass
 * groupId only for scene groups.
 */
export interface DerivedSceneEdge {
  from: string;
  to: string;
  /** Number of dialogue-graph paths that produced this scene connection. */
  weight: number;
}

export function deriveSceneEdges(
  nodes: { id: string; groupId: string | null }[],
  edges: { fromId: string; toId: string }[],
): DerivedSceneEdge[] {
  const groupOf = new Map(nodes.map((node) => [node.id, node.groupId]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.fromId);
    if (list) list.push(edge.toId);
    else outgoing.set(edge.fromId, [edge.toId]);
  }
  const result = new Map<string, DerivedSceneEdge>();
  for (const node of nodes) {
    if (!node.groupId) continue;
    const seen = new Set<string>([node.id]);
    const queue = [...(outgoing.get(node.id) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const group = groupOf.get(next);
      if (group) {
        if (group !== node.groupId) {
          const key = `${node.groupId}\u0000${group}`;
          const existing = result.get(key);
          if (existing) existing.weight++;
          else result.set(key, { from: node.groupId, to: group, weight: 1 });
        }
        continue;
      }
      queue.push(...(outgoing.get(next) ?? []));
    }
  }
  return [...result.values()];
}

/**
 * Display simplification for dense scene graphs: drop a link A → C when C is still reachable
 * from A through other kept links (A → B → C). Reachability between scenes is unchanged; the
 * dropped links are returned so the page can show them on request and say how many are hidden.
 */
export function reduceSceneEdges<T extends { from: string; to: string }>(edges: T[]): { kept: T[]; hidden: T[] } {
  const ordered = [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const next = new Map<string, Set<string>>();
  for (const edge of ordered) {
    const set = next.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    next.set(edge.from, set);
  }
  const reachableWithout = (from: string, to: string) => {
    const seen = new Set<string>([from]);
    const stack = [...(next.get(from) ?? [])].filter((node) => node !== to);
    while (stack.length) {
      const node = stack.pop()!;
      if (node === to) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...(next.get(node) ?? []));
    }
    return false;
  };
  const kept: T[] = [];
  const hidden: T[] = [];
  for (const edge of ordered) {
    if (reachableWithout(edge.from, edge.to)) {
      next.get(edge.from)!.delete(edge.to);
      hidden.push(edge);
    } else kept.push(edge);
  }
  return { kept, hidden };
}
