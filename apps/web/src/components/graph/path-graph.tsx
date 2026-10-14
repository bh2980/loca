import { useEffect, useMemo, useRef, useState } from 'react';
import { Controls, Handle, MarkerType, Position, ReactFlow, Background, type Edge, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import ELK from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import '@xyflow/react/dist/style.css';
import { useSize } from '@/hooks/use-size';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown } from 'lucide-react';
import { windowOf, type Overview } from '@/components/graph/path-window';
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
/** A node with a menu chip is taller (a line) or wider and taller (the pill) than the plain one. */
const boxOf = (shape: Shape, menu: boolean) => {
  const base = SIZE[shape];
  return menu ? (shape === 'fork' ? { width: 170, height: 68 } : { width: base.width, height: base.height + 12 }) : base;
};
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
        <Button variant="ghost" className={cn('nodrag nopan shrink-0', className)} onClick={(event) => event.stopPropagation()}>
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

function PathNodeView({ data, selected }: NodeProps<PathNode>) {
  const size = boxOf(data.shape, !!data.menu);
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
        {handles}
      </div>
    );
  return (
    <div style={size} className={cn('relative flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border bg-background px-3 py-1.5 text-sm shadow-xs', selected && 'border-primary ring-2 ring-primary/30')}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="truncate">
          {data.shape === 'section' ? `구간 · ${data.lines.toLocaleString()}줄` : data.shape === 'choice' ? '선택지' : (data.speaker ?? '지문·화면 문구')}
        </span>
        {data.shape !== 'section' && data.lines > 1 && <Badge variant="secondary" className="shrink-0">{data.lines.toLocaleString()}줄</Badge>}
        {!!data.lanes && <Badge variant="secondary" className="shrink-0">동시에 열림 {data.lanes.toLocaleString()}</Badge>}
        {data.fork && !data.menu && <Badge variant="outline">갈림</Badge>}
        {data.join && <JoinMark comesFrom={data.comesFrom} />}
        {data.menu && <ForkMenu menu={data.menu} className="ml-auto" />}
      </div>
      <p className="line-clamp-2 text-sm leading-snug">
        {data.shape === 'choice' ? `▶ ${data.text ?? ''}` : data.shape === 'section' ? (data.text ? `${data.speaker ? `${data.speaker}: ` : ''}${data.text}` : '대사 없는 이어짐') : (data.text ?? '')}
      </p>
      {handles}
    </div>
  );
}
const nodeTypes = { path: PathNodeView };

type Positions = { key: string; at: Record<string, { x: number; y: number }> };
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

async function layoutOf(key: string, items: { id: string; box: { width: number; height: number } }[], edges: { from: string; to: string }[], whole: boolean): Promise<Positions> {
  const hit = layouts.get(key) ?? (whole ? storedLayout(key) : undefined);
  if (hit) return hit;
  const ids = new Set(items.map((item) => item.id));
  const engine = whole ? elk : await windowElk();
  const result = await engine.layout({
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '44', 'elk.layered.thoroughness': '1' },
    children: items.map((item) => ({ id: item.id, ...item.box })),
    edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge, i) => ({ id: `e${i}`, sources: [edge.from], targets: [edge.to] })),
  });
  const layout: Positions = { key, at: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])) };
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
    const items = windowed.ids.flatMap((id) => {
      const marker = markers.get(id);
      if (marker) return [{ id, shape: 'more' as const, data: { shape: 'more' as const, lines: 0, join: false, hint: marker.direction === 'ahead' ? '이 앞으로 이어짐' : '이 뒤에서 이어짐', onMove: () => moveRef.current(marker.target) } }];
      const item = catalog.get(id);
      return item ? [item] : [];
    });
    const flowEdges: Edge[] = windowed.edges.map((edge, i) => {
      const color = 'var(--foreground)';
      return {
        id: `${edge.from}>${edge.to}#${i}`,
        source: edge.from,
        target: edge.to,
        label: edge.label ?? undefined,
        labelStyle: { fontSize: 12, fill: 'var(--muted-foreground)' },
        labelBgStyle: { fill: 'var(--background)' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: { stroke: color, strokeWidth: 1.25, opacity: 0.85 },
      };
    });
    const key = `${items.map((item) => `${item.id}:${item.shape}${item.data.menu ? 'm' : ''}`).join('|')}#${windowed.edges.map((edge) => `${edge.from}>${edge.to}`).join('|')}`;
    return { items, flowEdges, plain: windowed.edges, key };
  }, [slice.overview, catalog, at, all]);

  const [positions, setPositions] = useState<Positions>();
  const [failed, setFailed] = useState<string>();
  const [frame, size] = useSize<HTMLDivElement>();
  useEffect(() => {
    let current = true;
    layoutOf(key, items.map((item) => ({ id: item.id, box: boxOf(item.shape, !!item.data.menu) })), plain, all).then(
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
  const bottom = Math.max(0, ...placed.map((item) => positions.at[item.id].y + boxOf(item.shape, !!item.data.menu).height));
  const right = Math.max(1, ...placed.map((item) => positions.at[item.id].x + boxOf(item.shape, !!item.data.menu).width));
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
      edges={flowEdges}
      nodeTypes={nodeTypes}
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
