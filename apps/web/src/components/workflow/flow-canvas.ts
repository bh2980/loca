/**
 * What the workflow editor's canvas and a run's graph share as React Flow graphs of one definition: the node and
 * edge views, the names they show, the sizes React Flow measured, fitting the whole graph, and 자동 정렬 (ELK over
 * what is drawn). What each draws on top (the editor's selection and draft, a run's live counts) is its own.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Edge, Node, NodeChange, ReactFlowInstance } from '@xyflow/react';
import type { WorkflowDefinition } from '@tw/shared';
import type { CanvasDirection } from '@loca/ui';
import { useConnections } from '@/lib/app-data';
import { useTaxonomy } from '@/lib/knowledge';
import { autoLayout } from './auto-layout';
import { tagRoomOf, type MarkNames } from './exit-marks';
import { flowNames } from './flow-graph';
import { FrameNodeView, FrameTintView } from './frames';
import { WorkflowNodeView } from './node-view';
import { WorkflowEdgeView } from './workflow-edge';

export const FLOW_NODE_TYPES = { workflow: WorkflowNodeView, frame: FrameNodeView, frameTint: FrameTintView };
export const FLOW_EDGE_TYPES = { workflow: WorkflowEdgeView };
/** The whole graph, with room around the canvas controls, never larger than 100%. */
export const FIT_WHOLE = { padding: 0.2, maxZoom: 1, minZoom: 0.05 };
/** A node card's size before React Flow has measured it. */
export const NODE_SIZE = { width: 224, height: 66 };

export type Size = { width: number; height: number };

/** The project's names a workflow graph shows (flow-graph.ts flowNames), the same object while they do not change. */
export function useFlowNames(projectId: string, workflows?: { id: string; name: string }[]) {
  const taxonomy = useTaxonomy(projectId);
  const connections = useConnections({ kind: 'project', projectId });
  const names = useMemo(() => flowNames({ statuses: taxonomy.statuses, tags: taxonomy.tags, connections: connections.data, workflows }), [taxonomy.statuses, taxonomy.tags, connections.data, workflows]);
  return { names, taxonomy, connections };
}

/**
 * The sizes React Flow measured, by node. It reports each as a 'dimensions' change; nodes rebuilt without those
 * sizes stay hidden (and their edges undrawn) until measured again, which never happens when the size did not
 * change. So the sizes are kept here and put back on every rebuild.
 */
export function useMeasuredSizes() {
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const record = useCallback((changes: readonly NodeChange[]) => {
    const sized = changes.flatMap((change) => (change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : []));
    if (sized.length) setSizes((previous) => ({ ...previous, ...Object.fromEntries(sized) }));
  }, []);
  return [sizes, record] as const;
}

/** Every node's size as drawn now (measured, else a card's usual size), for a layout. */
const drawnSizes = <N extends Node, E extends Edge>(flow: ReactFlowInstance<N, E>): Map<string, Size> =>
  new Map(flow.getNodes().map((node) => [node.id, { width: node.measured?.width ?? NODE_SIZE.width, height: node.measured?.height ?? NODE_SIZE.height }]));

/**
 * 자동 정렬: the definition as drawn (closed folds are not in it: their nodes and lines keep what they had), laid out
 * by ELK with the sizes on screen and the room each exit's marks need. Answers the laid-out definition and the sizes
 * it used.
 */
export async function arrangeFlow<N extends Node, E extends Edge>(flow: ReactFlowInstance<N, E>, drawn: WorkflowDefinition, direction: CanvasDirection, marks: MarkNames) {
  const sizes = drawnSizes(flow);
  return { sizes, next: await autoLayout(drawn, sizes, direction, tagRoomOf(drawn, marks)) };
}

/** Fits every node on screen. */
export function fitWhole<N extends Node, E extends Edge>(flow: ReactFlowInstance<N, E>, duration = 0) {
  if (!flow.getNodes().length) return;
  void flow.fitView({ ...FIT_WHOLE, duration });
}
