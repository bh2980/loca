import { Button } from '@loca/ui';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Map as MapIcon, Minimize2 } from 'lucide-react';
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
}

/**
 * An edge label's box: where the layout put it (the edge runs through it and nothing else is
 * there), else centred halfway along the line.
 */
function labelBox(edge: LayoutEdge): [number, number, number, number] | null {
  if (!edge.label) return null;
  if (edge.labelAt) return edge.labelAt;
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
  /** Hub nodes by id; drawn as quiet pills instead of the usual node shapes. */
  hubs?: Map<string, HubInfo>;
  info: Map<string, NodeInfo>;
  width: number;
  height: number;
  selectedId?: string;
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
export function GraphCanvas({ nodes, regions = [], edges: laidOut, looseEdges, direction = 'vertical', hubs, info, width, height, selectedId, highlight, endpointMarkers, highlightEdges, initialViewport, initialFocus, initialFocusAlign = 'center', onViewportChange, onSelect, onContextMenu, onOpen, anchor, handle }: Props) {
  const theme = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const transform = useRef<ZoomTransform>(zoomIdentity);
  const behavior = useRef<ZoomBehavior<HTMLCanvasElement, unknown>>(null);
  const frame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const previousSize = useRef<{ width: number; height: number } | null>(null);
  const anchorBox = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (minimapOpen) schedule();
  }, [minimapOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the obstacle-avoiding ELK route; its label already has reserved space.
  const edges = laidOut;
  // Which of the drawn edges are emphasised, by position.
  const emphasised = useMemo(() => new Set(highlightEdges?.size ? edges.flatMap((edge, i) => (highlightEdges.has(`${edge.from}|${edge.to}`) ? [i] : [])) : []), [edges, highlightEdges]);
  const props = useRef({ selectedId, highlight, endpointMarkers, emphasised, onViewportChange, onSelect, onOpen, hubs, anchorId: anchor?.id, onContextMenu });
  props.current = { selectedId, highlight, endpointMarkers, emphasised, onViewportChange, onSelect, onOpen, hubs, anchorId: anchor?.id, onContextMenu };

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
    return { byId, nodeIndex, edgeIndex, bounds, adjacent, segments, looseByNode };
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

  const draw = () => {
    frame.current = 0;
    placeAnchor();
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
      if (selectedEdges?.has(String(i)) || route.has(i)) continue;
      traceEdge(context, edges[i]);
    }
    context.stroke();
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
        context.stroke();
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
      const isSelected = node.id === selected;
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
        context.fillText(`노드 ${regionCounts[i].toLocaleString()}개 · 눌러서 확대`, cx, cy + size * 1.4);
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
      .on('zoom', (event: { transform: ZoomTransform }) => {
        transform.current = event.transform;
        schedule();
      })
      .on('end', (event: { transform: ZoomTransform }) => props.current.onViewportChange?.({ x: event.transform.x, y: event.transform.y, k: event.transform.k }));
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
  }, [selectedId, highlight, endpointMarkers, emphasised, info, hubs]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const hit = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const t = transform.current;
    const x = (clientX - rect.left - t.x) / t.k, y = (clientY - rect.top - t.y) / t.k;
    // A choice's label stands for its node: clicking it opens the choice.
    if (t.k >= DETAIL_K)
      for (const i of index.edgeIndex?.search(x - 100, y - 20, x + 100, y + 20) ?? []) {
        const box = edges[i].via ? labelBox(edges[i]) : null;
        if (box && x >= box[0] && x <= box[0] + box[2] && y >= box[1] && y <= box[1] + box[3]) return edges[i].via;
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
        role="img"
        aria-label={`그래프: 노드 ${nodes.length.toLocaleString()}개, 연결 ${(edges.length + (looseEdges?.length ?? 0)).toLocaleString()}개`}
        onClick={(event) => {
          const region = transform.current.k < DETAIL_K && regions.length > 1 ? regionAt(event.clientX, event.clientY) : undefined;
          if (region) animateTo(fitTransform({ minX: region.x - 24, minY: region.y - 24, maxX: region.x + region.width + 24, maxY: region.y + region.height + 24 }));
          else props.current.onSelect(hit(event.clientX, event.clientY));
        }}
        onContextMenu={(event) => {
          if (!props.current.onContextMenu) return;
          event.preventDefault();
          const nodeId = hit(event.clientX, event.clientY);
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
      {anchor && (
        <div ref={anchorBox} className="absolute top-0 left-0 z-20 opacity-0">
          {anchor.content}
        </div>
      )}
      {minimapOpen ? (
        <div className="absolute bottom-3 left-3 rounded-md border bg-background/90 shadow-sm">
          <Button variant="outline" size="icon-xs" onClick={() => toggleMinimap(false)} className="absolute -top-2.5 -right-2.5 rounded-full text-muted-foreground" aria-label="미니맵 접기">
            <Minimize2 />
          </Button>
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
      ) : (
        <Button variant="outline" onClick={() => toggleMinimap(true)} className="absolute bottom-3 left-3 text-muted-foreground shadow-sm">
          <MapIcon /> 미니맵
        </Button>
      )}
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
