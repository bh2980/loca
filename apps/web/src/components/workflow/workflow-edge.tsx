import { EdgeLabelPill, EdgeLabelRow, FoldChip, type FoldChipProps } from '@loca/ui';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';

export interface WorkflowEdgeData extends Record<string, unknown> {
  points?: { x: number; y: number }[];
  label?: string;
  labelPosition?: { x: number; y: number };
  /** Nodes folded into this line (a tag node): a chip beside the label. */
  fold?: FoldChipProps;
}

export type FlowEdge = Edge<WorkflowEdgeData, 'workflow'>;

const HANDLE_RADIUS = 5;

export function routeMatchesPorts(points: WorkflowEdgeData['points'], sourceX: number, sourceY: number, targetX: number, targetY: number): points is NonNullable<WorkflowEdgeData['points']> {
  if (!points || points.length < 2) return false;
  const first = points[0]!;
  const last = points.at(-1)!;
  // React Flow reports the outer handle edge while ELK routes to the node boundary.
  const tolerance = HANDLE_RADIUS + 1;
  return Math.abs(first.x - sourceX) <= tolerance && Math.abs(first.y - sourceY) <= tolerance
    && Math.abs(last.x - targetX) <= tolerance && Math.abs(last.y - targetY) <= tolerance;
}

/** Draw saved ELK geometry; use React Flow routing only before layout or after a manual node move. */
export function WorkflowEdgeView({
  id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  markerEnd, style, data,
}: EdgeProps<FlowEdge>) {
  const fallback = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 12, offset: 28 });
  const points = routeMatchesPorts(data?.points, sourceX, sourceY, targetX, targetY) ? data.points : undefined;
  const path = points
    ? points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
    : fallback[0];
  const labelPosition = points ? data?.labelPosition ?? { x: fallback[1], y: fallback[2] } : { x: fallback[1], y: fallback[2] };

  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeLinejoin: 'round', strokeLinecap: 'round' }} interactionWidth={26} />
    {data?.fold ? <EdgeLabelRenderer>
      <EdgeLabelRow style={{ transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)` }}>
        {data.label && <EdgeLabelPill>{data.label}</EdgeLabelPill>}
        <FoldChip {...data.fold} />
      </EdgeLabelRow>
    </EdgeLabelRenderer> : data?.label && <EdgeLabelRenderer>
      <EdgeLabelPill floating style={{ transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)` }}>{data.label}</EdgeLabelPill>
    </EdgeLabelRenderer>}
  </>;
}
