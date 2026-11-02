import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { nodePorts, type WorkflowDefinition } from '@tw/shared';
import { FRAME_HEADER, FRAME_PAD, type CanvasDirection } from '@loca/ui';

const elk = new ELK();

/**
 * The room an exit's mark takes (exitTagSize). `edge`: a line's (an exit's mark is on its first line); `exit`: the mark
 * of an exit no line leaves, at the end of its short line. None: no mark there.
 */
export interface TagRoom {
  edge: (edge: WorkflowDefinition['edges'][number]) => { width: number; height: number } | undefined;
  exit: (nodeId: string, port: string) => { width: number; height: number } | undefined;
}

type Box = { left: number; top: number; right: number; bottom: number };
type Point = { x: number; y: number };

/** The short line an exit no line leaves draws before its mark (the canvas's ExitMarks draws the same, or longer). */
const END_STEM = 28;
/** How far the hidden entry and end nodes sit from the node they lead to or end: off the drawing, on a straight line. */
const MARK_GAP = 72;

/**
 * Where a line carries its exit's mark: on its longest run past the first (out of the port), outside every frame when
 * the line goes from one frame to another (`avoid`), slid along the run until it is clear of every node and mark
 * already placed (`blocked`); `taken` gets the spot. None clear: the middle of its longest run.
 */
function lineSpot(points: Point[], room: { width: number; height: number } | undefined, avoid: Box[], blocked: Box[], taken: Box[], shared: (from: Point, to: Point) => boolean = () => false) {
  const runs = points.slice(1).map((point, index) => ({ from: points[index]!, to: point, length: Math.abs(point.x - points[index]!.x) + Math.abs(point.y - points[index]!.y) }));
  const mid = (run: (typeof runs)[number]) => ({ x: (run.from.x + run.to.x) / 2, y: (run.from.y + run.to.y) / 2 });
  // The longest stretch of each run outside every box in `avoid` (between frames), as a run of its own.
  const outside = (run: (typeof runs)[number]) => {
    // ELK's points carry float noise (199.00000000000003): a run is flat when its ends are within half a pixel.
    const flat = Math.abs(run.from.y - run.to.y) < 0.5;
    const across = flat ? run.from.y : run.from.x;
    const [low, high] = flat ? [Math.min(run.from.x, run.to.x), Math.max(run.from.x, run.to.x)] : [Math.min(run.from.y, run.to.y), Math.max(run.from.y, run.to.y)];
    const cuts = avoid.filter((box) => (flat ? across > box.top && across < box.bottom : across > box.left && across < box.right))
      .map((box) => (flat ? [box.left, box.right] : [box.top, box.bottom]) as [number, number]).sort((a, b) => a[0] - b[0]);
    let best: [number, number] | undefined;
    let at = low;
    for (const [start, end] of [...cuts, [Infinity, Infinity] as [number, number]]) {
      const stop = Math.min(start, high);
      if (stop > at && (!best || stop - at > best[1] - best[0])) best = [at, stop];
      at = Math.max(at, end);
      if (at >= high) break;
    }
    if (!best) return undefined;
    const [a, b] = best;
    return flat ? { from: { x: a, y: across }, to: { x: b, y: across }, length: b - a } : { from: { x: across, y: a }, to: { x: across, y: b }, length: b - a };
  };
  // Not on a run another line runs along too (lines into the same input merge before it): the mark would be anyone's.
  // Past the first run if it can; else its first run (out of the port), the one part of it that is its own.
  const later = (runs.length > 1 ? runs.slice(1) : runs).filter((run) => !shared(run.from, run.to));
  const own = later.length ? later : runs.filter((run) => !shared(run.from, run.to));
  const candidates = (own.length ? own : runs.length > 1 ? runs.slice(1) : runs).flatMap((run) => (avoid.length ? [outside(run)].filter((item) => item !== undefined) : [run]));
  const ordered = [...(candidates.length ? candidates : runs)].sort((a, b) => b.length - a.length);
  if (!ordered[0]) return undefined;
  if (!room) return mid(ordered[0]);
  const boxAt = (at: Point) => ({ left: at.x - room.width / 2 - 4, top: at.y - room.height / 2 - 2, right: at.x + room.width / 2 + 4, bottom: at.y + room.height / 2 + 2 });
  const clear = (box: Box) => !blocked.some((other) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom);
  for (const run of ordered) {
    const vertical = Math.abs(run.from.x - run.to.x) < 0.5;
    const low = vertical ? Math.min(run.from.y, run.to.y) : Math.min(run.from.x, run.to.x);
    const high = vertical ? Math.max(run.from.y, run.to.y) : Math.max(run.from.x, run.to.x);
    const step = (vertical ? room.height : room.width) / 2 + 4;
    for (const shift of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const at = vertical ? { x: run.from.x, y: mid(run).y + shift * step } : { x: mid(run).x + shift * step, y: run.from.y };
      const along = vertical ? at.y : at.x;
      if (along < low || along > high) continue;
      if (clear(boxAt(at))) {
        taken.push(boxAt(at));
        blocked.push(boxAt(at));
        return at;
      }
    }
  }
  const at = mid(ordered[0]);
  taken.push(boxAt(at));
  return at;
}

/**
 * The workflow laid out by ELK in one run, its frames (definition.groups) included: each frame a node holding its nodes
 * (with the frame's padding and header), so ELK places the frames and routes every line, the ones between frames too,
 * each on a track of its own (edge–edge spacing: no two lines share a run). Nodes read top to bottom (or left to right),
 * in the workflow's order, loops routed back around. An exit's mark goes on its first line, clear of the nodes and the
 * other marks; an exit no line leaves keeps the room for its mark right after it (its port's label). An empty frame is a
 * box of its own size. The hidden entry and end nodes sit off the drawing, next to the node they lead to or end.
 */
export async function autoLayout(definition: WorkflowDefinition, sizes: Map<string, { width: number; height: number }>, direction: CanvasDirection = 'vertical', tagRoom?: TagRoom): Promise<WorkflowDefinition> {
  const vertical = direction === 'vertical';
  const drawn = definition.nodes.filter((node) => node.type !== 'entry' && node.type !== 'end');
  const drawnIds = new Set(drawn.map((node) => node.id));
  const groups = (definition.groups ?? []).map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => drawnIds.has(id)) }));
  // A frame whose nodes are all folded away is left out; one drawn empty (to put nodes in) keeps its size.
  const kept = groups.filter((group) => group.nodeIds.length || !(definition.groups ?? []).find((item) => item.id === group.id)!.nodeIds.length);
  const frameOf = new Map(kept.flatMap((group) => group.nodeIds.map((id) => [id, group.id] as const)));
  const lines = definition.edges.filter((edge) => drawnIds.has(edge.source) && drawnIds.has(edge.target));
  // What each line carries: its exit's mark (with the line's label in it), or else its label alone (a condition's 예/아니요,
  // an exit sent down several lines).
  const labelRoom = (edge: WorkflowDefinition['edges'][number]) => {
    const mark = tagRoom?.edge(edge);
    if (mark) return mark;
    const source = definition.nodes.find((node) => node.id === edge.source);
    const portLabel = source && nodePorts(source).find((port) => port.id === edge.sourceHandle)?.label;
    const branches = definition.edges.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length;
    const text = portLabel && (branches > 1 ? `${portLabel} · 모두 보냄` : portLabel);
    return text ? { width: Math.max(36, [...text].length * 12 + 8), height: 20 } : undefined;
  };
  // Where the marks of exits no line leaves go, by node: right after the exit, on a short line.
  const endRooms = new Map(drawn.map((node) => {
    const ports = nodePorts(node);
    const size = sizes.get(node.id) ?? { width: 224, height: 66 };
    return [node.id, ports.flatMap((port, index) => {
      const room = !lines.some((edge) => edge.source === node.id && edge.sourceHandle === port.id) && tagRoom?.exit(node.id, port.id);
      return room ? [{ at: vertical ? { x: ((index + 0.5) / ports.length) * size.width, y: size.height } : { x: size.width, y: ((index + 0.5) / ports.length) * size.height }, room }] : [];
    })] as const;
  }));
  const elkNode = (node: WorkflowDefinition['nodes'][number]) => {
    const ports = nodePorts(node);
    const size = sizes.get(node.id) ?? { width: 224, height: 66 };
    const ends = endRooms.get(node.id) ?? [];
    // The node's margin after its exits keeps the room for those marks (ELK places nothing there).
    const reach = Math.max(0, ...ends.map((end) => END_STEM + (vertical ? end.room.height : end.room.width)));
    const overhang = Math.max(0, ...ends.map((end) => (vertical ? Math.max(0, end.at.x + end.room.width / 2 - size.width, end.room.width / 2 - end.at.x) : Math.max(0, end.at.y + end.room.height / 2 - size.height, end.room.height / 2 - end.at.y))));
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_POS',
        ...(reach && { 'elk.margins': vertical ? `[top=0,left=${overhang},bottom=${reach},right=${overhang}]` : `[top=${overhang},left=0,bottom=${overhang},right=${reach}]` }),
      },
      ports: [
        { id: `${node.id}:in`, x: vertical ? size.width / 2 : 0, y: vertical ? 0 : size.height / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': vertical ? 'NORTH' : 'WEST' } },
        ...ports.map((port, index) => ({
          id: `${node.id}:${port.id}`,
          x: vertical ? ((index + 0.5) / ports.length) * size.width : size.width,
          y: vertical ? size.height : ((index + 0.5) / ports.length) * size.height,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': vertical ? 'SOUTH' : 'EAST' },
        })),
      ],
    };
  };
  // A frame's bottom (or right) padding grows to hold the end marks of its last nodes (ELK leaves margins out of a
  // frame's size): measured on a first run, kept on the second.
  const extra = new Map<string, number>();
  const frameChildren = (group: (typeof kept)[number]) => drawn.filter((node) => frameOf.get(node.id) === group.id).map(elkNode);
  // Spacing is read per frame (ELK does not pass it down), so every frame gets the same as the workflow.
  const spacing = {
    'elk.spacing.nodeNode': '64',
    'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    'elk.spacing.edgeEdge': '24',
    'elk.spacing.edgeNode': '24',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '24',
    'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  };
  const build = () => ({
    id: 'workflow',
    layoutOptions: {
      ...spacing,
      'elk.algorithm': 'layered',
      'elk.direction': vertical ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT',
      'elk.edgeLabels.inline': 'true',
      'elk.edgeLabels.placement': 'CENTER',
      // Keep the drawn order (entry first, main path before retry loops) and route loops back around.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.layered.feedbackEdges': 'true',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.mergeEdges': 'false',
    },
    children: [
      ...kept.map((group) => ({
        id: `group:${group.id}`,
        ...(group.nodeIds.length ? {} : { width: group.box?.width ?? 320, height: group.box?.height ?? 200 }),
        layoutOptions: { ...spacing, 'elk.padding': vertical
          ? `[top=${FRAME_PAD + FRAME_HEADER},left=${FRAME_PAD},bottom=${FRAME_PAD + (extra.get(group.id) ?? 0)},right=${FRAME_PAD}]`
          : `[top=${FRAME_PAD + FRAME_HEADER},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD + (extra.get(group.id) ?? 0)}]` },
        children: frameChildren(group),
      })),
      ...drawn.filter((node) => !frameOf.has(node.id)).map(elkNode),
    ],
    edges: lines.map((edge) => {
      const room = labelRoom(edge);
      return { id: edge.id, sources: [`${edge.source}:${edge.sourceHandle}`], targets: [`${edge.target}:in`], ...(room && { labels: [{ id: `${edge.id}:label`, text: '', width: room.width, height: room.height }] }) };
    }),
  });
  const flatten = (root: ElkNode) => {
    const out: ElkNode[] = [];
    const walk = (node: ElkNode) => { for (const child of node.children ?? []) { out.push(child); walk(child); } };
    walk(root);
    return out;
  };
  let result = await elk.layout(build() as unknown as ElkNode);
  for (const frame of flatten(result).filter((child) => child.id.startsWith('group:'))) {
    const edge = vertical ? (frame.y ?? 0) + (frame.height ?? 0) - FRAME_PAD : (frame.x ?? 0) + (frame.width ?? 0) - FRAME_PAD;
    const reach = Math.max(0, ...(frame.children ?? []).flatMap((child) => (endRooms.get(child.id) ?? []).map((end) => (vertical
      ? (child.y ?? 0) + end.at.y + END_STEM + end.room.height
      : (child.x ?? 0) + end.at.x + END_STEM + end.room.width) - edge)));
    if (reach > 0) extra.set(frame.id.slice('group:'.length), reach);
  }
  if (extra.size) result = await elk.layout(build() as unknown as ElkNode);
  const all = flatten(result);
  const byId = new Map(all.map((child) => [child.id, child]));
  const boxOf = (child: ElkNode): Box => ({ left: child.x ?? 0, top: child.y ?? 0, right: (child.x ?? 0) + (child.width ?? 0), bottom: (child.y ?? 0) + (child.height ?? 0) });
  const frames = all.filter((child) => child.id.startsWith('group:'));
  const frameBoxes = frames.map(boxOf);
  // Marks are placed here, not by ELK (it leaves the labels of lines between frames unplaced): clear of every node,
  // of the rooms kept for end marks, and of each other.
  const blocked: Box[] = all.filter((child) => drawnIds.has(child.id)).map(boxOf);
  for (const child of all) for (const end of endRooms.get(child.id) ?? []) {
    const at = { x: (child.x ?? 0) + end.at.x, y: (child.y ?? 0) + end.at.y };
    const along = END_STEM + (vertical ? end.room.height : end.room.width);
    blocked.push(vertical
      ? { left: at.x - end.room.width / 2, top: at.y, right: at.x + end.room.width / 2, bottom: at.y + along }
      : { left: at.x, top: at.y - end.room.height / 2, right: at.x + along, bottom: at.y + end.room.height / 2 });
  }
  const taken: Box[] = [];
  const byEdge = new Map(lines.map((edge) => [edge.id, edge]));
  // Each line once (ELK may list one under the frame it ended up in as well as where it was given).
  const edgesOut = [...new Map([...(result.edges ?? []), ...all.flatMap((child) => child.edges ?? [])].reverse().map((edge) => [edge.id, edge])).values()];
  const pointsOf = new Map(edgesOut.filter((edge) => byEdge.has(edge.id)).map((edge) => [edge.id, (edge.sections ?? []).flatMap((section, index) => [...(index === 0 && section.startPoint ? [section.startPoint] : []), ...(section.bendPoints ?? []), ...(section.endPoint ? [section.endPoint] : [])]).map(({ x, y }) => ({ x, y }))] as const));
  // Whether a run of one line lies along a run of another line (of another exit) for more than a few pixels.
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const sharedBy = (id: string) => (from: Point, to: Point) => {
    const exit = `${byEdge.get(id)!.source}:${byEdge.get(id)!.sourceHandle}`;
    const flat = near(from.y, to.y);
    const [low, high] = flat ? [Math.min(from.x, to.x), Math.max(from.x, to.x)] : [Math.min(from.y, to.y), Math.max(from.y, to.y)];
    return [...pointsOf].some(([other, points]) => other !== id && `${byEdge.get(other)!.source}:${byEdge.get(other)!.sourceHandle}` !== exit && points.slice(1).some((point, index) => {
      const start = points[index]!;
      if (flat ? !(near(start.y, point.y) && near(start.y, from.y)) : !(near(start.x, point.x) && near(start.x, from.x))) return false;
      const [a, b] = flat ? [Math.min(start.x, point.x), Math.max(start.x, point.x)] : [Math.min(start.y, point.y), Math.max(start.y, point.y)];
      return Math.min(b, high) - Math.max(a, low) > 8;
    }));
  };
  const routes = new Map<string, WorkflowDefinition['edges'][number]['layout']>([...pointsOf].map(([id, points]) => {
    const line = byEdge.get(id)!;
    const crosses = frameOf.get(line.source) !== frameOf.get(line.target);
    return [id, { points, labelPosition: lineSpot(points, labelRoom(line), crosses ? frameBoxes : [], blocked, taken, sharedBy(id)) }] as const;
  }));
  const positions = new Map<string, Point>(drawn.flatMap((node) => {
    const child = byId.get(node.id);
    return child ? [[node.id, { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }] as const] : [];
  }));
  // The entry and the end nodes are not drawn (the canvas shows a 시작 / 끝 mark instead) and take no room: each sits
  // just before the node it leads to, or just after the exit it ends, on a straight line.
  for (const mark of definition.nodes.filter((node) => node.type === 'entry' || node.type === 'end')) {
    const line = definition.edges.find((edge) => (mark.type === 'entry' ? edge.source === mark.id : edge.target === mark.id));
    const other = line && definition.nodes.find((node) => node.id === (mark.type === 'entry' ? line.target : line.source));
    const at = other && positions.get(other.id);
    if (!line || !other || !at) continue;
    const own = sizes.get(mark.id) ?? { width: 224, height: 66 };
    const near = sizes.get(other.id) ?? { width: 224, height: 66 };
    const ports = nodePorts(other);
    const exit = Math.max(0, ports.findIndex((port) => port.id === line.sourceHandle));
    // Where the line meets the other node: its input (the middle of its near side), or its exit.
    const meet = mark.type === 'entry'
      ? (vertical ? { x: at.x + near.width / 2, y: at.y } : { x: at.x, y: at.y + near.height / 2 })
      : (vertical ? { x: at.x + ((exit + 0.5) / ports.length) * near.width, y: at.y + near.height } : { x: at.x + near.width, y: at.y + ((exit + 0.5) / ports.length) * near.height });
    const position = mark.type === 'entry'
      ? (vertical ? { x: meet.x - own.width / 2, y: meet.y - MARK_GAP - own.height } : { x: meet.x - MARK_GAP - own.width, y: meet.y - own.height / 2 })
      : (vertical ? { x: meet.x - own.width / 2, y: meet.y + MARK_GAP } : { x: meet.x + MARK_GAP, y: meet.y - own.height / 2 });
    positions.set(mark.id, position);
    const markPort = vertical ? { x: position.x + own.width / 2, y: mark.type === 'entry' ? position.y + own.height : position.y } : { x: mark.type === 'entry' ? position.x + own.width : position.x, y: position.y + own.height / 2 };
    routes.set(line.id, { points: mark.type === 'entry' ? [markPort, meet] : [meet, markPort], labelPosition: { x: (markPort.x + meet.x) / 2, y: (markPort.y + meet.y) / 2 } });
  }
  return {
    ...definition,
    direction,
    nodes: definition.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    edges: definition.edges.map((edge) => ({ ...edge, layout: routes.get(edge.id) })),
    // Each frame stands where ELK placed it.
    groups: definition.groups?.map((group) => {
      const child = byId.get(`group:${group.id}`);
      return child ? { ...group, box: { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0), width: Math.round(child.width ?? 0), height: Math.round(child.height ?? 0) } } : group;
    }),
  };
}
