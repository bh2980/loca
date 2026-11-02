/**
 * 프레임: the steps a workflow stores (definition.groups) drawn as boxes in the editor and a run's graph, as Figma draws
 * its sections. A frame is not a node of the workflow: it stands where its stored box is (auto layout sets it, a person
 * moves or resizes it), grown to hold any node of its own outside it (one added from the CLI, a frame without a box),
 * and sits behind the nodes. Its edge does not move while nodes are dragged, so where a node is let go says where it
 * belongs: inside a frame, in it; outside every frame, in none. Only its header takes the pointer: dragging it moves the
 * frame and its nodes, clicking it picks the frame; the room inside lets the canvas pan.
 */
import { memo, type ReactNode } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { FRAME_HEADER, FRAME_PAD, WorkflowFrame, WorkflowFrameTint } from '@loca/ui';
import type { WorkflowDefinition, WorkflowGroup } from '@tw/shared';
import { shiftRoute } from './route-shift';

export const FRAME_PREFIX = 'frame:';
export const isFrameId = (id: string) => id.startsWith(FRAME_PREFIX);
export const frameId = (groupId: string) => `${FRAME_PREFIX}${groupId}`;
export const groupIdOf = (id: string) => id.slice(FRAME_PREFIX.length);

type FrameBox = NonNullable<WorkflowGroup['box']>;
type Sizes = Readonly<Record<string, { width: number; height: number } | undefined>>;
type Placed = { id: string; position: { x: number; y: number } };
const DEFAULT_SIZE = { width: 224, height: 66 };
const MIN = { width: 200, height: 120 };

export type FrameNode = Node<{
  label: string;
  meta?: string;
  live?: ReactNode;
  over?: boolean;
  /** Picked (kept here, not as React Flow's selection, which would raise the frame over its nodes). */
  picked?: boolean;
  renaming?: boolean;
  onRename?: (label: string) => void;
  onRenamed?: () => void;
  onUngroup?: () => void;
  onDelete?: () => void;
  ungroupKey?: string;
  onResize?: (box: FrameBox) => void;
}, 'frame'>;

export const FrameNodeView = memo(function FrameNodeView({ data }: NodeProps<FrameNode>) {
  return (
    <>
      {data.onResize && (
        <NodeResizer
          isVisible={Boolean(data.picked)}
          minWidth={MIN.width}
          minHeight={MIN.height}
          color="var(--border-color-accent)"
          // The frame lets the pointer through (its room pans the canvas); its handles take it.
          handleStyle={{ pointerEvents: 'auto', width: 8, height: 8, borderRadius: 2 }}
          lineStyle={{ pointerEvents: 'auto', borderWidth: 2 }}
          onResizeEnd={(_event, box) => data.onResize?.({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) })}
        />
      )}
      <WorkflowFrame label={data.label} meta={data.meta} live={data.live} over={data.over} selected={data.picked} renaming={data.renaming} onRename={data.onRename} onRenamed={data.onRenamed} onUngroup={data.onUngroup} onDelete={data.onDelete} ungroupKey={data.ungroupKey} />
    </>
  );
});

export type FrameTintNode = Node<{ picked?: boolean; over?: boolean }, 'frameTint'>;
export const FrameTintView = memo(function FrameTintView({ data }: NodeProps<FrameTintNode>) {
  return <WorkflowFrameTint selected={data.picked} over={data.over} />;
});

/**
 * Each frame's edge and shade, under the lines and under the frame itself (header and all, also under the lines); it
 * shows the frame picked or a drop target too. Its id starts with FRAME_PREFIX, so the pages
 * leave it out of node changes; it takes no pointer.
 */
export const frameTints = (frames: readonly FrameNode[]): FrameTintNode[] => frames.map((frame) => ({
  id: `${FRAME_PREFIX}tint:${groupIdOf(frame.id)}`,
  type: 'frameTint',
  position: frame.position,
  width: frame.width,
  height: frame.height,
  style: { width: frame.width, height: frame.height, pointerEvents: 'none' },
  zIndex: -1,
  draggable: false,
  selectable: false,
  focusable: false,
  deletable: false,
  connectable: false,
  data: { picked: frame.data.picked, over: frame.data.over },
}));

/** The box that holds the given nodes with the frame's room around them (FRAME_PAD, FRAME_HEADER above). */
function membersBox(members: readonly Placed[], sizes: Sizes): FrameBox | undefined {
  if (!members.length) return undefined;
  const size = (id: string) => sizes[id] ?? DEFAULT_SIZE;
  const left = Math.min(...members.map((member) => member.position.x)) - FRAME_PAD;
  const top = Math.min(...members.map((member) => member.position.y)) - FRAME_PAD - FRAME_HEADER;
  const right = Math.max(...members.map((member) => member.position.x + size(member.id).width)) + FRAME_PAD;
  const bottom = Math.max(...members.map((member) => member.position.y + size(member.id).height)) + FRAME_PAD;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const union = (a: FrameBox | undefined, b: FrameBox | undefined): FrameBox | undefined => {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/** Where a frame is drawn: its stored box, grown to hold every node of it that is shown. */
export function frameBox(group: WorkflowGroup, shown: readonly Placed[], sizes: Sizes): FrameBox | undefined {
  const ids = new Set(group.nodeIds);
  return union(group.box, membersBox(shown.filter((node) => ids.has(node.id)), sizes));
}

/**
 * The frames to draw, the larger first (a smaller one standing in a larger one's room is drawn over it). A frame with no
 * box and none of its nodes shown is left out; an empty frame with a box is drawn (one drawn to put nodes in). `meta` counts every node it holds (folded ones too), `live` is what the
 * page puts in its header. `frozen` boxes stand in for the computed ones while nodes are dragged (the edge stays put).
 */
export function frameNodes(
  shown: readonly Placed[],
  groups: readonly WorkflowGroup[] | undefined,
  sizes: Sizes,
  live?: (group: WorkflowGroup) => ReactNode,
  frozen?: ReadonlyMap<string, FrameBox>,
): FrameNode[] {
  const drawn = (groups ?? []).flatMap((group): FrameNode[] => {
    const box = frozen?.get(group.id) ?? frameBox(group, shown, sizes);
    if (!box) return [];
    return [{
      id: frameId(group.id),
      type: 'frame',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      style: { width: box.width, height: box.height, pointerEvents: 'none' },
      // Under the lines, header and all (a line into the frame runs over its name), above its shade (frameTints, listed
      // before it at the same level), under the nodes. Only the header drags it (the room inside pans the canvas).
      zIndex: -1,
      dragHandle: '[data-frame-handle]',
      deletable: false,
      connectable: false,
      data: { label: group.label, meta: group.nodeIds.length ? `노드 ${group.nodeIds.length}` : '비어 있음', live: live?.(group) },
    }];
  });
  return drawn.sort((a, b) => b.width! * b.height! - a.width! * a.height!);
}

/**
 * The definition with a frame and its nodes moved by (dx, dy): what dragging the frame's header does. `shown` are the
 * nodes on the canvas (a folded one keeps a position it is not drawn at, so it does not size the frame).
 */
export function moveFrame(definition: WorkflowDefinition, groupId: string, dx: number, dy: number, sizes: Sizes = {}, shown: readonly Placed[] = definition.nodes): WorkflowDefinition {
  const group = definition.groups?.find((item) => item.id === groupId);
  const members = new Set(group?.nodeIds ?? []);
  const box = group && frameBox(group, shown, sizes);
  return {
    ...definition,
    nodes: definition.nodes.map((node) => (members.has(node.id) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node)),
    // Its lines keep their shape: inside the frame they move with it, to or from it their end moves (shiftRoute).
    edges: definition.edges.map((edge) => (members.has(edge.source) || members.has(edge.target) ? { ...edge, layout: shiftRoute(edge.layout, members.has(edge.source) ? { dx, dy } : { dx: 0, dy: 0 }, members.has(edge.target) ? { dx, dy } : { dx: 0, dy: 0 }) } : edge)),
    groups: definition.groups?.map((item) => (item.id === groupId && box ? { ...item, box: { ...box, x: box.x + dx, y: box.y + dy } } : item)),
  };
}

/**
 * The definition with a frame standing at `box` (resized from a corner or edge). What it now covers is in it, as when a
 * node is let go: a shown node of its own whose middle is left outside leaves it, a shown node in no frame whose middle
 * it now covers joins it (a node in another frame stays there).
 */
export function resizeFrame(definition: WorkflowDefinition, groupId: string, box: FrameBox, sizes: Sizes = {}, shown: ReadonlySet<string> = new Set(definition.nodes.map((node) => node.id))): WorkflowDefinition {
  const covers = (node: Placed) => {
    const size = sizes[node.id] ?? DEFAULT_SIZE;
    const x = node.position.x + size.width / 2;
    const y = node.position.y + size.height / 2;
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  };
  const framed = new Set((definition.groups ?? []).flatMap((group) => group.nodeIds));
  const drawn = definition.nodes.filter((node) => shown.has(node.id) && node.type !== 'entry' && node.type !== 'end');
  return {
    ...definition,
    groups: definition.groups?.map((group) => group.id !== groupId ? group : {
      ...group,
      box,
      nodeIds: [
        ...group.nodeIds.filter((id) => { const node = drawn.find((item) => item.id === id); return !node || covers(node); }),
        ...drawn.filter((node) => !framed.has(node.id) && covers(node)).map((node) => node.id),
      ],
    }),
  };
}

/**
 * Every frame's box made to hold its shown nodes where they now are, and stored: after nodes join a frame or move, the
 * frame keeps the size it was drawn at (it does not shrink back when one later leaves). `shown` are the nodes on the
 * canvas, at their positions in `definition` (a folded node is not drawn where its position says).
 */
export const fitFrames = (definition: WorkflowDefinition, sizes: Sizes, shown: ReadonlySet<string> = new Set(definition.nodes.map((node) => node.id))): WorkflowDefinition => ({
  ...definition,
  groups: definition.groups?.map((group) => {
    const box = frameBox(group, definition.nodes.filter((node) => shown.has(node.id)), sizes);
    return box ? { ...group, box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } } : group;
  }),
});

/** Frames without the nodes that are gone (a deleted node leaves its frame; the frame stays, empty or not, until it is ungrouped). */
export const pruneGroups = (groups: WorkflowGroup[] | undefined, nodes: readonly { id: string }[]) => {
  if (!groups) return groups;
  const ids = new Set(nodes.map((node) => node.id));
  return groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => ids.has(id)) }));
};

/** The id of the frame a node is in, if any. */
export const groupOf = (groups: readonly WorkflowGroup[] | undefined, nodeId: string) => groups?.find((group) => group.nodeIds.includes(nodeId))?.id;

/**
 * The definition with `nodeIds` moved into the frame `groupId` (null: out of every frame). A node is in one frame at most,
 * so they leave the one they were in (a frame left empty stays, as drawn).
 */
export function moveIntoGroup(definition: WorkflowDefinition, nodeIds: readonly string[], groupId: string | null): WorkflowDefinition {
  const moving = new Set(nodeIds);
  const groups = (definition.groups ?? [])
    .map((group) => ({ ...group, nodeIds: [...group.nodeIds.filter((id) => !moving.has(id)), ...(group.id === groupId ? nodeIds : [])] }));
  return { ...definition, groups };
}

/**
 * The definition with a new frame holding `nodeIds` (taken out of the frames they were in), standing around them. It
 * goes where the first of them was in reading order, or last.
 */
export function groupNodes(definition: WorkflowDefinition, nodeIds: readonly string[], sizes: Sizes, label = '새 단계', groupId = `g-${crypto.randomUUID().slice(0, 8)}`): { definition: WorkflowDefinition; groupId: string } {
  const groups = definition.groups ?? [];
  const at = groups.findIndex((group) => group.nodeIds.some((id) => nodeIds.includes(id)));
  const placed = [...groups];
  const ids = new Set(nodeIds);
  const box = membersBox(definition.nodes.filter((node) => ids.has(node.id)), sizes);
  placed.splice(at < 0 ? groups.length : at, 0, { id: groupId, label, nodeIds: [], ...(box && { box }) });
  return { definition: moveIntoGroup({ ...definition, groups: placed }, nodeIds, groupId), groupId };
}

/**
 * The definition with a new frame standing at `box` (drawn on the canvas, or added at a point): it takes in the shown
 * nodes in no frame whose middle it covers, as a resize does. It is listed after the last frame that stands before it
 * across the reading direction (so auto layout keeps it there).
 */
export function addFrame(definition: WorkflowDefinition, box: FrameBox, sizes: Sizes, shown: ReadonlySet<string>, direction: 'vertical' | 'horizontal', label = '새 단계', groupId = `g-${crypto.randomUUID().slice(0, 8)}`): { definition: WorkflowDefinition; groupId: string } {
  const groups = definition.groups ?? [];
  const across = (item: FrameBox) => (direction === 'vertical' ? item.x : item.y);
  const at = groups.findIndex((group) => {
    const other = frameBox(group, definition.nodes.filter((node) => shown.has(node.id)), sizes);
    return other && across(other) > across(box);
  });
  const placed = [...groups];
  placed.splice(at < 0 ? groups.length : at, 0, { id: groupId, label, nodeIds: [], box });
  return { definition: resizeFrame({ ...definition, groups: placed }, groupId, box, sizes, shown), groupId };
}

/** The definition without the frame `groupId`; its nodes stay where they are, out of any frame. */
export const ungroup = (definition: WorkflowDefinition, groupId: string): WorkflowDefinition => ({
  ...definition,
  groups: (definition.groups ?? []).filter((group) => group.id !== groupId),
});

export const renameGroup = (definition: WorkflowDefinition, groupId: string, label: string): WorkflowDefinition => ({
  ...definition,
  groups: (definition.groups ?? []).map((group) => (group.id === groupId ? { ...group, label } : group)),
});

type Box = { position: { x: number; y: number }; width?: number; height?: number };
/** The frame (of those drawn) whose box holds the point, the innermost being the smallest; `except` is skipped. */
export function frameAt(frames: readonly (Box & { id: string })[], point: { x: number; y: number }, except?: string): string | undefined {
  const holding = frames.filter((frame) => frame.id !== except && point.x >= frame.position.x && point.x <= frame.position.x + (frame.width ?? 0) && point.y >= frame.position.y && point.y <= frame.position.y + (frame.height ?? 0));
  holding.sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0));
  return holding[0]?.id;
}
