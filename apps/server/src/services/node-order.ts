type OrderNode = { id: string; unitIds: string[] };
type OrderEdge = { from: string; to: string };

/**
 * Script order for the dialogue graph's nodes, as a comparison. A node's place is its first line;
 * a node without lines stands just before the first line after it (the further ahead that line,
 * the earlier), so a fork without lines comes before its own arms. Ties break by id.
 */
export function nodeOrder(nodes: OrderNode[], edges: OrderEdge[], units: Map<string, { seq: number }>): (a: string, b: string) => number {
  const out = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) if (out.has(edge.from) && out.has(edge.to) && edge.from !== edge.to) out.get(edge.from)!.push(edge.to);
  const own = new Map(nodes.map((node) => [node.id, Math.min(Infinity, ...node.unitIds.map((id) => units.get(id)?.seq ?? Infinity))]));
  const lead = new Map(own);
  for (const node of nodes) {
    if (lead.get(node.id) !== Infinity) continue;
    const seen = new Set([node.id]);
    let frontier = [node.id];
    let found = Infinity;
    let steps = 0;
    for (let depth = 0; depth < 8 && frontier.length && found === Infinity; depth++) {
      steps = depth + 1;
      const next: string[] = [];
      for (const id of frontier)
        for (const to of out.get(id)!) {
          if (seen.has(to)) continue;
          seen.add(to);
          if (own.get(to)! !== Infinity) found = Math.min(found, own.get(to)!);
          else next.push(to);
        }
      frontier = next;
    }
    lead.set(node.id, found - steps / 16);
  }
  return (a, b) => lead.get(a)! - lead.get(b)! || (a < b ? -1 : a > b ? 1 : 0);
}
