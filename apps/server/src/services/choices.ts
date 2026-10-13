/**
 * A player's choice in the dialogue graph is read as the label of the way it opens, like a
 * relationship written on its edge: an option node with one way in and one way out becomes one
 * edge "branch ─(LEAVE FISH)→ next line" that remembers the option (`via`, for selecting it).
 * Options with several ways in or out stay nodes (drawn as choice pills).
 */
export interface GraphEdgeIn {
  id: string;
  from: string;
  to: string;
  label?: string | null;
}
export interface GraphEdgeOut {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** The choice node this edge stands for. */
  via?: string;
}

export function foldChoices<N extends { id: string }>(nodes: N[], edges: GraphEdgeIn[], choiceText: Map<string, string>): { nodes: N[]; edges: GraphEdgeOut[]; folded: string[] } {
  const ins = new Map<string, GraphEdgeIn[]>();
  const outs = new Map<string, GraphEdgeIn[]>();
  for (const edge of edges) {
    (ins.get(edge.to) ?? ins.set(edge.to, []).get(edge.to)!).push(edge);
    (outs.get(edge.from) ?? outs.set(edge.from, []).get(edge.from)!).push(edge);
  }
  const folded = new Set<string>();
  const added: GraphEdgeOut[] = [];
  for (const [id, text] of choiceText) {
    const into = ins.get(id);
    const out = outs.get(id);
    if (into?.length !== 1 || out?.length !== 1 || into[0].from === id || out[0].to === id || folded.has(into[0].from) || folded.has(out[0].to)) continue;
    folded.add(id);
    added.push({ id: `via:${id}`, from: into[0].from, to: out[0].to, label: text, via: id });
  }
  return {
    nodes: nodes.filter((node) => !folded.has(node.id)),
    edges: [...edges.filter((edge) => !folded.has(edge.from) && !folded.has(edge.to)).map(({ label, ...edge }) => ({ ...edge, ...(label?.trim() && { label: label.trim() }) })), ...added],
    folded: [...folded],
  };
}
