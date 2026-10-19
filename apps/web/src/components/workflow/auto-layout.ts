import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { nodePorts, type WorkflowDefinition } from '@tw/shared';
import type { CanvasDirection } from '@loca/ui';

const elk = new ELK();

/** ELK layered in the selected direction, keeping exits in listed order around each node. */
export async function autoLayout(definition: WorkflowDefinition, sizes: Map<string, { width: number; height: number }>, direction: CanvasDirection = 'vertical'): Promise<WorkflowDefinition> {
  const inputSide = direction === 'vertical' ? 'NORTH' : 'WEST';
  const outputSide = direction === 'vertical' ? 'SOUTH' : 'EAST';
  const edgeLabels = new Map(definition.edges.map((edge) => {
    const source = definition.nodes.find((node) => node.id === edge.source);
    const portLabel = source && nodePorts(source).find((port) => port.id === edge.sourceHandle)?.label;
    const branchCount = definition.edges.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length;
    const label = portLabel && (branchCount > 1 ? `${portLabel} · 모두 보냄` : portLabel);
    return [edge.id, label] as const;
  }));
  const result = await elk.layout({
    id: 'workflow',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'vertical' ? 'DOWN' : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.inline': 'true',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.spacing.nodeNode': '80',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.portConstraints': 'FIXED_POS',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      // Keep the drawn order (entry first, main path before retry loops) and route loops back around.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.feedbackEdges': 'true',
      'elk.layered.spacing.edgeNodeBetweenLayers': '32',
    },
    children: definition.nodes.map((node) => {
      const ports = nodePorts(node);
      const size = sizes.get(node.id) ?? { width: 224, height: 66 };
      return {
        id: node.id,
        width: size.width,
        height: size.height,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: [
          ...(node.type !== 'entry' ? [{
            id: `${node.id}:in`, x: direction === 'vertical' ? size.width / 2 : 0,
            y: direction === 'vertical' ? 0 : size.height / 2, width: 0, height: 0,
            layoutOptions: { 'elk.port.side': inputSide },
          }] : []),
          ...ports.map((port, index) => ({
            id: `${node.id}:${port.id}`,
            x: direction === 'vertical' ? ((index + 0.5) / ports.length) * size.width : size.width,
            y: direction === 'vertical' ? size.height : ((index + 0.5) / ports.length) * size.height,
            width: 0,
            height: 0,
            layoutOptions: { 'elk.port.side': outputSide },
          })),
        ],
      };
    }),
    edges: definition.edges.map((edge) => {
      const text = edgeLabels.get(edge.id);
      return {
        id: edge.id,
        sources: [`${edge.source}:${edge.sourceHandle}`],
        targets: [`${edge.target}:in`],
        ...(text && { labels: [{ id: `${edge.id}:label`, text, width: Math.max(36, [...text].length * 12 + 8), height: 20 }] }),
      };
    }),
  } as ElkNode);
  const positions = new Map((result.children ?? []).map((child) => [child.id, { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }]));
  const edgeLayouts = new Map((result.edges ?? []).map((edge) => {
    const sections = edge.sections ?? [];
    const points = sections.flatMap((section, index) => [
      ...(index === 0 && section.startPoint ? [section.startPoint] : []),
      ...(section.bendPoints ?? []),
      ...(section.endPoint ? [section.endPoint] : []),
    ]).map(({ x, y }) => ({ x, y }));
    const label = edge.labels?.[0];
    return [edge.id, {
      points,
      ...(label?.x !== undefined && label.y !== undefined && { labelPosition: { x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 } }),
    }] as const;
  }));
  return {
    ...definition,
    direction,
    nodes: definition.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    edges: definition.edges.map((edge) => ({ ...edge, layout: edgeLayouts.has(edge.id) ? edgeLayouts.get(edge.id) : undefined })),
  };
}
