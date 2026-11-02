import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { nodePorts, type WorkflowDefinition } from '@tw/shared';
import { FRAME_HEADER, FRAME_PAD, type CanvasDirection } from '@loca/ui';

const elk = new ELK();

/** ELK layered in the selected direction, keeping exits in listed order around each node. */
async function layoutFlat(definition: WorkflowDefinition, sizes: Map<string, { width: number; height: number }>, direction: CanvasDirection = 'vertical'): Promise<WorkflowDefinition> {
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
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
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

/** The room between two frames, and between a frame and a node outside every frame. */
const FRAME_GAP = 48;

/**
 * The layout of a workflow with frames (definition.groups): each frame's nodes laid out on their own in `direction`
 * (layoutFlat, its own lines routed), then the frames placed as blocks across it (frames left to right when nodes read
 * top to bottom, and the reverse), in the order the workflow lists them; a node in no frame is a block of its own.
 * Lines between frames run in the gaps between them. Without frames it is layoutFlat.
 */
export async function autoLayout(definition: WorkflowDefinition, sizes: Map<string, { width: number; height: number }>, direction: CanvasDirection = 'vertical'): Promise<WorkflowDefinition> {
  const drawn = new Set(definition.nodes.filter((node) => node.type !== 'entry' && node.type !== 'end').map((node) => node.id));
  // An empty frame (drawn to put nodes in) is a block of its own size; a frame whose nodes are all folded away is left out.
  const groups = (definition.groups ?? []).map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => drawn.has(id)) })).filter((group) => group.nodeIds.length || !(definition.groups ?? []).find((item) => item.id === group.id)!.nodeIds.length);
  if (!groups.length) return layoutFlat(definition, sizes, direction);
  const framed = new Set(groups.flatMap((group) => group.nodeIds));
  // The frames in the workflow's order; a node in no frame goes right after the block of the node listed before it (so
  // it keeps its place in the reading order instead of trailing every frame).
  const blocks: { id: string; nodeIds: string[]; frame: boolean }[] = groups.map((group) => ({ id: `group:${group.id}`, nodeIds: group.nodeIds, frame: true }));
  const listed = definition.nodes.map((node) => node.id).filter((id) => drawn.has(id));
  for (const [index, id] of listed.entries()) {
    if (framed.has(id)) continue;
    const before = listed.slice(0, index).reverse().find((other) => blocks.some((block) => block.nodeIds.includes(other)));
    const at = before ? blocks.findIndex((block) => block.nodeIds.includes(before)) + 1 : 0;
    blocks.splice(at, 0, { id: `node:${id}`, nodeIds: [id], frame: false });
  }
  const blockOf = new Map(blocks.flatMap((block) => block.nodeIds.map((id) => [id, block.id] as const)));
  // Each block on its own: its nodes and the lines among them.
  const EMPTY = { width: 320, height: 200 };
  const inner = await Promise.all(blocks.map(async (block) => {
    if (!block.nodeIds.length) {
      const box = groups.find((group) => `group:${group.id}` === block.id)?.box ?? EMPTY;
      return { block, part: { ...definition, nodes: [], edges: [] }, origin: { x: 0, y: 0 }, pad: { left: 0, top: 0, right: 0, bottom: 0 }, width: box.width, height: box.height };
    }
    const ids = new Set(block.nodeIds);
    const part = await layoutFlat({ ...definition, groups: undefined, nodes: definition.nodes.filter((node) => ids.has(node.id)), edges: definition.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) }, sizes, direction);
    const boxes = part.nodes.map((node) => ({ node, size: sizes.get(node.id) ?? { width: 224, height: 66 } }));
    const left = Math.min(...boxes.map((box) => box.node.position.x));
    const top = Math.min(...boxes.map((box) => box.node.position.y));
    const width = Math.max(...boxes.map((box) => box.node.position.x + box.size.width)) - left;
    const height = Math.max(...boxes.map((box) => box.node.position.y + box.size.height)) - top;
    const pad = block.frame ? { left: FRAME_PAD, top: FRAME_PAD + FRAME_HEADER, right: FRAME_PAD, bottom: FRAME_PAD } : { left: 0, top: 0, right: 0, bottom: 0 };
    return { block, part, origin: { x: left, y: top }, pad, width: width + pad.left + pad.right, height: height + pad.top + pad.bottom };
  }));
  // The blocks across: the lines between them, once per pair, in the workflow's order.
  // An empty frame has no lines: it follows the block listed before it.
  const links = [...new Set([
    ...definition.edges.flatMap((edge) => {
      const from = blockOf.get(edge.source);
      const to = blockOf.get(edge.target);
      return from && to && from !== to ? [`${from}>${to}`] : [];
    }),
    ...blocks.flatMap((block, index) => (!block.nodeIds.length && index > 0 ? [`${blocks[index - 1]!.id}>${block.id}`] : [])),
  ])];
  const top = await elk.layout({
    id: 'frames',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'vertical' ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': String(FRAME_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(FRAME_GAP),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children: inner.map((entry) => ({ id: entry.block.id, width: entry.width, height: entry.height })),
    edges: links.map((link, index) => {
      const [from, to] = link.split('>');
      return { id: `link-${index}`, sources: [from!], targets: [to!] };
    }),
  } as ElkNode);
  // ELK picks each block's column (its layer); within a column the blocks stack from the top in the workflow's order,
  // so a frame never sinks below where a back line pulled it.
  const across = direction === 'vertical' ? 'x' : 'y';
  const along = direction === 'vertical' ? 'y' : 'x';
  const order = new Map(inner.map((entry, index) => [entry.block.id, index]));
  const size = new Map(inner.map((entry) => [entry.block.id, entry]));
  // A column is the blocks whose spans across overlap (ELK centres a narrower block in its layer, so their edges differ);
  // it starts where its leftmost block does.
  const spanOf = (child: ElkNode) => (direction === 'vertical' ? child.width : child.height) ?? 0;
  const columns = new Map<number, ElkNode[]>();
  let column: { at: number; end: number; children: ElkNode[] } | undefined;
  for (const child of [...(top.children ?? [])].sort((a, b) => (a[across] ?? 0) - (b[across] ?? 0))) {
    const start = child[across] ?? 0;
    if (column && start < column.end) {
      column.children.push(child);
      column.end = Math.max(column.end, start + spanOf(child));
    } else {
      column = { at: Math.round(start), end: start + spanOf(child), children: [child] };
      columns.set(column.at, column.children);
    }
  }
  const placed = new Map<string, { x: number; y: number }>();
  for (const [at, children] of columns) {
    let offset = 0;
    for (const child of children.sort((a, b) => order.get(a.id)! - order.get(b.id)!)) {
      const entry = size.get(child.id)!;
      placed.set(child.id, { [across]: at, [along]: offset } as { x: number; y: number });
      offset += (direction === 'vertical' ? entry.height : entry.width) + FRAME_GAP;
    }
  }
  const positions = new Map<string, { x: number; y: number }>();
  const routes = new Map<string, WorkflowDefinition['edges'][number]['layout']>();
  for (const entry of inner) {
    const at = placed.get(entry.block.id) ?? { x: 0, y: 0 };
    const dx = Math.round(at.x + entry.pad.left - entry.origin.x);
    const dy = Math.round(at.y + entry.pad.top - entry.origin.y);
    for (const node of entry.part.nodes) positions.set(node.id, { x: node.position.x + dx, y: node.position.y + dy });
    for (const edge of entry.part.edges) if (edge.layout) routes.set(edge.id, {
      points: edge.layout.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      ...(edge.layout.labelPosition && { labelPosition: { x: edge.layout.labelPosition.x + dx, y: edge.layout.labelPosition.y + dy } }),
    });
  }
  // Lines between blocks run in the gaps: out of the port a step, along the gap after the source's block to the target's
  // row, then into the target's input. Lines to the same place share the gap, so they read as one. A line back to an
  // earlier block goes round above every block.
  const rects = new Map(inner.map((entry) => {
    const at = placed.get(entry.block.id) ?? { x: 0, y: 0 };
    return [entry.block.id, { left: at.x, top: at.y, right: at.x + entry.width, bottom: at.y + entry.height }] as const;
  }));
  const ceiling = Math.min(...[...rects.values()].map((rect) => (direction === 'vertical' ? rect.top : rect.left))) - FRAME_GAP / 2;
  // A line that would cross a block on its way (its target is two or more columns over) runs under the blocks it passes.
  const STEP = 12;
  // Out of a port the line first runs this far straight, so what it carries (a tag, a status) sits right under its port.
  const OUT = 44;
  for (const edge of definition.edges) {
    const from = blockOf.get(edge.source);
    const to = blockOf.get(edge.target);
    const source = definition.nodes.find((node) => node.id === edge.source);
    const target = positions.get(edge.target);
    const at = positions.get(edge.source);
    if (!from || !to || from === to || !source || !target || !at) continue;
    const ports = nodePorts(source);
    const index = Math.max(0, ports.findIndex((port) => port.id === edge.sourceHandle));
    const size = sizes.get(edge.source) ?? { width: 224, height: 66 };
    const targetSize = sizes.get(edge.target) ?? { width: 224, height: 66 };
    const fromRect = rects.get(from)!;
    if (direction === 'vertical') {
      const start = { x: at.x + ((index + 0.5) / ports.length) * size.width, y: at.y + size.height };
      const end = { x: target.x + targetSize.width / 2, y: target.y };
      const toRect = rects.get(to)!;
      const back = end.x < start.x && toRect.right <= fromRect.left;
      const crossed = back ? [] : [...rects.values()].filter((rect) => rect.left >= fromRect.right && rect.right <= toRect.left);
      const out = Math.min(start.y + OUT, fromRect.bottom + FRAME_GAP / 2);
      const gap = fromRect.right + FRAME_GAP / 2;
      const turn = back ? ceiling : end.y - STEP;
      const floor = Math.max(fromRect.bottom, ...crossed.map((rect) => rect.bottom)) + FRAME_GAP / 2;
      const points = crossed.length
        ? [start, { x: start.x, y: out }, { x: gap, y: out }, { x: gap, y: floor }, { x: toRect.left - FRAME_GAP / 2, y: floor }, { x: toRect.left - FRAME_GAP / 2, y: end.y - STEP }, { x: end.x, y: end.y - STEP }, end]
        : [start, { x: start.x, y: out }, { x: gap, y: out }, { x: gap, y: turn }, { x: end.x, y: turn }, end];
      routes.set(edge.id, { points, labelPosition: { x: start.x, y: start.y + OUT / 2 } });
    } else {
      const start = { x: at.x + size.width, y: at.y + ((index + 0.5) / ports.length) * size.height };
      const end = { x: target.x, y: target.y + targetSize.height / 2 };
      const toRect = rects.get(to)!;
      const back = end.y < start.y && toRect.bottom <= fromRect.top;
      const crossed = back ? [] : [...rects.values()].filter((rect) => rect.top >= fromRect.bottom && rect.bottom <= toRect.top);
      const out = Math.min(start.x + OUT, fromRect.right + FRAME_GAP / 2);
      const gap = fromRect.bottom + FRAME_GAP / 2;
      const turn = back ? ceiling : end.x - STEP;
      const floor = Math.max(fromRect.right, ...crossed.map((rect) => rect.right)) + FRAME_GAP / 2;
      const points = crossed.length
        ? [start, { x: out, y: start.y }, { x: out, y: gap }, { x: floor, y: gap }, { x: floor, y: toRect.top - FRAME_GAP / 2 }, { x: end.x - STEP, y: toRect.top - FRAME_GAP / 2 }, { x: end.x - STEP, y: end.y }, end]
        : [start, { x: out, y: start.y }, { x: out, y: gap }, { x: turn, y: gap }, { x: turn, y: end.y }, end];
      routes.set(edge.id, { points, labelPosition: { x: start.x + OUT / 2, y: start.y } });
    }
  }
  // The entry and the end marks are not drawn (the canvas shows a 시작 / 끝 mark instead) and take no room: each sits
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
    const vertical = direction === 'vertical';
    // Where the line meets the other node: its input (the middle of its near side), or its exit.
    const meet = mark.type === 'entry'
      ? (vertical ? { x: at.x + near.width / 2, y: at.y } : { x: at.x, y: at.y + near.height / 2 })
      : (vertical ? { x: at.x + ((exit + 0.5) / ports.length) * near.width, y: at.y + near.height } : { x: at.x + near.width, y: at.y + ((exit + 0.5) / ports.length) * near.height });
    const position = mark.type === 'entry'
      ? (vertical ? { x: meet.x - own.width / 2, y: meet.y - FRAME_GAP - own.height } : { x: meet.x - FRAME_GAP - own.width, y: meet.y - own.height / 2 })
      : (vertical ? { x: meet.x - own.width / 2, y: meet.y + FRAME_GAP } : { x: meet.x + FRAME_GAP, y: meet.y - own.height / 2 });
    positions.set(mark.id, position);
    const markPort = vertical ? { x: position.x + own.width / 2, y: mark.type === 'entry' ? position.y + own.height : position.y } : { x: mark.type === 'entry' ? position.x + own.width : position.x, y: position.y + own.height / 2 };
    routes.set(line.id, { points: mark.type === 'entry' ? [markPort, meet] : [meet, markPort], labelPosition: { x: (markPort.x + meet.x) / 2, y: (markPort.y + meet.y) / 2 } });
  }
  return {
    ...definition,
    direction,
    nodes: definition.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    edges: definition.edges.map((edge) => ({ ...edge, layout: routes.get(edge.id) })),
    // Each frame stands where its block was placed.
    groups: definition.groups?.map((group) => {
      const rect = rects.get(`group:${group.id}`);
      return rect ? { ...group, box: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.right - rect.left), height: Math.round(rect.bottom - rect.top) } } : group;
    }),
  };
}
