import ELK from 'elkjs/lib/elk.bundled.js';
import { NODE_TYPES, type WorkflowDefinition } from '@tw/shared';

const elk = new ELK();

/** ELK layered, left to right, with port order fixed so exits stay in their listed order. */
export async function autoLayout(definition: WorkflowDefinition, sizes: Map<string, { width: number; height: number }>): Promise<WorkflowDefinition> {
  const result = await elk.layout({
    id: 'workflow',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.portConstraints': 'FIXED_ORDER',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children: definition.nodes.map((node) => {
      const size = sizes.get(node.id) ?? { width: 224, height: 120 };
      return {
        id: node.id,
        width: size.width,
        height: size.height,
        layoutOptions: { 'elk.portConstraints': 'FIXED_ORDER' },
        ports: [
          ...(NODE_TYPES[node.type].hasInput ? [{ id: `${node.id}:in`, layoutOptions: { 'elk.port.side': 'WEST' } }] : []),
          ...NODE_TYPES[node.type].outputs.map((port, index) => ({ id: `${node.id}:${port.id}`, layoutOptions: { 'elk.port.side': 'EAST', 'elk.port.index': String(index) } })),
        ],
      };
    }),
    edges: definition.edges.map((edge) => ({ id: edge.id, sources: [`${edge.source}:${edge.sourceHandle}`], targets: [`${edge.target}:in`] })),
  });
  const positions = new Map((result.children ?? []).map((child) => [child.id, { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }]));
  return { ...definition, nodes: definition.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) };
}
