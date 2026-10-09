import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Map as MapIcon, Minimize2 } from 'lucide-react';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import Flatbush from 'flatbush';
import { drawShape } from './shapes';

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
}
export interface NodeInfo {
  id: string;
  type?: string | null;
  kind: string;
  label: string | null;
  preview: string | null;
  key: string;
}
export interface Viewport {
  x: number;
  y: number;
  k: number;
}
export interface GraphCanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  focus(id: string): void;
}

const MIN_K = 0.01;
const MAX_K = 2.5;
const PAD = 48;

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
  info: Map<string, NodeInfo>;
  width: number;
  height: number;
  selectedId?: string;
  /** Nodes to emphasise (e.g. the scene being inspected); others are dimmed when non-empty. */
  highlight?: Set<string>;
  initialViewport?: Viewport;
  onViewportChange?: (viewport: Viewport) => void;
  onSelect: (id: string | undefined) => void;
  handle?: Ref<GraphCanvasHandle>;
}

/**
 * Draws a precomputed ELK layout. d3-zoom owns pan/zoom, Flatbush owns spatial queries,
 * so each frame only touches what is on screen. One <canvas>, no per-node DOM.
 */
export function GraphCanvas({ nodes, regions = [], edges, info, width, height, selectedId, highlight, initialViewport, onViewportChange, onSelect, handle }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const transform = useRef<ZoomTransform>(zoomIdentity);
  const behavior = useRef<ZoomBehavior<HTMLCanvasElement, unknown>>(null);
  const frame = useRef(0);
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
  const props = useRef({ selectedId, highlight, onViewportChange, onSelect });
  props.current = { selectedId, highlight, onViewportChange, onSelect };

  const index = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const nodeIndex = new Flatbush(Math.max(1, nodes.length));
    for (const node of nodes) nodeIndex.add(node.x, node.y, node.x + node.width, node.y + node.height);
    nodeIndex.finish();
    const edgeIndex = new Flatbush(Math.max(1, edges.length));
    for (const edge of edges) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < edge.points.length; i += 2) {
        minX = Math.min(minX, edge.points[i]);
        maxX = Math.max(maxX, edge.points[i]);
        minY = Math.min(minY, edge.points[i + 1]);
        maxY = Math.max(maxY, edge.points[i + 1]);
      }
      if (!edge.points.length) minX = minY = maxX = maxY = 0;
      edgeIndex.add(minX, minY, maxX, maxY);
    }
    edgeIndex.finish();
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
    });
    return { byId, nodeIndex, edgeIndex, bounds, adjacent };
  }, [nodes, edges]);

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

  // ── drawing ───────────────────────────────────────────────────────
  const draw = () => {
    frame.current = 0;
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const t = transform.current;
    const { selectedId: selected, highlight: focus } = props.current;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(t.x, t.y);
    context.scale(t.k, t.k);

    const view = { minX: -t.x / t.k, minY: -t.y / t.k, maxX: (width - t.x) / t.k, maxY: (height - t.y) / t.k };
    const style = getComputedStyle(element);
    const edgeColor = style.getPropertyValue('--graph-edge').trim() || '#bbb';
    const selectColor = style.getPropertyValue('--graph-select').trim() || '#3b6cf6';
    const dimmed = focus && focus.size > 0;
    const selectedEdges = selected ? index.adjacent.get(selected) : undefined;

    for (const region of regions) {
      context.save();
      context.setLineDash([8 / t.k, 6 / t.k]);
      context.strokeStyle = '#d4d4d8';
      context.lineWidth = 1 / t.k;
      context.strokeRect(region.x - 24, region.y - 24, region.width + 48, region.height + 48);
      context.setLineDash([]);
      context.fillStyle = '#71717a';
      context.font = `${13 / Math.max(t.k, 0.05)}px Pretendard, system-ui, sans-serif`;
      context.fillText(region.label, region.x - 24, region.y - 24 - 8 / t.k);
      context.restore();
    }

    // Edges first, so nodes sit on top of their lines.
    context.lineWidth = Math.max(1, 1.2 / t.k) ;
    context.lineJoin = 'round';
    const visibleEdges = index.edgeIndex.search(view.minX, view.minY, view.maxX, view.maxY);
    context.strokeStyle = edgeColor;
    context.globalAlpha = dimmed ? 0.35 : 1;
    context.beginPath();
    for (const i of visibleEdges) {
      if (selectedEdges?.has(String(i))) continue;
      tracePolyline(context, edges[i].points);
    }
    context.stroke();
    context.globalAlpha = 1;
    if (t.k > 0.08) for (const i of visibleEdges) if (!selectedEdges?.has(String(i))) arrowHead(context, edges[i].points, 7, edgeColor, dimmed ? 0.35 : 1);
    if (selectedEdges) {
      context.strokeStyle = selectColor;
      context.lineWidth = Math.max(2, 2.4 / t.k);
      context.beginPath();
      for (const key of selectedEdges) tracePolyline(context, edges[Number(key)].points);
      context.stroke();
      for (const key of selectedEdges) arrowHead(context, edges[Number(key)].points, 9, selectColor, 1);
    }

    const visible = index.nodeIndex.search(view.minX, view.minY, view.maxX, view.maxY);
    const detailed = t.k >= 0.22;
    for (const i of visible) {
      const node = nodes[i];
      const meta = info.get(node.id);
      const isSelected = node.id === selected;
      const faded = dimmed && !focus!.has(node.id) && !isSelected;
      context.globalAlpha = faded ? 0.25 : 1;
      drawShape(context, meta?.kind ?? 'unknown', node, { selected: isSelected, selectColor, detailed, k: t.k });
      if (detailed && meta) drawLabel(context, meta, node);
    }
    context.globalAlpha = 1;
    drawMinimap();
  };

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  };

  // Minimap: a once-rendered overview with the current viewport on top.
  const overview = useMemo(() => {
    const size = 168;
    const w = index.bounds.maxX - index.bounds.minX, h = index.bounds.maxY - index.bounds.minY;
    const scale = Math.min(size / w, size / h);
    const off = document.createElement('canvas');
    off.width = Math.ceil(w * scale) || 1;
    off.height = Math.ceil(h * scale) || 1;
    const context = off.getContext('2d')!;
    context.fillStyle = '#a1a1aa';
    for (const node of nodes) context.fillRect((node.x - index.bounds.minX) * scale, (node.y - index.bounds.minY) * scale, Math.max(1, node.width * scale), Math.max(1, node.height * scale));
    return { image: off, scale };
  }, [nodes, index]);

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
    context.strokeStyle = '#3b6cf6';
    context.lineWidth = 1.5;
    context.strokeRect(((-t.x / t.k) - index.bounds.minX) * s, ((-t.y / t.k) - index.bounds.minY) * s, (width / t.k) * s, (height / t.k) * s);
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
    const start = initialViewport ? zoomIdentity.translate(initialViewport.x, initialViewport.y).scale(initialViewport.k) : fitTransform(focusBox());
    selection.call(zoom.transform, start);
    return () => void selection.on('.zoom', null);
    // The layout identity decides the starting view; size changes are handled below.
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(width * dpr);
    element.height = Math.round(height * dpr);
    schedule();
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    schedule();
  }, [selectedId, highlight, info]); // eslint-disable-line react-hooks/exhaustive-deps

  const animateTo = (target: ZoomTransform) => {
    if (behavior.current && canvas.current) select(canvas.current).transition().duration(350).call(behavior.current.transform, target);
  };

  useImperativeHandle(handle, () => ({
    fit: () => animateTo(fitTransform()),
    zoomBy: (factor) => behavior.current && canvas.current && select(canvas.current).transition().duration(200).call(behavior.current.scaleBy, factor),
    focus: (id) => {
      const node = index.byId.get(id);
      if (!node) return;
      const k = Math.max(transform.current.k, 0.6);
      animateTo(zoomIdentity.translate(width / 2 - (node.x + node.width / 2) * k, height / 2 - (node.y + node.height / 2) * k).scale(k));
    },
  }));

  const hit = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const t = transform.current;
    const x = (clientX - rect.left - t.x) / t.k, y = (clientY - rect.top - t.y) / t.k;
    const found = index.nodeIndex.search(x, y, x, y);
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
        aria-label={`그래프: 노드 ${nodes.length.toLocaleString()}개, 연결 ${edges.length.toLocaleString()}개`}
        onClick={(event) => props.current.onSelect(hit(event.clientX, event.clientY))}
        onKeyDown={(event) => {
          const step = 80;
          const moves: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [step, 0], ArrowRight: [-step, 0] };
          if (moves[event.key] && behavior.current) {
            event.preventDefault();
            select(canvas.current!).call(behavior.current.translateBy, moves[event.key][0] / transform.current.k, moves[event.key][1] / transform.current.k);
          } else if (event.key === '+' || event.key === '=') behavior.current && select(canvas.current!).call(behavior.current.scaleBy, 1.25);
          else if (event.key === '-') behavior.current && select(canvas.current!).call(behavior.current.scaleBy, 0.8);
          else if (event.key === 'f') animateTo(fitTransform());
          else if (event.key === 'Escape') props.current.onSelect(undefined);
        }}
      />
      {minimapOpen ? (
        <div className="absolute bottom-3 left-3 rounded-md border bg-background/90 shadow-sm">
          <button
            type="button"
            onClick={() => toggleMinimap(false)}
            className="absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
            aria-label="미니맵 접기"
          >
            <Minimize2 className="size-3" />
          </button>
      <canvas
        ref={minimap}
        className="block cursor-pointer rounded-md"
        aria-label="미니맵"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - rect.left) / overview.scale + index.bounds.minX;
          const y = (event.clientY - rect.top) / overview.scale + index.bounds.minY;
          const k = transform.current.k;
          animateTo(zoomIdentity.translate(width / 2 - x * k, height / 2 - y * k).scale(k));
        }}
      />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => toggleMinimap(true)}
          className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground"
        >
          <MapIcon className="size-3.5" /> 미니맵
        </button>
      )}
    </div>
  );
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

function drawLabel(context: CanvasRenderingContext2D, meta: NodeInfo, node: LayoutNode) {
  context.save();
  context.fillStyle = '#18181b';
  if (meta.kind === 'script' || meta.kind === 'scene') {
    context.beginPath();
    context.rect(node.x + 10, node.y + 6, node.width - 20, node.height - 12);
    context.clip();
    context.font = '600 12px Pretendard, system-ui, sans-serif';
    context.fillText(meta.kind === 'scene' ? (meta.label ?? meta.key) : meta.key, node.x + 12, node.y + 22);
    context.font = '12px Pretendard, system-ui, sans-serif';
    context.fillStyle = '#52525b';
    wrapText(context, meta.preview ?? meta.label ?? '', node.x + 12, node.y + 42, node.width - 24, 16, 2);
  } else if (node.width > 40) {
    context.font = '11px Pretendard, system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillStyle = '#3f3f46';
    const text = meta.label ?? meta.kind;
    context.fillText(text.length > 18 ? `${text.slice(0, 17)}…` : text, node.x + node.width / 2, node.y + node.height + 13);
  }
  context.restore();
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  let line = '';
  let lines = 0;
  for (const char of text) {
    const next = line + char;
    if (context.measureText(next).width > maxWidth) {
      lines++;
      if (lines === maxLines) {
        context.fillText(`${line.slice(0, -1)}…`, x, y);
        return;
      }
      context.fillText(line, x, y);
      y += lineHeight;
      line = char;
    } else line = next;
  }
  context.fillText(line, x, y);
}
