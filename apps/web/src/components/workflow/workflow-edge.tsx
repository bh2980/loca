import { EdgeAnchor, EdgeLabelPill, ExitTag, ExitTagAdd, type ExitTagItem } from '@loca/ui';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore, type Edge, type EdgeProps } from '@xyflow/react';

export interface WorkflowEdgeData extends Record<string, unknown> {
  points?: { x: number; y: number }[];
  label?: string;
  labelPosition?: { x: number; y: number };
  /**
   * What the exit this line leaves does to the lines (its 출구 동작), as its mark on the line where the layout kept room
   * (labelPosition), or at the middle of a line drawn plainly. A click opens the exit.
   */
  tag?: { items: ExitTagItem[]; exit: string; onOpen: () => void; selected?: boolean };
  /** A line no action is on: under the pointer, the way to put one there. */
  onAdd?: () => void;
  hovered?: boolean;
}

export type FlowEdge = Edge<WorkflowEdgeData, 'workflow'>;

const HANDLE_RADIUS = 5;
/** Zoomed out past this, chips become their marks only. */
const COMPACT_ZOOM = 0.4;

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

  const zoom = useStore((state) => state.transform[2]);
  // Laid out, the mark sits where the layout kept room for it; a line drawn plainly carries it at its middle.
  const tagAt = labelPosition;
  const centred = (at: { x: number; y: number }) => ({ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` });

  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeLinejoin: 'round', strokeLinecap: 'round' }} interactionWidth={26} />
    {data?.tag ? (
      <EdgeLabelRenderer>
        <EdgeAnchor at={tagAt}>
          <ExitTag items={data.tag.items} exit={data.tag.exit} label={data.label} selected={data.tag.selected} compact={zoom < COMPACT_ZOOM} onOpen={data.tag.onOpen} />
        </EdgeAnchor>
      </EdgeLabelRenderer>
    ) : (data?.label || (data?.hovered && data.onAdd)) && (
      <EdgeLabelRenderer>
        {data.label && <EdgeLabelPill floating style={centred(labelPosition)}>{data.label}</EdgeLabelPill>}
        {data.hovered && data.onAdd && (
          <EdgeAnchor at={data.label ? { x: labelPosition.x, y: labelPosition.y + 22 } : labelPosition}>
            <ExitTagAdd onAdd={data.onAdd} />
          </EdgeAnchor>
        )}
      </EdgeLabelRenderer>
    )}
  </>;
}
