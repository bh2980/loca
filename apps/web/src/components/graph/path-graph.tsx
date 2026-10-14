import { useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, Background, type Edge, type EdgeProps, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import { isIdentifierLabel } from '@tw/shared';
import ELK from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import '@xyflow/react/dist/style.css';
import { useSize } from '@/hooks/use-size';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown } from 'lucide-react';
import { splitBackEdges, windowOf, type Overview } from '@/components/graph/path-window';
import { cn } from '@/lib/utils';

/** What a slice block needs from the graph's node list (the first line of a node). */
export interface PathNodeText {
  speaker: string | null;
  text: string | null;
}
export interface PathSlice {
  blocks: { id: string; nodeIds: string[]; unitIds: string[]; kind: string }[];
  edges: { from: string; to: string; label: string | null; kind: 'path' | 'stub' | 'rejoin' }[];
  forks: { nodeId: string; mode: 'choice' | 'parallel'; arms: { nodeId: string; label: string; chosen: boolean; picked: boolean }[] }[];
  stubs: { id: string; fork: string; arm: string; label: string; lines: number; rejoins: string[] }[];
  joins: string[];
  overview: Overview;
}

type Shape = 'line' | 'choice' | 'fork' | 'section' | 'more';
/** The other ways out of a choice: shown as a menu on its node, never drawn as boxes. */
interface ForkMenuData {
  /** Stubs leaving the choice ('다른 선택 N개'). */
  count: number;
  /** Every arm of the fork. `lines` / `alone` are those of its stub (the arm not taken). */
  arms: { id: string; label: string; chosen: boolean; lines?: number; alone?: boolean }[];
  picked: boolean;
  onPick: (armId: string) => void;
  onAuto: () => void;
}
type PathNodeData = {
  shape: Shape;
  speaker?: string | null;
  text?: string | null;
  lines: number;
  join: boolean;
  /** Pill text of an anchor without lines ('조건' / '시작' / '합류'). */
  pill?: string;
  /** Section: ways opened at once inside it (0: none). */
  lanes?: number;
  /** A choice is made here. */
  fork?: boolean;
  /** Marker: where it leads ('이 앞으로 이어짐' / '이 뒤에서 이어짐'). */
  hint?: string;
  onMove?: () => void;
  /** The fork here and its other ways out (a choice with stubs). */
  menu?: ForkMenuData;
  /** Loops: where the edges that lead back up from here go (not drawn, said on the node). */
  loops?: string[];
  /** Join: the other choices that come back here ('‹label›에서도 들어옴'). */
  comesFrom?: string[];
};
type PathNode = Node<PathNodeData, 'path'>;

const SIZE: Record<Shape, { width: number; height: number }> = {
  line: { width: 260, height: 76 },
  choice: { width: 260, height: 52 },
  fork: { width: 130, height: 28 },
  section: { width: 260, height: 76 },
  more: { width: 56, height: 28 },
};
/** The chip sits on its own row under the header (a line taller); a loop note is one more small row; the pill grows wide enough for both. */
const MENU_ROW = 28;
const LOOP_ROW = 18;
const boxOf = (shape: Shape, menu: boolean, loops = false) => {
  const base = SIZE[shape];
  if (shape === 'fork') return { width: menu || loops ? 170 : base.width, height: base.height + (menu ? 40 : 0) + (loops ? LOOP_ROW : 0) };
  return { width: base.width, height: base.height + (menu ? MENU_ROW : 0) + (loops ? LOOP_ROW : 0) };
};
const boxOfData = (shape: Shape, data: PathNodeData) => boxOf(shape, !!data.menu, !!data.loops?.length);
// Dense slices (hundreds of blocks with many parallel lanes) take seconds: laid out off the page's thread.
const elk = new ELK({ workerFactory: () => new ElkWorker() });

/** '합류': a place where other choices come back; the tooltip says which. */
function JoinMark({ comesFrom }: { comesFrom?: string[] }) {
  const mark = <Badge variant="outline" className="shrink-0">합류</Badge>;
  if (!comesFrom?.length) return mark;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="nodrag">{mark}</span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {comesFrom.map((label) => (
            <li key={label}>‹{label}›에서도 들어옴</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** '다른 선택 N개': every arm of the fork; picking one changes the path. Clicks here must not select the node. */
function ForkMenu({ menu, className }: { menu: ForkMenuData; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={cn('nodrag nopan h-6 shrink-0 px-2 text-xs', className)} onClick={(event) => event.stopPropagation()}>
          다른 선택 {menu.count.toLocaleString()}개
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-80" onClick={(event) => event.stopPropagation()}>
        {menu.arms.map((arm) => (
          <DropdownMenuCheckboxItem key={arm.id} checked={arm.chosen} onCheckedChange={() => !arm.chosen && menu.onPick(arm.id)}>
            <span className="truncate">{arm.label}</span>
            {!arm.chosen && arm.lines !== undefined && (
              <span className="shrink-0 text-muted-foreground">
                · {arm.lines.toLocaleString()}줄{arm.alone ? ' · 따로 끝남' : ''}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
        {menu.picked && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={menu.onAuto}>자동으로 고르기</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** '↺ …로 되돌아감': a loop back up, said instead of drawn. */
function LoopNote({ loops }: { loops: string[] }) {
  return (
    <p className="nodrag w-full truncate text-center text-xs text-muted-foreground" title={loops.map((to) => `‹${to}›로 되돌아감`).join('\n')}>
      ↺ 되돌아감 → ‹{loops[0]}›{loops.length > 1 ? ` 외 ${loops.length - 1}` : ''}
    </p>
  );
}

function PathNodeView({ data, selected }: NodeProps<PathNode>) {
  const size = boxOfData(data.shape, data);
  const handles = (
    <>
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" />
    </>
  );
  if (data.shape === 'more')
    return (
      <div style={size} className="flex items-center">
        <Button variant="outline" className="nodrag h-full w-full rounded-full border-dashed bg-background/60 font-normal text-muted-foreground" aria-label={data.hint} title={data.hint} onClick={data.onMove}>
          …
        </Button>
        {handles}
      </div>
    );
  if (data.shape === 'fork')
    return (
      <div style={size} className={cn('flex flex-col items-center gap-1', selected && 'ring-2 ring-primary/30')}>
        <div className="flex h-7 w-full items-center justify-center gap-1 rounded-full border bg-muted text-xs text-muted-foreground">
          {data.pill}
          {data.join && <JoinMark comesFrom={data.comesFrom} />}
        </div>
        {data.menu && <ForkMenu menu={data.menu} />}
        {!!data.loops?.length && <LoopNote loops={data.loops} />}
        {handles}
      </div>
    );
  return (
    <div style={size} className={cn('relative flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border bg-background px-3 py-1.5 text-sm shadow-xs', selected && 'border-primary ring-2 ring-primary/30')}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="max-w-48 truncate">
          {data.shape === 'section' ? `구간 · ${data.lines.toLocaleString()}줄` : data.shape === 'choice' ? '선택지' : (data.speaker ?? '지문·화면 문구')}
        </span>
        {data.shape !== 'section' && data.lines > 1 && <Badge variant="secondary" className="shrink-0">{data.lines.toLocaleString()}줄</Badge>}
        {!!data.lanes && <Badge variant="secondary" className="shrink-0">동시에 열림 {data.lanes.toLocaleString()}</Badge>}
        {data.fork && !data.menu && <Badge variant="outline">갈림</Badge>}
        {data.join && <JoinMark comesFrom={data.comesFrom} />}
      </div>
      {data.menu && <ForkMenu menu={data.menu} className="-ml-2 self-start" />}
      <p className="line-clamp-2 text-sm leading-snug">
        {data.shape === 'choice' ? `▶ ${data.text ?? ''}` : data.shape === 'section' ? (data.text ? `${data.speaker ? `${data.speaker}: ` : ''}${data.text}` : '대사 없는 이어짐') : (data.text ?? '')}
      </p>
      {!!data.loops?.length && <LoopNote loops={data.loops} />}
      {handles}
    </div>
  );
}

/** An edge routed by ELK (orthogonal, around the boxes), with its label where ELK left room for it. */
type Route = { points: { x: number; y: number }[]; label?: { x: number; y: number; width: number } };
function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps<Edge<{ route?: Route; label?: string }>>) {
  const route = data?.route;
  const points = route?.points ?? [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!, here = points[i]!, next = points[i + 1];
    if (!next) {
      path += ` L ${here.x} ${here.y}`;
      continue;
    }
    // Rounded corner: stop short of the bend on both sides.
    const before = Math.hypot(here.x - prev.x, here.y - prev.y), after = Math.hypot(next.x - here.x, next.y - here.y);
    const r = Math.min(8, before / 2, after / 2);
    if (r < 1) {
      path += ` L ${here.x} ${here.y}`;
      continue;
    }
    path += ` L ${here.x + ((prev.x - here.x) / before) * r} ${here.y + ((prev.y - here.y) / before) * r} Q ${here.x} ${here.y} ${here.x + ((next.x - here.x) / after) * r} ${here.y + ((next.y - here.y) / after) * r}`;
  }
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data?.label && route?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute truncate rounded-sm bg-background px-1 text-xs text-muted-foreground"
            style={{ transform: `translate(${route.label.x}px, ${route.label.y}px)`, width: route.label.width }}
            title={data.label}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { routed: RoutedEdge };
const nodeTypes = { path: PathNodeView };

type Positions = { key: string; at: Record<string, { x: number; y: number }>; routes?: Record<string, Route> };
/** What an edge label needs in the layout: room for its text (CJK is wider), at most LABEL_MAX. */
const LABEL_MAX = 220;
const LABEL_HEIGHT = 20;
const labelWidth = (text: string) => Math.min(LABEL_MAX, 12 + [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7), 0));
type LayoutEdge = { id: string; from: string; to: string; label?: string };
/** Layouts already made, by the (sub)graph they were made from: coming back to the same window does not run ELK again. */
const layouts = new Map<string, Positions>();
const LAYOUTS_KEPT = 60;

/** The latest whole-overview layout is also kept for this tab, so a reload does not wait for ELK again. */
const LAYOUT_STORE = 'tw.graph.path.layout';
const hashOf = (text: string) => {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
};
function storedLayout(key: string): Positions | undefined {
  try {
    const stored = JSON.parse(sessionStorage.getItem(LAYOUT_STORE) ?? 'null') as { hash: string; layout: Positions } | null;
    return stored?.hash === hashOf(key) ? { ...stored.layout, key } : undefined;
  } catch {
    return undefined;
  }
}

// A window is a dozen boxes: laid out on the page's thread, in the bundled ELK loaded when first needed.
let mainElk: Promise<Pick<InstanceType<typeof ELK>, 'layout'>> | undefined;
const windowElk = () => (mainElk ??= import('elkjs/lib/elk.bundled.js').then((module) => new module.default()));

async function layoutOf(key: string, items: { id: string; box: { width: number; height: number } }[], edges: LayoutEdge[], whole: boolean): Promise<Positions> {
  const hit = layouts.get(key) ?? (whole ? storedLayout(key) : undefined);
  if (hit) return hit;
  const ids = new Set(items.map((item) => item.id));
  const engine = whole ? elk : await windowElk();
  const kept = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  // The whole overview is hundreds of boxes: plain layered. A window is a dozen, so its edges are routed
  // orthogonally around the boxes, in script order, with room between layers for the labels on them.
  const result = await engine.layout({
    id: 'root',
    layoutOptions: whole
      ? { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '44', 'elk.layered.thoroughness': '1' }
      : {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
          'elk.layered.thoroughness': '3',
          'elk.spacing.nodeNode': '40',
          'elk.layered.spacing.nodeNodeBetweenLayers': '56',
          'elk.layered.spacing.edgeNodeBetweenLayers': '24',
          'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
          'elk.spacing.edgeNode': '24',
          'elk.spacing.edgeEdge': '16',
          'elk.spacing.edgeLabel': '6',
        },
    children: items.map((item) => ({ id: item.id, ...item.box })),
    edges: kept.map((edge) => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
      ...(!whole && edge.label ? { labels: [{ text: edge.label, width: labelWidth(edge.label), height: LABEL_HEIGHT }] } : {}),
    })),
  });
  const routes: Record<string, Route> = {};
  if (!whole)
    for (const edge of result.edges ?? []) {
      const section = edge.sections?.[0];
      if (!section) continue;
      const label = edge.labels?.[0];
      routes[edge.id] = {
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
        label: label ? { x: label.x ?? 0, y: label.y ?? 0, width: label.width ?? LABEL_MAX } : undefined,
      };
    }
  const layout: Positions = { key, at: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])), ...(whole ? {} : { routes }) };
  layouts.set(key, layout);
  if (whole)
    try {
      sessionStorage.setItem(LAYOUT_STORE, JSON.stringify({ hash: hashOf(key), layout }));
    } catch {
      // A convenience: without storage the overview is laid out again.
    }
  if (layouts.size > LAYOUTS_KEPT) layouts.delete(layouts.keys().next().value!);
  return layout;
}

const MIN_FIT_ZOOM = 0.35;
const OPEN_ZOOM = 0.7;
/** A window opens fitted when that is at least this readable; otherwise at OPEN_ZOOM from its top. */
const MIN_WINDOW_ZOOM = 0.6;
const viewportStore = (projectId: string) => `tw.graph.path.${projectId}`;
function readViewport(projectId: string, key: string): Viewport | undefined {
  try {
    const stored = JSON.parse(sessionStorage.getItem(viewportStore(projectId)) ?? 'null') as { key: string; viewport: Viewport } | null;
    return stored?.key === key ? stored.viewport : undefined;
  } catch {
    return undefined;
  }
}

/** The view a window opens with: fitted if that stays readable, else the window's top at a readable zoom, centred on `focusX`. */
function windowViewport(box: { left: number; top: number; width: number; height: number }, frame: { width: number; height: number }, focusX: number): Viewport {
  const pad = 24;
  const fitted = Math.min((frame.width - 2 * pad) / box.width, (frame.height - 2 * pad) / box.height);
  if (fitted >= MIN_WINDOW_ZOOM) {
    const zoom = Math.min(fitted, 1);
    return { zoom, x: (frame.width - box.width * zoom) / 2 - box.left * zoom, y: (frame.height - box.height * zoom) / 2 - box.top * zoom };
  }
  const zoom = Math.min(OPEN_ZOOM, Math.max(fitted, MIN_WINDOW_ZOOM));
  const wide = box.width * zoom > frame.width - 2 * pad;
  return { zoom, x: wide ? frame.width / 2 - focusX * zoom : (frame.width - box.width * zoom) / 2 - box.left * zoom, y: pad - box.top * zoom };
}

/**
 * 길 따라 보기: the route slice's overview (services/route-slice.ts) drawn top-to-bottom, a window
 * around `at` at a time or all of it. Lines come from the dialogue graph's node list; clicking a
 * section or anchor selects it (the page's `node`), the other choices of a fork are a menu on its node, clicking a
 * marker at the window's edge moves the window. Pan and zoom are kept in sessionStorage only, never in history.
 */
export function PathGraph({ projectId, slice, texts, at, all, selectedId, onSelect, onMove, onPick, onAuto, onReady }: {
  projectId: string;
  slice: PathSlice;
  texts: Map<string, PathNodeText>;
  /** The overview node the window is around. */
  at?: string;
  /** Draw the whole overview instead of the window. */
  all: boolean;
  selectedId?: string;
  /** A section or anchor was clicked. */
  onSelect: (id: string | undefined) => void;
  /** A marker was clicked: the window moves there. */
  onMove: (id: string) => void;
  onPick: (forkNodeId: string, armNodeId: string) => void;
  onAuto: (forkNodeId: string) => void;
  /** Called once the first layout is on screen (for timing). */
  onReady?: () => void;
}) {
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  // Every overview node as a drawable item, made once per slice.
  const catalog = useMemo(() => {
    const blocks = new Map(slice.blocks.map((block) => [block.id, block] as const));
    const blockOf = new Map(slice.blocks.flatMap((block) => block.nodeIds.map((id) => [id, block.id] as const)));
    const forkAt = new Map(slice.forks.map((fork) => [blockOf.get(fork.nodeId) ?? fork.nodeId, fork] as const));
    const items = new Map<string, { id: string; shape: Shape; data: PathNodeData }>();
    const stubOf = new Map(slice.stubs.map((stub) => [`${stub.fork}>${stub.arm}`, stub] as const));
    for (const node of slice.overview.nodes) {
      const fork = forkAt.get(node.id);
      const picked = fork?.mode === 'choice' && fork.arms.some((arm) => arm.picked);
      const count = fork ? slice.stubs.filter((stub) => stub.fork === fork.nodeId).length : 0;
      const menu: ForkMenuData | undefined =
        fork && node.choice && count > 0
          ? {
              count,
              picked,
              arms: fork.arms.map((arm) => {
                const stub = stubOf.get(`${fork.nodeId}>${arm.nodeId}`);
                return { id: arm.nodeId, label: arm.label, chosen: arm.chosen, lines: stub?.lines, alone: stub ? stub.rejoins.length === 0 : undefined };
              }),
              onPick: (armId) => onPick(fork.nodeId, armId),
              onAuto: () => onAuto(fork.nodeId),
            }
          : undefined;
      const here = new Set(node.nodeIds);
      const comesFrom = node.join ? [...new Set(slice.stubs.filter((stub) => stub.rejoins.some((id) => here.has(id))).map((stub) => stub.label))] : undefined;
      const common = { lines: node.unitIds.length, join: node.join, fork: node.choice, menu, comesFrom };
      const first = node.nodeIds.map((id) => texts.get(id)).find((item) => item?.text);
      if (node.kind === 'section') {
        items.set(node.id, { id: node.id, shape: 'section', data: { ...common, shape: 'section', lanes: node.lanes, join: false, fork: false, speaker: first?.speaker, text: first?.text } });
      } else if (!node.unitIds.length) {
        const pill = node.choice ? '조건' : node.join ? '합류' : '시작';
        items.set(node.id, { id: node.id, shape: 'fork', data: { ...common, shape: 'fork', pill, join: node.join && pill !== '합류', fork: false } });
      } else {
        const choice = blocks.get(node.id)?.kind === 'choice';
        items.set(node.id, { id: node.id, shape: choice ? 'choice' : 'line', data: { ...common, shape: choice ? 'choice' : 'line', speaker: first?.speaker, text: first?.text } });
      }
    }
    return items;
  }, [slice, texts, onPick, onAuto]);

  const { items, flowEdges, plain, key } = useMemo(() => {
    const windowed = windowOf(slice.overview, at, all);
    const markers = new Map(windowed.markers.map((marker) => [marker.id, marker] as const));
    // A loop back to a box above would circle round the boxes: left out of the drawing, said on the node it leaves.
    const { forward, back } = splitBackEdges(windowed.ids, windowed.edges);
    const describe = (id: string) => {
      const data = catalog.get(id)?.data;
      return (data?.text ? data.text.replace(/\s+/g, ' ').slice(0, 40) : (data?.pill ?? (data?.shape === 'section' ? '구간' : '줄'))) as string;
    };
    const loops = new Map<string, string[]>();
    for (const edge of back) loops.set(edge.from, [...(loops.get(edge.from) ?? []), describe(edge.to)]);
    const items = windowed.ids.flatMap((id) => {
      const marker = markers.get(id);
      if (marker) return [{ id, shape: 'more' as const, data: { shape: 'more' as const, lines: 0, join: false, hint: marker.direction === 'ahead' ? '이 앞으로 이어짐' : '이 뒤에서 이어짐', onMove: () => moveRef.current(marker.target) } }];
      const item = catalog.get(id);
      return item ? [loops.has(id) ? { ...item, data: { ...item.data, loops: loops.get(id) } } : item] : [];
    });
    // Only text a person reads goes on an edge: exporter identifiers ("tps-01-game-intro", "rules-x=0") would clutter the line.
    const drawn = forward.map((edge, i) => ({ edge, id: `${edge.from}>${edge.to}#${i}`, label: edge.label && !isIdentifierLabel(edge.label) ? edge.label : undefined }));
    const flowEdges: Edge[] = drawn.map(({ edge, id, label }) => {
      const color = 'var(--foreground)';
      return {
        id,
        source: edge.from,
        target: edge.to,
        label,
        labelStyle: { fontSize: 12, fill: 'var(--muted-foreground)' },
        labelBgStyle: { fill: 'var(--background)' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: { stroke: color, strokeWidth: 1.25, opacity: 0.85 },
      };
    });
    const plain: LayoutEdge[] = drawn.map(({ edge, id, label }) => ({ id, from: edge.from, to: edge.to, label }));
    const key = `${items.map((item) => `${item.id}:${item.shape}${item.data.menu ? 'm' : ''}${item.data.loops?.length ? 'l' : ''}`).join('|')}#${plain.map((edge) => `${edge.from}>${edge.to}${edge.label ? `:${edge.label}` : ''}`).join('|')}`;
    return { items, flowEdges, plain, key };
  }, [slice.overview, catalog, at, all]);

  const [positions, setPositions] = useState<Positions>();
  const [failed, setFailed] = useState<string>();
  const [frame, size] = useSize<HTMLDivElement>();
  useEffect(() => {
    let current = true;
    layoutOf(key, items.map((item) => ({ id: item.id, box: boxOfData(item.shape, item.data) })), plain, all).then(
      (layout) => current && setPositions(layout),
      (error: Error) => current && setFailed(error.message),
    );
    return () => {
      current = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (positions) onReady?.();
  }, [positions?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes: PathNode[] = useMemo(
    () => (positions ? items.filter((item) => positions.at[item.id]).map((item) => ({ id: item.id, type: 'path', position: positions.at[item.id], data: item.data, selected: item.id === selectedId, draggable: false, connectable: false })) : []),
    [items, positions, selectedId],
  );

  const edges = useMemo(
    () => flowEdges.map((edge) => (positions?.routes?.[edge.id] ? { ...edge, type: 'routed', label: undefined, data: { route: positions.routes[edge.id], label: edge.label } } : edge)),
    [flowEdges, positions],
  );

  if (failed || !positions || positions.key !== key)
    return (
      <div ref={frame} className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        {failed ? <span className="text-destructive">배치에 실패했습니다: {failed}</span> : '배치 계산 중…'}
      </div>
    );
  const saved = readViewport(projectId, key);
  const placed = items.filter((item) => positions.at[item.id]);
  const left = Math.min(...placed.map((item) => positions.at[item.id].x));
  const top = Math.min(...placed.map((item) => positions.at[item.id].y));
  const bottom = Math.max(0, ...placed.map((item) => positions.at[item.id].y + boxOfData(item.shape, item.data).height));
  const right = Math.max(1, ...placed.map((item) => positions.at[item.id].x + boxOfData(item.shape, item.data).width));
  // A window opens fitted at a readable zoom (or at its top); the whole overview fits, or, when too long to read fitted
  // (a tall single column), opens on its beginning instead (전체 맞춤 shows all).
  const focus = at ? positions.at[at] : undefined;
  const viewport = !all && !saved && size.width && size.height ? windowViewport({ left, top, width: right - left, height: bottom - top }, size, (focus?.x ?? left) + SIZE.section.width / 2) : saved;
  const fitted = size.width && size.height ? Math.min(size.width / right, size.height / bottom) : 1;
  const opening = all && fitted < MIN_FIT_ZOOM ? placed.filter((item) => positions.at[item.id].y < size.height / OPEN_ZOOM).map((item) => ({ id: item.id })) : undefined;
  return (
    <div ref={frame} className="h-full w-full" data-path-nodes={placed.length}>
    <ReactFlow
      key={key}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={viewport}
      fitView={!viewport}
      fitViewOptions={{ padding: 0.15, maxZoom: 1, nodes: opening }}
      minZoom={0.05}
      maxZoom={2}
      onlyRenderVisibleElements
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_event, node) => node.data.shape !== 'more' && onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      onMoveEnd={(_event, next) => {
        try {
          sessionStorage.setItem(viewportStore(projectId), JSON.stringify({ key, viewport: next }));
        } catch {
          // A convenience: without storage the view fits again.
        }
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
    </div>
  );
}
