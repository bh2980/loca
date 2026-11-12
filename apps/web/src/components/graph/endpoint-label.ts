/** What an end of a reading route needs of its node: its lines in order, and what to call it without any. */
interface EndpointNode {
  key: string;
  label?: string | null;
  units: readonly { source: string; speaker?: string | null }[];
}

/**
 * How an end of a reading route reads in the endpoint bar, wherever the bar is shown (while picking, and over the
 * route): the line the route starts or ends at (a node's first line for a start, its last for an end) with who says
 * it, then the node's key and how many lines the node holds. A node without lines is its label.
 */
export function endpointLabel(node: EndpointNode, role: 'start' | 'end'): string {
  if (!node.units.length) return node.label ?? node.key;
  const unit = role === 'start' ? node.units[0]! : node.units[node.units.length - 1]!;
  const text = unit.source.replace(/\s+/g, ' ').trim();
  const speaker = unit.speaker?.trim();
  return `${speaker ? `${speaker}: ` : ''}${text}${node.key ? ` · ${node.key}` : ''}${node.units.length > 1 ? ` · ${node.units.length}줄` : ''}`;
}
