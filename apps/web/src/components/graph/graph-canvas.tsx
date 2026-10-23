import { CanvasToolbar } from '@loca/ui';
import { paletteIndex } from '@tw/shared';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import Flatbush from 'flatbush';

/** Margin inside the minimap, in its pixels. */
const MINIMAP_PAD = 10;
/** Space between a node and the card beside it, and between the card and the canvas edge. */
const ANCHOR_GAP = 12;
import { drawShape } from './shapes';
import { getCanvasColors } from './canvas-colors';
import { useTheme } from '@/lib/theme';
import { wrapTextLines } from './canvas-text-wrap';

/** Below this zoom node labels are unreadable, so they are not drawn. */
const DETAIL_K = 0.22;

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  points: number[];
  /** What the edge says: a player's choice (with `via`, the choice node it stands for) or a condition. */
  label?: string;
  via?: string;
  /** Where the layout put the label: x, y, width, height. */
  labelAt?: [number, number, number, number];
  /** Points are a start and (control, control, end) triples: drawn as Bézier curves. */
  curved?: true;
  /** Stands for a path through nodes left out of the view; drawn dashed. */
  derived?: true;
  /** A derived edge's facts from the source graph: the nodes it leaves out and what they hold. */
  omitted?: { nodeIds: string[]; lines: number; controls: number; speakers: string[]; moreSpeakers: number };
}

/**
 * An edge label's box: where the layout put it (the edge runs through it and nothing else is
 * there), else centred halfway along the line.
 */
function labelBox(edge: LayoutEdge): [number, number, number, number] | null {
  if (!edge.label) return null;
  // A derived edge's label sits on its own line: it describes that line, wherever the layout put its room.
  if (edge.labelAt && !edge.derived) return edge.labelAt;
  const width = Math.min(240, 30 + Math.ceil(edge.label.length * 8));
  const [x, y] = midpoint(edge);
  return [x - width / 2, y - 11, width, 22];
}

/** The point halfway along an edge: sampled along its Bézier pieces when curved, else its segments. */
function midpoint(edge: LayoutEdge): [number, number] {
  const p = edge.points;
  const samples: [number, number][] = [];
  if (edge.curved) {
    samples.push([p[0], p[1]]);
    for (let i = 2; i + 5 < p.length; i += 6) {
      const [x0, y0] = samples[samples.length - 1];
      for (let s = 1; s <= 12; s++) {
        const u = s / 12, v = 1 - u;
        samples.push([
          v * v * v * x0 + 3 * v * v * u * p[i] + 3 * v * u * u * p[i + 2] + u * u * u * p[i + 4],
          v * v * v * y0 + 3 * v * v * u * p[i + 1] + 3 * v * u * u * p[i + 3] + u * u * u * p[i + 5],
        ]);
      }
    }
  } else for (let i = 0; i + 1 < p.length; i += 2) samples.push([p[i], p[i + 1]]);
  if (samples.length < 2) return samples[0] ?? [0, 0];
  const lengths = samples.slice(1).map(([x, y], i) => Math.hypot(x - samples[i][0], y - samples[i][1]));
  let half = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i] && lengths[i] > 0) {
      const f = half / lengths[i];
      return [samples[i][0] + (samples[i + 1][0] - samples[i][0]) * f, samples[i][1] + (samples[i + 1][1] - samples[i][1]) * f];
    }
    half -= lengths[i];
  }
  return samples[samples.length - 1];
}
export interface NodeInfo {
  id: string;
  type?: string | null;
  kind: string;
  label: string | null;
  preview: string | null;
  key: string;
  /** A card's first line (who speaks, or what a folded run holds) and the text under it. */
  title?: string;
  /** The color a person gave the speaker in `title` (a palette hex): the title is drawn in it. */
  titleColor?: string;
  body?: string | null;
}
export interface Viewport {
  x: number;
  y: number;
  k: number;
}
export interface GraphCanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  zoomTo(k: number): void;
  focus(id: string): void;
  /** Pans (zooming in to a readable size if needed) so the node and `room` px beside it are on screen. */
  reveal(id: string, room: number): void;
}

const MIN_K = 0.01;
const MAX_K = 2.5;
const PAD = 48;
const DEFAULT_START_K = 1;

export interface LooseEdge {
  id: string;
  from: string;
  to: string;
}
/** Scene-graph hub ("연결점"): dialogue nodes outside every scene that join many scenes. */
export interface HubInfo {
  nodes: number;
  scenes: number;
}

export interface Region {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  nodes: LayoutNode[];
  regions?: Region[];
  edges: LayoutEdge[];
  /** Real edges left out of the layout (they touch a hub); drawn as faint straight lines. */
  looseEdges?: LooseEdge[];
  direction?: 'vertical' | 'horizontal';
  /** 가로·세로 in the canvas toolbar (as in the other graphs); without it the toolbar has no direction. */
  onDirectionChange?: (direction: 'vertical' | 'horizontal') => void;
  /**
   * Editing (the dialogue graph): each line card shows two dots, the way in (top / left) and the
   * way out (bottom / right); dragging from one to another node calls onConnect(from, to). A click
   * on a line picks it (onSelectEdge); a right-click on it opens onEdgeContextMenu.
   */
  editable?: boolean;
  onConnect?: (fromId: string, toId: string) => void;
  /** The scene graph: scene nodes (not hubs) can be connected too. */
  connectScenes?: boolean;
  selectedEdgeId?: string;
  onSelectEdge?: (edgeId: string) => void;
  onEdgeContextMenu?: (edgeId: string, event: { clientX: number; clientY: number }) => void;
  /** Small actions over one node (복제 · 삭제, as the other graphs' toolbox), centred above it; hidden while the node is off screen. */
  toolbar?: { id: string; content: ReactNode };
  /** Hub nodes by id; drawn as quiet pills instead of the usual node shapes. */
  hubs?: Map<string, HubInfo>;
  info: Map<string, NodeInfo>;
  width: number;
  height: number;
  selectedId?: string;
  /** More selected nodes (box or modifier-click selection), drawn like the selected one. */
  selectedIds?: Set<string>;
  /**
   * Turns on box selection: Shift+drag draws the box (left-drag still pans). Called with the nodes
   * in the box, or the one node of a Shift/Ctrl/⌘-click; `additive` asks to add/toggle them
   * (a box drawn with ⌘/Ctrl held as well adds to the selection).
   */
  onSelectMany?: (ids: string[], additive: boolean) => void;
  /** Nodes to emphasise (e.g. the scene being inspected); others are dimmed when non-empty. */
  highlight?: Set<string>;
  /** Path endpoints to mark on this graph; folded nodes should be keyed by their visible chain id. */
  endpointMarkers?: Map<string, Array<'start' | 'end'>>;
  /** Edges to emphasise on top of `highlight` (`${from}|${to}` of the edges in `edges`); the other edges stay dimmed. */
  highlightEdges?: Set<string>;
  initialViewport?: Viewport;
  /** Open centred on this node instead (zoomed to a readable size), e.g. arriving from a line. */
  initialFocus?: string;
  /** Reading flows begin at the top; an explicitly selected node is centred. */
  initialFocusAlign?: 'center' | 'top' | 'left';
  onViewportChange?: (viewport: Viewport) => void;
  onSelect: (id: string | undefined) => void;
  onContextMenu?: (nodeId: string | undefined, event: { clientX: number; clientY: number }) => void;
  /** Enter on the canvas with a node selected. */
  onOpen?: () => void;
  /** A card that floats beside a node (right of it, or left when there is no room) and follows it as the view moves. */
  anchor?: { id: string; content: ReactNode };
  handle?: Ref<GraphCanvasHandle>;
}

/**
 * Draws a precomputed ELK layout. d3-zoom owns pan/zoom, Flatbush owns spatial queries,
 * so each frame only touches what is on screen. One <canvas>, no per-node DOM.
 */
export function GraphCanvas({ nodes, regions = [], edges: laidOut, looseEdges, direction = 'vertical', onDirectionChange, editable, onConnect, connectScenes, selectedEdgeId, onSelectEdge, onEdgeContextMenu, toolbar, hubs, info, width, height, selectedId, selectedIds, onSelectMany, highlight, endpointMarkers, highlightEdges, initialViewport, initialFocus, initialFocusAlign = 'center', onViewportChange, onSelect, onContextMenu, onOpen, anchor, handle }: Props) {
  const theme = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const transform = useRef<ZoomTransform>(zoomIdentity);
  const behavior = useRef<ZoomBehavior<HTMLCanvasElement, unknown>>(null);
  const frame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const previousSize = useRef<{ width: number; height: number } | null>(null);
  const anchorBox = useRef<HTMLDivElement>(null);
  const toolbarBox = useRef<HTMLDivElement>(null);
  const [minimapOpen, setMinimapOpen] = useState(() => {
    try {
      return localStorage.getItem('tw.graph.minimap') !== '0';
    } catch {
      return true;
    }
  });
  const toggleMinimap = (open: boolean) => {
    setMinimapOpen(open);
    try {
      localStorage.setItem('tw.graph.minimap', open ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  // The toolbar's zoom reading, updated when a zoom or pan settles.
  const [zoomK, setZoomK] = useState(1);
  useEffect(() => {
    if (minimapOpen) schedule();
  }, [minimapOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the obstacle-avoiding ELK route; its label already has reserved space.
  const edges = laidOut;
  // Which of the drawn edges are emphasised, by position.
  const emphasised = useMemo(() => new Set(highlightEdges?.size ? edges.flatMap((edge, i) => (highlightEdges.has(`${edge.from}|${edge.to}`) ? [i] : [])) : []), [edges, highlightEdges]);
  const props = useRef({ selectedId, selectedIds, onSelectMany, highlight, endpointMarkers, emphasised, onViewportChange, onSelect, onOpen, hubs, anchorId: anchor?.id, toolbarId: toolbar?.id, onContextMenu, editable, onConnect, connectScenes, selectedEdgeId, onSelectEdge, onEdgeContextMenu });
  props.current = { selectedId, selectedIds, onSelectMany, highlight, endpointMarkers, emphasised, onViewportChange, onSelect, onOpen, hubs, anchorId: anchor?.id, toolbarId: toolbar?.id, onContextMenu, editable, onConnect, connectScenes, selectedEdgeId, onSelectEdge, onEdgeContextMenu };
  /** A line being drawn from a node's dot: where it starts and where the pointer is (graph coordinates). */
  const connecting = useRef<{ from: string; out: boolean; px: number; py: number; x: number; y: number } | null>(null);
  const boxSelect = Boolean(onSelectMany);
  /** The selection box being dragged, in canvas pixels; `moved` once it passed the click distance. */
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number; moved: boolean; additive: boolean } | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /** Nodes inside the box being dragged, ringed as it moves (as React Flow does in the other graphs). */
  const boxed = useRef<{ ids: Set<string>; additive: boolean } | null>(null);
  /** Swallows the click that ends a box drag. */
  const suppressClick = useRef(false);

  const index = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    // Flatbush needs exactly as many items as it was sized for, so an empty list gets no index
    // (a scene graph whose scenes share no dialogue edges has nodes but zero edges).
    const nodeIndex = nodes.length ? new Flatbush(nodes.length) : null;
    for (const node of nodes) nodeIndex!.add(node.x, node.y, node.x + node.width, node.y + node.height);
    nodeIndex?.finish();
    const edgeIndex = edges.length ? new Flatbush(edges.length) : null;
    for (const edge of edges) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < edge.points.length; i += 2) {
        minX = Math.min(minX, edge.points[i]);
        maxX = Math.max(maxX, edge.points[i]);
        minY = Math.min(minY, edge.points[i + 1]);
        maxY = Math.max(maxY, edge.points[i + 1]);
      }
      if (!edge.points.length) minX = minY = maxX = maxY = 0;
      edgeIndex!.add(minX, minY, maxX, maxY);
    }
    edgeIndex?.finish();
    const edgeAt = new Map(edges.map((edge, i) => [edge.id, i]));
    // Clickable labels (a choice, a derived edge's left-out stretch) by their own boxes: a label can lie away from its line.
    const labelled = edges.flatMap((edge, i) => (edge.via || edge.derived ? [[i, labelBox(edge)] as const] : [])).filter((entry): entry is readonly [number, [number, number, number, number]] => entry[1] !== null);
    const labelIndex = labelled.length ? new Flatbush(labelled.length) : null;
    for (const [, [bx, by, bw, bh]] of labelled) labelIndex!.add(bx, by, bx + bw, by + bh);
    labelIndex?.finish();
    const labelEdge = labelled.map(([i]) => i);
    const bounds = nodes.reduce(
      (box, node) => ({ minX: Math.min(box.minX, node.x), minY: Math.min(box.minY, node.y), maxX: Math.max(box.maxX, node.x + node.width), maxY: Math.max(box.maxY, node.y + node.height) }),
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    );
    const adjacent = new Map<string, Set<string>>();
    edges.forEach((edge, i) => {
      for (const end of [edge.from, edge.to]) {
        const set = adjacent.get(end) ?? new Set<string>();
        set.add(String(i));
        adjacent.set(end, set);
      }
      // A choice folded into its edge: selecting the choice lights that edge.
      if (edge.via) adjacent.set(edge.via, new Set([String(i)]));
    });
    // Loose edges as one flat array of segments (bottom centre -> top centre); edges whose ends are not placed are skipped.
    const segments: number[] = [];
    const looseByNode = new Map<string, number[]>();
    for (const edge of looseEdges ?? []) {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      if (!a || !b) continue;
      const at = segments.length / 4;
      segments.push(...(direction === 'horizontal'
        ? [a.x + a.width, a.y + a.height / 2, b.x, b.y + b.height / 2]
        : [a.x + a.width / 2, a.y + a.height, b.x + b.width / 2, b.y]));
      for (const end of [edge.from, edge.to]) {
        const list = looseByNode.get(end);
        if (list) list.push(at);
        else looseByNode.set(end, [at]);
      }
    }
    return { edgeAt, byId, nodeIndex, edgeIndex, labelIndex: labelIndex ? { search: (x: number, y: number, x2: number, y2: number) => labelIndex.search(x, y, x2, y2).map((at) => labelEdge[at]) } : null, bounds, adjacent, segments, looseByNode };
  }, [nodes, edges, looseEdges, direction]);

  // How many nodes each region holds, for the zoomed-out overview.
  const regionCounts = useMemo(
    () => regions.map((region) => nodes.reduce((sum, node) => sum + (node.x >= region.x && node.y >= region.y && node.x <= region.x + region.width && node.y <= region.y + region.height ? 1 : 0), 0)),
    [regions, nodes],
  );

  const fitTransform = (box = index.bounds) => {
    const w = box.maxX - box.minX, h = box.maxY - box.minY;
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((width - PAD * 2) / w, (height - PAD * 2) / h)));
    // Tall graphs (long scripts) start at the top instead of shrinking to a sliver.
    const readable = Math.max(k, Math.min(0.35, (width - PAD * 2) / w));
    const scale = h * readable > height ? readable : k;
    const x = (width - w * scale) / 2 - box.minX * scale;
    const y = h * scale > height ? PAD - box.minY * scale : (height - h * scale) / 2 - box.minY * scale;
    return zoomIdentity.translate(x, y).scale(scale);
  };

  // First open should show readable source nodes from the beginning. Full-graph fit remains an
  // explicit action; a saved viewport or a requested focus still takes precedence.
  const firstNode = useMemo(() => nodes.reduce<LayoutNode | undefined>((first, node) =>
    !first || node.y < first.y || (node.y === first.y && node.x < first.x) ? node : first,
  undefined), [nodes]);
  const startTransform = () => zoomIdentity
    .translate(firstNode ? width / 2 - (firstNode.x + firstNode.width / 2) * DEFAULT_START_K : width / 2, PAD - (firstNode?.y ?? index.bounds.minY) * DEFAULT_START_K)
    .scale(DEFAULT_START_K);

  const centredOn = (node: LayoutNode, k: number) => zoomIdentity.translate(width / 2 - (node.x + node.width / 2) * k, height / 2 - (node.y + node.height / 2) * k).scale(k);

  // ── drawing ───────────────────────────────────────────────────────
  /** Puts the floating card beside its node, inside the canvas. Done each frame, without React. */
  const placeAnchor = () => {
    const card = anchorBox.current;
    const node = props.current.anchorId ? index.byId.get(props.current.anchorId) : undefined;
    if (!card || !node) return;
    const t = transform.current;
    const x = node.x * t.k + t.x, y = node.y * t.k + t.y, w = node.width * t.k;
    const cardW = card.offsetWidth, cardH = card.offsetHeight;
    let left = x + w + ANCHOR_GAP;
    if (left + cardW > width - ANCHOR_GAP) left = x - cardW - ANCHOR_GAP;
    left = Math.max(ANCHOR_GAP, Math.min(left, width - cardW - ANCHOR_GAP));
    const top = Math.max(ANCHOR_GAP, Math.min(y, height - cardH - ANCHOR_GAP));
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    card.style.opacity = '1';
  };

  const placeToolbar = () => {
    const box = toolbarBox.current;
    const node = props.current.toolbarId ? index.byId.get(props.current.toolbarId) : undefined;
    if (!box || !node) return;
    const t = transform.current;
    const x = (node.x + node.width / 2) * t.k + t.x, y = node.y * t.k + t.y;
    const onScreen = x > 0 && x < width && y > box.offsetHeight + 8 && y < height;
    box.style.transform = `translate(${Math.round(x - box.offsetWidth / 2)}px, ${Math.round(y - box.offsetHeight - 10)}px)`;
    box.style.opacity = onScreen ? '1' : '0';
    box.style.pointerEvents = onScreen ? 'auto' : 'none';
  };

  const draw = () => {
    frame.current = 0;
    placeAnchor();
    placeToolbar();
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const t = transform.current;
    const { selectedId: selected, highlight: focus, emphasised: route } = props.current;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(t.x, t.y);
    context.scale(t.k, t.k);

    const view = { minX: -t.x / t.k, minY: -t.y / t.k, maxX: (width - t.x) / t.k, maxY: (height - t.y) / t.k };
    const colors = getCanvasColors();
    const edgeColor = colors.graphEdge;
    const selectColor = colors.graphSelect;
    const dimmed = focus && focus.size > 0;
    const selectedEdges = selected ? index.adjacent.get(selected) : undefined;

    const detailed = t.k >= DETAIL_K;
    // Zoomed out, nodes are too small to read: each region becomes a card with its name and size,
    // and a click zooms into it. Zoomed in, regions are dashed frames with a small label.
    const overviewMode = !detailed && regions.length > 1;
    regions.forEach((region) => {
      context.save();
      if (overviewMode) {
        context.fillStyle = colors.card;
        context.strokeStyle = colors.graphNodeLine;
        context.lineWidth = 1 / t.k;
        context.fillRect(region.x - 24, region.y - 24, region.width + 48, region.height + 48);
        context.strokeRect(region.x - 24, region.y - 24, region.width + 48, region.height + 48);
      } else {
        context.setLineDash([8 / t.k, 6 / t.k]);
        context.strokeStyle = colors.graphNodeLine;
        context.lineWidth = 1 / t.k;
        context.strokeRect(region.x - 24, region.y - 24, region.width + 48, region.height + 48);
        context.setLineDash([]);
      }
      context.fillStyle = colors.mutedForeground;
      context.font = `${13 / Math.max(t.k, 0.05)}px Pretendard, system-ui, sans-serif`;
      // Labels keep their screen size, so zoomed out they are cut to the region's width instead of running into the next one.
      const room = region.width + 48;
      let label = region.label;
      while (label.length > 1 && context.measureText(label).width > room) label = `${label.slice(0, -2)}…`;
      if (!overviewMode) context.fillText(label, region.x - 24, region.y - 24 - 8 / t.k);
      context.restore();
    });

    // Loose (hub) edges lie beneath everything else, in a single pass.
    const segments = index.segments;
    if (segments.length) {
      const muted = colors.mutedForeground;
      const own = selected ? new Set(index.looseByNode.get(selected)) : undefined;
      context.strokeStyle = muted;
      context.lineWidth = Math.max(0.5, 0.75 / t.k);
      // Hub lines are many and long; drawn all at once they hide the flow. Only the selected node's show.
      if (own?.size) {
        context.globalAlpha = 0.8;
        context.lineWidth = Math.max(1, 1.2 / t.k);
        context.beginPath();
        for (const at of own) {
          const i = at * 4;
          context.moveTo(segments[i], segments[i + 1]);
          context.lineTo(segments[i + 2], segments[i + 3]);
        }
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    // Edges first, so nodes sit on top of their lines.
    context.lineWidth = Math.max(1.4, 1.6 / t.k);
    context.lineJoin = 'round';
    const visibleEdges = (index.edgeIndex?.search(view.minX, view.minY, view.maxX, view.maxY) ?? []);
    context.strokeStyle = edgeColor;
    context.globalAlpha = dimmed ? 0.35 : 1;
    context.beginPath();
    for (const i of visibleEdges) {
      if (selectedEdges?.has(String(i)) || route.has(i) || edges[i].derived) continue;
      traceEdge(context, edges[i]);
    }
    context.stroke();
    context.setLineDash([6 / t.k, 5 / t.k]);
    context.beginPath();
    for (const i of visibleEdges) if (edges[i].derived && !selectedEdges?.has(String(i)) && !route.has(i)) traceEdge(context, edges[i]);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
    if (t.k > 0.08) for (const i of visibleEdges) if (!selectedEdges?.has(String(i)) && !route.has(i)) arrowHead(context, edges[i].points, 8, edgeColor, dimmed ? 0.35 : 1);
    // The emphasised edges (the main route) at full strength, thicker, in the text colour: not the selection's colour.
    if (route.size) {
      const strong = colors.foreground;
      const shown = visibleEdges.filter((i) => route.has(i) && !selectedEdges?.has(String(i)));
      context.strokeStyle = strong;
      context.lineWidth = Math.max(1.8, 2 / t.k);
      context.beginPath();
      for (const i of shown) traceEdge(context, edges[i]);
      context.stroke();
      if (t.k > 0.08) for (const i of shown) arrowHead(context, edges[i].points, 8, strong, 1);
    }
    if (selectedEdges) {
      context.strokeStyle = selectColor;
      context.lineWidth = Math.max(2, 2.4 / t.k);
      context.beginPath();
      for (const key of selectedEdges) traceEdge(context, edges[Number(key)]);
      context.stroke();
      for (const key of selectedEdges) arrowHead(context, edges[Number(key)].points, 9, selectColor, 1);
    }
    const picked = props.current.selectedEdgeId !== undefined ? index.edgeAt.get(props.current.selectedEdgeId) : undefined;
    if (picked !== undefined) {
      context.strokeStyle = selectColor;
      context.lineWidth = Math.max(2.6, 3 / t.k);
      context.beginPath();
      traceEdge(context, edges[picked]);
      context.stroke();
      arrowHead(context, edges[picked].points, 10, selectColor, 1);
    }

    // Edge labels (a choice reads as the label of the way it opens), once they can be read.
    if (t.k >= DETAIL_K) {
      context.font = '500 11px Pretendard, system-ui, sans-serif';
      context.textBaseline = 'middle';
      for (const i of visibleEdges) {
        const edge = edges[i];
        const box = labelBox(edge);
        if (!box) continue;
        const [x, y, w, h] = box;
        context.globalAlpha = dimmed && !selectedEdges?.has(String(i)) && !route.has(i) ? 0.45 : 1;
        context.beginPath();
        context.roundRect(x, y, w, h, h / 2);
        context.fillStyle = edge.via ? colors.primarySoft : colors.card;
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = edge.via ? colors.primary : colors.border;
        // A derived edge's label is a summary, not source text: dashed like its line, muted.
        if (edge.derived) context.setLineDash([3, 2]);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = edge.via ? colors.primary : colors.mutedForeground;
        let text = `${edge.via ? '▶ ' : ''}${edge.label}`;
        while (text.length > 2 && context.measureText(text).width > w - 14) text = `${text.slice(0, -2)}…`;
        context.fillText(text, x + 7, y + h / 2 + 0.5);
        const markers = edge.via ? props.current.endpointMarkers?.get(edge.via) : undefined;
        if (markers?.length) {
          const labels = markers.map((marker) => marker === 'start' ? '시작' : '끝');
          const label = labels.join('·');
          context.font = '600 10px Pretendard, system-ui, sans-serif';
          const markerWidth = context.measureText(label).width + 12;
          context.fillStyle = colors.primary;
          context.beginPath();
          context.roundRect(x + w - markerWidth - 2, y - 18, markerWidth, 16, 4);
          context.fill();
          context.fillStyle = colors.primaryInk;
          context.fillText(label, x + w - markerWidth + 4, y - 10);
        }
      }
      context.globalAlpha = 1;
      context.textBaseline = 'alphabetic';
    }

    const visible = (index.nodeIndex?.search(view.minX, view.minY, view.maxX, view.maxY) ?? []);
    for (const i of visible) {
      const node = nodes[i];
      const meta = info.get(node.id);
      // While a box is dragged it shows what it will pick: only its nodes, or added to the selection with ⌘/Ctrl.
      const inBox = boxed.current?.ids.has(node.id) ?? false;
      const isSelected = boxed.current && !boxed.current.additive ? inBox : inBox || node.id === selected || Boolean(props.current.selectedIds?.has(node.id));
      const faded = dimmed && !focus!.has(node.id) && !isSelected;
      context.globalAlpha = faded || overviewMode ? 0.25 : 1;
      const hub = props.current.hubs?.get(node.id);
      if (hub) {
        drawHub(context, node, hub, { selected: isSelected, selectColor, detailed, k: t.k, colors });
        continue;
      }
      drawShape(context, meta?.kind ?? 'unknown', node, { selected: isSelected, selectColor, detailed, k: t.k, colors });
      if (detailed && meta) drawLabel(context, meta, node, colors);
      const markers = props.current.endpointMarkers?.get(node.id);
      if (markers?.length) {
        const label = markers.map((marker) => marker === 'start' ? '시작' : '끝').join('·');
        context.font = '600 11px Pretendard, system-ui, sans-serif';
        context.textBaseline = 'middle';
        const markerWidth = context.measureText(label).width + 14;
        const markerHeight = 18;
        context.fillStyle = colors.primary;
        context.beginPath();
        context.roundRect(node.x + node.width - markerWidth, node.y - markerHeight - 3, markerWidth, markerHeight, 5);
        context.fill();
        context.fillStyle = colors.primaryInk;
        context.fillText(label, node.x + node.width - markerWidth + 7, node.y - markerHeight / 2 - 3);
        context.textBaseline = 'alphabetic';
      }
    }
    context.globalAlpha = 1;
    // Editing: the two dots of each line card, and the line being drawn from one of them.
    if (props.current.editable && detailed) {
      const r = Math.max(4, 3.5 / t.k);
      context.lineWidth = Math.max(1.5, 1.5 / t.k);
      for (const i of visible) {
        const node = nodes[i];
        if (!portable(info.get(node.id)?.kind, node.id, props.current.hubs, props.current.connectScenes)) continue;
        for (const [px, py] of Object.values(portsOf(node, direction))) {
          context.beginPath();
          context.arc(px, py, r, 0, Math.PI * 2);
          context.fillStyle = colors.mutedForeground;
          context.fill();
          context.strokeStyle = colors.card;
          context.stroke();
        }
      }
    }
    const line = connecting.current;
    if (line) {
      const target = nodeAt(line.x, line.y);
      if (target && target.id !== line.from) {
        context.strokeStyle = colors.primary;
        context.lineWidth = Math.max(2, 2 / t.k);
        context.strokeRect(target.x - 3, target.y - 3, target.width + 6, target.height + 6);
      }
      context.strokeStyle = colors.primary;
      context.lineWidth = Math.max(1.6, 1.8 / t.k);
      context.setLineDash([6 / t.k, 4 / t.k]);
      context.beginPath();
      context.moveTo(line.px, line.py);
      context.lineTo(line.x, line.y);
      context.stroke();
      context.setLineDash([]);
    }
    if (overviewMode)
      regions.forEach((region, i) => {
        const cx = region.x + region.width / 2, cy = region.y + region.height / 2;
        const size = 15 / t.k;
        context.textAlign = 'center';
        context.fillStyle = colors.foreground;
        context.font = `600 ${size}px Pretendard, system-ui, sans-serif`;
        let label = region.label;
        while (label.length > 1 && context.measureText(label).width > region.width + 40) label = `${label.slice(0, -2)}…`;
        context.fillText(label, cx, cy);
        context.fillStyle = colors.mutedForeground;
        context.font = `${12 / t.k}px Pretendard, system-ui, sans-serif`;
        context.fillText(`노드 ${regionCounts[i].toLocaleString()}개`, cx, cy + size * 1.4);
        context.textAlign = 'start';
      });
    drawMinimap();
  };
  drawRef.current = draw;

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(() => drawRef.current());
  };

  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  // Minimap: the whole graph fitted and centered, with the current viewport drawn on top. Rendered
  // once per size; the box follows the screen.
  const overview = useMemo(() => {
    const long = 176;
    const aspect = width > 0 && height > 0 ? width / height : 1;
    const boxW = Math.round(aspect >= 1 ? long : long * aspect);
    const boxH = Math.round(aspect >= 1 ? long / aspect : long);
    const w = Math.max(1, index.bounds.maxX - index.bounds.minX), h = Math.max(1, index.bounds.maxY - index.bounds.minY);
    const scale = Math.min((boxW - 2 * MINIMAP_PAD) / w, (boxH - 2 * MINIMAP_PAD) / h);
    const offX = (boxW - w * scale) / 2, offY = (boxH - h * scale) / 2;
    const off = document.createElement('canvas');
    off.width = boxW || 1;
    off.height = boxH || 1;
    const context = off.getContext('2d')!;
    context.fillStyle = getCanvasColors().graphNode;
    for (const node of nodes) context.fillRect(offX + (node.x - index.bounds.minX) * scale, offY + (node.y - index.bounds.minY) * scale, Math.max(1, node.width * scale), Math.max(1, node.height * scale));
    return { image: off, scale, offX, offY };
  }, [nodes, index, width, height, theme]);

  const drawMinimap = () => {
    const element = minimap.current;
    if (!element) return;
    const context = element.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    element.width = overview.image.width * dpr;
    element.height = overview.image.height * dpr;
    element.style.width = `${overview.image.width}px`;
    element.style.height = `${overview.image.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.drawImage(overview.image, 0, 0);
    const t = transform.current;
    const s = overview.scale;
    context.strokeStyle = getCanvasColors().graphSelect;
    context.lineWidth = 1.5;
    context.strokeRect(overview.offX + ((-t.x / t.k) - index.bounds.minX) * s, overview.offY + ((-t.y / t.k) - index.bounds.minY) * s, (width / t.k) * s, (height / t.k) * s);
  };

  // ── interaction ───────────────────────────────────────────────────
  useEffect(() => {
    const element = canvas.current!;
    const zoom = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_K, MAX_K])
      .clickDistance(4)
      // Wheel and touch always zoom/pan; the left and middle buttons pan. Shift+left-drag draws a
      // selection box instead (where box selection is on). Ctrl+drag is left to the browser, as in d3's default.
      .filter((event: MouseEvent | WheelEvent | TouchEvent) => {
        if (connecting.current) return false;
        if (event.type === 'wheel' || event.type.startsWith('touch')) return true;
        const mouse = event as MouseEvent;
        if (mouse.button === 1) return true;
        return mouse.button === 0 && !mouse.ctrlKey && !(props.current.onSelectMany && mouse.shiftKey);
      })
      .on('zoom', (event: { transform: ZoomTransform }) => {
        transform.current = event.transform;
        schedule();
      })
      .on('end', (event: { transform: ZoomTransform }) => {
        setZoomK(event.transform.k);
        props.current.onViewportChange?.({ x: event.transform.x, y: event.transform.y, k: event.transform.k });
      });
    behavior.current = zoom;
    const selection = select(element).call(zoom).on('dblclick.zoom', null);
    const focusBox = () => {
      const ids = props.current.highlight;
      if (!ids?.size) return undefined;
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const id of ids) {
        const node = index.byId.get(id);
        if (!node) continue;
        box.minX = Math.min(box.minX, node.x);
        box.minY = Math.min(box.minY, node.y);
        box.maxX = Math.max(box.maxX, node.x + node.width);
        box.maxY = Math.max(box.maxY, node.y + node.height);
      }
      return Number.isFinite(box.minX) ? box : undefined;
    };
    const target = initialFocus ? index.byId.get(initialFocus) : undefined;
    const focusedBox = focusBox();
    const start = target
      ? initialFocusAlign === 'top'
        ? zoomIdentity.translate(width / 2 - (target.x + target.width / 2) * DEFAULT_START_K, PAD - target.y * DEFAULT_START_K).scale(DEFAULT_START_K)
        : initialFocusAlign === 'left'
          ? zoomIdentity.translate(PAD - target.x * DEFAULT_START_K, height / 2 - (target.y + target.height / 2) * DEFAULT_START_K).scale(DEFAULT_START_K)
          : centredOn(target, DEFAULT_START_K)
      : initialViewport
        ? zoomIdentity.translate(initialViewport.x, initialViewport.y).scale(initialViewport.k)
        : focusedBox
          ? fitTransform(focusedBox)
          : startTransform();
    selection.call(zoom.transform, start);
    return () => void selection.on('.zoom', null);
    // The layout identity decides the starting view; size changes are handled below.
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    schedule();
  }, [theme]); // redraw with the active semantic palette

  useEffect(() => {
    schedule();
  }, [toolbar?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- place the toolbar over its node

  useEffect(() => {
    const element = canvas.current!;
    const previous = previousSize.current;
    previousSize.current = { width, height };
    if (previous && behavior.current) {
      const dx = (width - previous.width) / 2;
      const dy = (height - previous.height) / 2;
      if (dx || dy) {
        const current = transform.current;
        const centered = zoomIdentity.translate(current.x + dx, current.y + dy).scale(current.k);
        select(element).call(behavior.current.transform, centered);
      }
    }
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(width * dpr);
    element.height = Math.round(height * dpr);
    schedule();
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    schedule();
  }, [selectedId, selectedIds, highlight, endpointMarkers, emphasised, info, hubs]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The nodes a box covers, from its corners in canvas pixels. */
  const boxHits = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    const t = transform.current;
    const [x0, x1] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)].map((x) => (x - t.x) / t.k);
    const [y0, y1] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)].map((y) => (y - t.y) / t.k);
    return (index.nodeIndex?.search(x0, y0, x1, y1) ?? []).map((i) => nodes[i].id);
  };

  const finishBox = () => {
    const d = drag.current;
    drag.current = null;
    boxed.current = null;
    schedule();
    setBox(null);
    if (!d?.moved) return;
    suppressClick.current = true;
    props.current.onSelectMany?.(boxHits(d), d.additive);
  };

  // The card is placed again when it opens on another node or its content changes height. Until
  // then it is transparent, not hidden: a hidden card would drop the editor's focus.
  useEffect(() => {
    const card = anchorBox.current;
    if (!card) return;
    card.style.opacity = '0';
    schedule();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(card);
    return () => observer.disconnect();
  }, [anchor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const animateTo = (target: ZoomTransform) => {
    if (behavior.current && canvas.current) select(canvas.current).transition().duration(350).call(behavior.current.transform, target);
  };

  useImperativeHandle(handle, () => ({
    fit: () => animateTo(fitTransform()),
    zoomBy: (factor) => behavior.current && canvas.current && select(canvas.current).transition().duration(200).call(behavior.current.scaleBy, factor),
    zoomTo: (k) => behavior.current && canvas.current && select(canvas.current).transition().duration(200).call(behavior.current.scaleTo, k),
    focus: (id) => {
      const node = index.byId.get(id);
      if (node) {
        animateTo(centredOn(node, Math.max(transform.current.k, DEFAULT_START_K)));
        canvas.current?.focus({ preventScroll: true });
      }
    },
    reveal: (id, room) => {
      const node = index.byId.get(id);
      if (!node) return;
      const t = transform.current;
      const k = Math.max(t.k, DEFAULT_START_K);
      const x = node.x * k + t.x, y = node.y * k + t.y, w = node.width * k, h = node.height * k;
      const block = w + ANCHOR_GAP + room;
      const fits = k === t.k && x >= ANCHOR_GAP && x + block <= width - ANCHOR_GAP && y >= ANCHOR_GAP && y + Math.min(h, height / 2) <= height - ANCHOR_GAP;
      if (fits) return;
      // The node and the card side by side in the middle; a tall node starts near the top.
      const left = Math.max(ANCHOR_GAP, (width - block) / 2);
      const top = h > height - 2 * PAD ? PAD : (height - h) / 2;
      animateTo(zoomIdentity.translate(left - node.x * k, top - node.y * k).scale(k));
    },
  }));

  const regionAt = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const t = transform.current;
    const x = (clientX - rect.left - t.x) / t.k, y = (clientY - rect.top - t.y) / t.k;
    return regions.find((region) => x >= region.x - 24 && y >= region.y - 24 && x <= region.x + region.width + 24 && y <= region.y + region.height + 24);
  };

  const toGraph = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const t = transform.current;
    return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k, k: t.k };
  };
  /** The topmost node at a point in graph coordinates. */
  const nodeAt = (x: number, y: number) => {
    const found = index.nodeIndex?.search(x, y, x, y) ?? [];
    return found.length ? nodes[found[found.length - 1]] : undefined;
  };
  /** The line nearest the pointer, within a few pixels (curves sampled). */
  const hitEdge = (clientX: number, clientY: number) => {
    const { x, y, k } = toGraph(clientX, clientY);
    const reach = 6 / k;
    let best: { id: string; d: number } | undefined;
    for (const i of index.edgeIndex?.search(x - reach, y - reach, x + reach, y + reach) ?? []) {
      const d = distanceToEdge(edges[i], x, y);
      if (d <= reach && (!best || d < best.d)) best = { id: edges[i].id, d };
    }
    return best?.id;
  };
  /** A dot under the pointer: which node, and whether it is the way out. */
  const portAt = (clientX: number, clientY: number) => {
    if (!props.current.editable || transform.current.k < DETAIL_K) return undefined;
    const { x, y, k } = toGraph(clientX, clientY);
    const reach = Math.max(8, 7 / k);
    for (const i of index.nodeIndex?.search(x - reach, y - reach, x + reach, y + reach) ?? []) {
      const node = nodes[i];
      if (!portable(info.get(node.id)?.kind, node.id, props.current.hubs, props.current.connectScenes)) continue;
      const ports = portsOf(node, direction);
      for (const out of [true, false]) {
        const [px, py] = out ? ports.out : ports.in;
        if (Math.hypot(px - x, py - y) <= reach) return { node: node.id, out, px, py };
      }
    }
    return undefined;
  };

  const hit = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const t = transform.current;
    const x = (clientX - rect.left - t.x) / t.k, y = (clientY - rect.top - t.y) / t.k;
    // A choice's label stands for its node: clicking it opens the choice. A derived edge's label
    // stands for the nodes it leaves out: `omitted:<edge id>`.
    if (t.k >= DETAIL_K)
      for (const i of index.labelIndex?.search(x, y, x, y) ?? []) {
        const target = edges[i].via ?? (edges[i].derived && edges[i].omitted ? `omitted:${edges[i].id}` : undefined);
        if (target) return target;
      }
    const found = (index.nodeIndex?.search(x, y, x, y) ?? []);
    return found.length ? nodes[found[found.length - 1]].id : undefined;
  };

  return (
    <div className="relative" style={{ width, height }}>
      <canvas
        ref={canvas}
        style={{ width, height }}
        className="block cursor-grab touch-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        onMouseDown={(event) => {
          // The middle button pans; without this the browser starts its own autoscroll.
          if (event.button === 1) event.preventDefault();
        }}
        onPointerDown={(event) => {
          // A press on a node's dot starts a line (d3-zoom's filter then leaves the drag alone).
          const port = event.button === 0 && !event.shiftKey ? portAt(event.clientX, event.clientY) : undefined;
          if (port) {
            const at = toGraph(event.clientX, event.clientY);
            connecting.current = { from: port.node, out: port.out, px: port.px, py: port.py, x: at.x, y: at.y };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.stopPropagation();
            schedule();
            return;
          }
          if (!boxSelect || event.button !== 0 || !event.shiftKey) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left, y = event.clientY - rect.top;
          drag.current = { x0: x, y0: y, x1: x, y1: y, moved: false, additive: event.metaKey || event.ctrlKey };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (connecting.current) {
            const at = toGraph(event.clientX, event.clientY);
            connecting.current = { ...connecting.current, x: at.x, y: at.y };
            schedule();
            return;
          }
          // A dot is grabbed, not panned: say so with the cursor.
          if (props.current.editable) event.currentTarget.style.cursor = portAt(event.clientX, event.clientY) ? 'crosshair' : '';
          const d = drag.current;
          if (!d) return;
          const rect = event.currentTarget.getBoundingClientRect();
          d.x1 = event.clientX - rect.left;
          d.y1 = event.clientY - rect.top;
          if (!d.moved && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return;
          d.moved = true;
          setBox({ left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1), width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0) });
          boxed.current = { ids: new Set(boxHits(d)), additive: d.additive };
          schedule();
        }}
        onPointerUp={(event) => {
          const line = connecting.current;
          if (!line) return finishBox();
          connecting.current = null;
          suppressClick.current = true;
          const at = toGraph(event.clientX, event.clientY);
          const target = nodeAt(at.x, at.y);
          // From the way-out dot the line goes to the node it is dropped on; from the way-in dot it comes from it.
          if (target && target.id !== line.from && portable(info.get(target.id)?.kind, target.id, props.current.hubs, props.current.connectScenes)) props.current.onConnect?.(line.out ? line.from : target.id, line.out ? target.id : line.from);
          schedule();
        }}
        onPointerCancel={() => {
          drag.current = null;
          boxed.current = null;
          schedule();
          setBox(null);
        }}
        role="img"
        aria-label={`그래프: 노드 ${nodes.length.toLocaleString()}개, 연결 ${(edges.length + (looseEdges?.length ?? 0)).toLocaleString()}개`}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (boxSelect && (event.shiftKey || event.metaKey || event.ctrlKey)) {
            const id = hit(event.clientX, event.clientY);
            if (id) props.current.onSelectMany?.([id], true);
            return;
          }
          const region = transform.current.k < DETAIL_K && regions.length > 1 ? regionAt(event.clientX, event.clientY) : undefined;
          if (region) animateTo(fitTransform({ minX: region.x - 24, minY: region.y - 24, maxX: region.x + region.width + 24, maxY: region.y + region.height + 24 }));
          else {
            const id = hit(event.clientX, event.clientY);
            const edge = !id && props.current.onSelectEdge ? hitEdge(event.clientX, event.clientY) : undefined;
            if (edge) props.current.onSelectEdge!(edge);
            else props.current.onSelect(id);
          }
        }}
        onContextMenu={(event) => {
          if (!props.current.onContextMenu) return;
          event.preventDefault();
          const nodeId = hit(event.clientX, event.clientY);
          const edge = !nodeId && props.current.onEdgeContextMenu ? hitEdge(event.clientX, event.clientY) : undefined;
          if (edge) return props.current.onEdgeContextMenu!(edge, { clientX: event.clientX, clientY: event.clientY });
          props.current.onContextMenu(nodeId, { clientX: event.clientX, clientY: event.clientY });
        }}
        onKeyDown={(event) => {
          const step = 80;
          const moves: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [step, 0], ArrowRight: [-step, 0] };
          if (moves[event.key] && behavior.current) {
            event.preventDefault();
            select(canvas.current!).call(behavior.current.translateBy, moves[event.key][0] / transform.current.k, moves[event.key][1] / transform.current.k);
          } else if (event.key === '+' || event.key === '=') behavior.current && select(canvas.current!).call(behavior.current.scaleBy, 1.25);
          else if (event.key === '-') behavior.current && select(canvas.current!).call(behavior.current.scaleBy, 0.8);
          else if (event.key === 'f') animateTo(fitTransform());
          else if (event.key === 'Enter' && props.current.selectedId) props.current.onOpen?.();
          else if (event.key === 'Escape') props.current.onSelect(undefined);
        }}
      />
      {box && <div aria-hidden className="pointer-events-none absolute rounded-sm border border-primary bg-primary/10" style={box} />}
      {toolbar && (
        <div key={toolbar.id} ref={toolbarBox} className="absolute top-0 left-0 z-20 opacity-0">
          {toolbar.content}
        </div>
      )}
      {anchor && (
        <div ref={anchorBox} className="absolute top-0 left-0 z-20 opacity-0">
          {anchor.content}
        </div>
      )}
      {minimapOpen && (
        <div className="absolute bottom-3 left-3 rounded-md border bg-background/90 shadow-sm">
          <canvas
            ref={minimap}
            className="block cursor-pointer rounded-md"
            aria-label="미니맵"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - rect.left - overview.offX) / overview.scale + index.bounds.minX;
              const y = (event.clientY - rect.top - overview.offY) / overview.scale + index.bounds.minY;
              const k = transform.current.k;
              animateTo(zoomIdentity.translate(width / 2 - x * k, height / 2 - y * k).scale(k));
            }}
          />
        </div>
      )}
      {/* The same canvas toolbar as the other graphs: zoom, fit, 가로·세로, minimap. */}
      <CanvasToolbar
        zoomPercent={zoomK * 100}
        onZoomIn={() => behavior.current && select(canvas.current!).transition().duration(200).call(behavior.current.scaleBy, 1.25)}
        onZoomOut={() => behavior.current && select(canvas.current!).transition().duration(200).call(behavior.current.scaleBy, 0.8)}
        onFit={() => animateTo(fitTransform())}
        onResetZoom={() => behavior.current && select(canvas.current!).transition().duration(180).call(behavior.current.scaleTo, 1)}
        direction={onDirectionChange ? direction : undefined}
        onDirectionChange={onDirectionChange}
        minimapVisible={minimapOpen}
        onToggleMinimap={() => toggleMinimap(!minimapOpen)}
        className="absolute right-3 bottom-3 z-30"
      />
    </div>
  );
}

function drawHub(context: CanvasRenderingContext2D, node: LayoutNode, hub: HubInfo, options: { selected: boolean; selectColor: string; detailed: boolean; k: number; colors: ReturnType<typeof getCanvasColors> }) {
  const muted = options.colors.muted;
  const mutedForeground = options.colors.mutedForeground;
  context.beginPath();
  context.roundRect(node.x, node.y, node.width, node.height, node.height / 2);
  context.fillStyle = muted;
  context.fill();
  if (options.selected || options.detailed) {
    context.lineWidth = options.selected ? Math.max(2.5, 2.5 / options.k) : 1;
    context.strokeStyle = options.selected ? options.selectColor : mutedForeground;
    context.setLineDash(options.selected ? [] : [4, 3]);
    context.stroke();
    context.setLineDash([]);
  }
  if (options.detailed) {
    context.save();
    context.fillStyle = mutedForeground;
    context.font = '12px Pretendard, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`연결점 · 장면 ${hub.scenes}개`, node.x + node.width / 2, node.y + node.height / 2);
    context.restore();
  }
}

function traceEdge(context: CanvasRenderingContext2D, edge: LayoutEdge) {
  const p = edge.points;
  if (!edge.curved) return tracePolyline(context, p);
  context.moveTo(p[0], p[1]);
  for (let i = 2; i + 5 < p.length; i += 6) context.bezierCurveTo(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
}

function tracePolyline(context: CanvasRenderingContext2D, points: number[]) {
  if (points.length < 4) return;
  context.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) context.lineTo(points[i], points[i + 1]);
}

function arrowHead(context: CanvasRenderingContext2D, points: number[], size: number, color: string, alpha: number) {
  const n = points.length;
  if (n < 4) return;
  const x = points[n - 2], y = points[n - 1];
  const angle = Math.atan2(y - points[n - 3], x - points[n - 4]);
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - size * Math.cos(angle - 0.45), y - size * Math.sin(angle - 0.45));
  context.lineTo(x - size * Math.cos(angle + 0.45), y - size * Math.sin(angle + 0.45));
  context.closePath();
  context.fill();
  context.restore();
}

function drawLabel(context: CanvasRenderingContext2D, meta: NodeInfo, node: LayoutNode, colors: ReturnType<typeof getCanvasColors>) {
  context.save();
  context.fillStyle = colors.foreground;
  if (meta.kind === 'choice') {
    // A choice: its text in the pill, after the play mark.
    context.beginPath();
    context.rect(node.x + 14, node.y + 4, node.width - 28, node.height - 8);
    context.clip();
    context.font = '500 11px Pretendard, system-ui, sans-serif';
    context.fillStyle = colors.primary;
    context.fillText('▶ 선택지', node.x + 22, node.y + 22);
    context.font = '600 13px Pretendard, system-ui, sans-serif';
    context.fillStyle = colors.primaryInk;
    context.fillText(meta.body ?? meta.preview ?? meta.label ?? '', node.x + 22, node.y + 40);
  } else if (meta.kind === 'script' || meta.kind === 'scene' || meta.kind === 'chain') {
    context.beginPath();
    context.rect(node.x + 10, node.y + 6, node.width - 20, node.height - 12);
    context.clip();
    context.font = '600 14px Pretendard, system-ui, sans-serif';
    if (meta.titleColor) {
      const index = paletteIndex(meta.titleColor);
      context.fillStyle = index >= 0 ? colors.hues[index]! : meta.titleColor;
    }
    context.fillText(meta.title ?? (meta.kind === 'scene' || meta.kind === 'chain' ? (meta.label ?? meta.key) : meta.key), node.x + 12, node.y + 23);
    context.font = '14px Pretendard, system-ui, sans-serif';
    context.fillStyle = colors.mutedForeground;
    wrapText(context, meta.body ?? meta.preview ?? meta.label ?? '', node.x + 12, node.y + 44, node.width - 24, 18, 2);
  } else if (meta.kind === 'portal') {
    // Section stand-in: the name sits inside the box.
    context.font = '11px Pretendard, system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillStyle = colors.mutedForeground;
    context.fillText(meta.label ?? '', node.x + node.width / 2, node.y + node.height / 2 + 4);
  } else if (node.width > 40) {
    context.font = '11px Pretendard, system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillStyle = colors.foreground;
    const text = meta.label ?? meta.kind;
    context.fillText(text.length > 18 ? `${text.slice(0, 17)}…` : text, node.x + node.width / 2, node.y + node.height + 13);
  }
  context.restore();
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const lines = wrapTextLines(text, maxWidth, maxLines, (line) => context.measureText(line).width);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
}

/** Nodes a line can be drawn to or from: lines, choices, conditions and other nodes of the graph (scenes only in the scene graph), not portals, hubs or folded labels. */
function portable(kind: string | undefined, id: string, hubs?: Map<string, unknown>, scenes?: boolean) {
  return Boolean(kind) && kind !== 'portal' && (scenes || kind !== 'scene') && !id.startsWith('portal:') && !id.startsWith('hub:') && !hubs?.has(id);
}

/** A node's two dots: the way in (top, or left when horizontal) and the way out (bottom / right). */
function portsOf(node: { x: number; y: number; width: number; height: number }, direction: 'vertical' | 'horizontal') {
  return direction === 'vertical'
    ? { in: [node.x + node.width / 2, node.y] as const, out: [node.x + node.width / 2, node.y + node.height] as const }
    : { in: [node.x, node.y + node.height / 2] as const, out: [node.x + node.width, node.y + node.height / 2] as const };
}

/** Distance from a point to a drawn edge: its segments, or its Bézier curves sampled. */
function distanceToEdge(edge: LayoutEdge, x: number, y: number) {
  const p = edge.points;
  const segment = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(ax + t * dx - x, ay + t * dy - y);
  };
  let best = Infinity;
  if (!edge.curved) {
    for (let i = 0; i + 3 < p.length; i += 2) best = Math.min(best, segment(p[i], p[i + 1], p[i + 2], p[i + 3]));
    return best;
  }
  let [px, py] = [p[0], p[1]];
  for (let i = 2; i + 5 < p.length; i += 6) {
    let [lastX, lastY] = [px, py];
    for (let step = 1; step <= 12; step++) {
      const t = step / 12, u = 1 - t;
      const qx = u * u * u * px + 3 * u * u * t * p[i] + 3 * u * t * t * p[i + 2] + t * t * t * p[i + 4];
      const qy = u * u * u * py + 3 * u * u * t * p[i + 1] + 3 * u * t * t * p[i + 3] + t * t * t * p[i + 5];
      best = Math.min(best, segment(lastX, lastY, qx, qy));
      [lastX, lastY] = [qx, qy];
    }
    [px, py] = [p[i + 4], p[i + 5]];
  }
  return best;
}
