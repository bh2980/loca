/**
 * Where each dialogue-graph node sits in the script, as a sortable number. ELK breaks a cycle by
 * walking the nodes in the order it is given, so handing them over in script order makes the line
 * the script starts with the root of a loop (a "previous line" button leads back into it) instead
 * of whichever node the database returned first.
 *
 * A node with lines ranks at its first line's position. A node without (a condition, a wait) takes
 * the rank of the nearest node leading into it, else of the nearest it leads to, plus a fraction
 * per step so it sorts after (before) that node.
 */
export function scriptRanks(nodes: { id: string; seq: number | null }[], edges: { from: string; to: string }[]) {
  const rank = new Map<string, number>();
  for (const node of nodes) if (node.seq !== null) rank.set(node.id, node.seq);
  const links = (side: 'from' | 'to') => {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
      const [key, value] = side === 'from' ? [edge.from, edge.to] : [edge.to, edge.from];
      (map.get(key) ?? map.set(key, []).get(key)!).push(value);
    }
    return map;
  };
  for (const [map, step] of [[links('from'), 1e-6], [links('to'), -1e-6]] as const) {
    let frontier = [...rank.keys()];
    while (frontier.length) {
      const following: string[] = [];
      for (const id of frontier)
        for (const other of map.get(id) ?? [])
          if (!rank.has(other)) {
            rank.set(other, rank.get(id)! + step);
            following.push(other);
          }
      frontier = following;
    }
  }
  return rank;
}

/** Stable sort by rank; nodes without one keep their place after the ranked ones. */
export const byRank = <T extends { rank?: number }>(nodes: T[]) => {
  const at = (node: T) => node.rank ?? Infinity;
  return nodes.map((node, index) => ({ node, index })).sort((a, b) => (at(a.node) === at(b.node) ? 0 : at(a.node) < at(b.node) ? -1 : 1) || a.index - b.index).map(({ node }) => node);
};
