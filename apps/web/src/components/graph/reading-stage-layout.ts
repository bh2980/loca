/** A story remains one line in either orientation; parallel contents stay inside their stage. */
export function readingStageLayout(ids: string[], direction: 'vertical' | 'horizontal') {
  const horizontal = direction === 'horizontal';
  const nodes = ids.map((id, index) => ({ id, x: horizontal ? 48 + index * 360 : 20, y: horizontal ? 48 : 48 + index * 168, width: 280, height: 104 }));
  const edges = nodes.slice(1).map((node, index) => {
    const previous = nodes[index]!;
    const points = horizontal
      ? [previous.x + previous.width, previous.y + previous.height / 2, node.x, node.y + node.height / 2]
      : [previous.x + previous.width / 2, previous.y + previous.height, node.x + node.width / 2, node.y];
    return { id: `selected-route:${previous.id}:${node.id}`, from: previous.id, to: node.id, points };
  });
  return { nodes, edges };
}
