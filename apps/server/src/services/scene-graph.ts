/**
 * Scene-level connections are derived, never extracted: scene A → scene B exists when some
 * dialogue node of A reaches a node of B through control nodes only (conditions, waits, …)
 * that belong to no scene. Edges inside one scene are not scene connections.
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
