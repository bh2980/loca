import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();
export const EVENT_CARD = { width: 288, height: 92 };
export type EventFlowDirection = 'vertical' | 'horizontal';
export interface LayoutEvent { id: string; next: { id: string; label: string | null }[] }

/** One section laid out in the requested direction. Script-order links affect placement only. */
export async function layoutSection(events: LayoutEvent[], direction: EventFlowDirection) {
  const ids = new Set(events.map((event) => event.id));
  const real = events.flatMap((event) => event.next.filter((step) => ids.has(step.id)).map((step) => ({ id: `${event.id}>${step.id}`, from: event.id, to: step.id, label: step.label })));
  const reached = new Set(real.map((edge) => edge.to));
  // An event nothing leads to sits under/beside the one before it in script order.
  const order = events.slice(1).flatMap((event, i) => (reached.has(event.id) ? [] : [{ id: `order:${event.id}`, from: events[i]!.id, to: event.id }]));
  const graph: ElkNode = {
    id: 'section',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'vertical' ? 'DOWN' : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.spacing.nodeNode': '32',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
    },
    children: events.map((event) => ({ id: event.id, ...EVENT_CARD })),
    edges: [
      ...real.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to], labels: edge.label ? [{ text: edge.label, width: Math.min(160, edge.label.length * 12 + 12), height: 18 }] : [] })),
      ...order.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
    ],
  };
  const result = await elk.layout(graph);
  return { height: result.height ?? 0, positions: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])) };
}
