import { useEffect, useMemo, useRef, useState } from 'react';
import { Controls, Handle, MarkerType, Position, ReactFlow, Background, type Edge, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import ELK from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import '@xyflow/react/dist/style.css';
import { useSize } from '@/hooks/use-size';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

type Shape = 'line' | 'choice' | 'fork' | 'stub' | 'section' | 'more';
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
  /** Stub: its label, and what it leads to. */
  label?: string;
  alone?: boolean;
  /** The fork here has an arm a person picked: they may hand the choice back. */
  picked?: boolean;
  onStub?: () => void;
  onAuto?: () => void;
};
type PathNode = Node<PathNodeData, 'path'>;

const SIZE: Record<Shape, { width: number; height: number }> = {
  line: { width: 260, height: 76 },
  choice: { width: 260, height: 52 },
  fork: { width: 130, height: 28 },
  stub: { width: 220, height: 34 },
  section: { width: 260, height: 76 },
  more: { width: 56, height: 28 },
};
// Dense slices (hundreds of blocks with many parallel lanes) take seconds: laid out off the page's thread.
const elk = new ELK({ workerFactory: () => new ElkWorker() });

function PathNodeView({ data, selected }: NodeProps<PathNode>) {
  const size = SIZE[data.shape];
  const handles = (
    <>
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" />
    </>
  );
  if (data.shape === 'stub')
    return (
      <div style={size} className="flex items-center">
        <Button variant="outline" className="nodrag h-full w-full justify-start border-dashed bg-background/60 font-normal text-muted-foreground" title="이 갈래로 바꾸기" onClick={data.onStub}>
          <span className="truncate">
            ‹{data.label}› · {data.lines.toLocaleString()}줄{data.alone ? ' · 따로 끝남' : ''}
          </span>
        </Button>
        {handles}
      </div>
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
          {data.join && <Badge variant="outline">합류</Badge>}
        </div>
        {data.picked && (
          <Button variant="ghost" className="nodrag" onClick={data.onAuto}>
            자동으로 고르기
          </Button>
        )}
        {handles}
      </div>
    );
  return (
    <div style={size} className={cn('relative flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border bg-background px-3 py-1.5 text-sm shadow-xs', selected && 'border-primary ring-2 ring-primary/30')}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="truncate">
          {data.shape === 'section' ? `구간 · ${data.lines.toLocaleString()}줄` : data.shape === 'choice' ? '선택지' : (data.speaker ?? '지문·화면 문구')}
        </span>
        {data.shape !== 'section' && data.lines > 1 && <Badge variant="secondary">{data.lines.toLocaleString()}줄</Badge>}
        {!!data.lanes && <Badge variant="secondary">동시에 열림 {data.lanes.toLocaleString()}</Badge>}
        {data.fork && <Badge variant="outline">갈림</Badge>}
        {data.join && <Badge variant="outline">합류</Badge>}
        {data.picked && (
          <Button variant="ghost" size="inline" className="nodrag ml-auto" onClick={data.onAuto}>
            자동으로 고르기
          </Button>
        )}
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

async function layoutOf(key: string, items: { id: string; shape: Shape }[], edges: { from: string; to: string }[], whole: boolean): Promise<Positions> {
  const hit = layouts.get(key) ?? (whole ? storedLayout(key) : undefined);
  if (hit) return hit;
  const ids = new Set(items.map((item) => item.id));
  const engine = whole ? elk : await windowElk();
  const result = await engine.layout({
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '44', 'elk.layered.thoroughness': '1' },
    children: items.map((item) => ({ id: item.id, ...SIZE[item.shape] })),
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
 * section or anchor selects it (the page's `node`), clicking a stub picks that arm, clicking a
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
  // Every overview node and stub as a drawable item, made once per slice.
  const catalog = useMemo(() => {
    const blocks = new Map(slice.blocks.map((block) => [block.id, block] as const));
    const blockOf = new Map(slice.blocks.flatMap((block) => block.nodeIds.map((id) => [id, block.id] as const)));
    const forkAt = new Map(slice.forks.map((fork) => [blockOf.get(fork.nodeId) ?? fork.nodeId, fork] as const));
    const items = new Map<string, { id: string; shape: Shape; data: PathNodeData }>();
    for (const node of slice.overview.nodes) {
      const fork = forkAt.get(node.id);
      const picked = fork?.mode === 'choice' && fork.arms.some((arm) => arm.picked);
      const common = { lines: node.unitIds.length, join: node.join, fork: node.choice, picked, onAuto: fork ? () => onAuto(fork.nodeId) : undefined };
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
    for (const stub of slice.stubs) {
      items.set(stub.id, { id: stub.id, shape: 'stub', data: { shape: 'stub', lines: stub.lines, join: false, label: stub.label, alone: stub.rejoins.length === 0, onStub: () => onPick(stub.fork, stub.arm) } });
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
      const soft = edge.kind !== 'path';
      const color = soft ? 'var(--muted-foreground)' : 'var(--foreground)';
      return {
        id: `${edge.from}>${edge.to}#${i}`,
        source: edge.from,
        target: edge.to,
        label: edge.kind === 'path' ? (edge.label ?? undefined) : undefined,
        labelStyle: { fontSize: 12, fill: 'var(--muted-foreground)' },
        labelBgStyle: { fill: 'var(--background)' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: { stroke: color, strokeWidth: 1.25, opacity: soft ? 0.6 : 0.85, strokeDasharray: soft ? '5 4' : undefined },
      };
    });
    const key = `${items.map((item) => `${item.id}:${item.shape}`).join('|')}#${windowed.edges.map((edge) => `${edge.from}>${edge.to}`).join('|')}`;
    return { items, flowEdges, plain: windowed.edges, key };
  }, [slice.overview, catalog, at, all]);

  const [positions, setPositions] = useState<Positions>();
  const [failed, setFailed] = useState<string>();
  const [frame, size] = useSize<HTMLDivElement>();
  useEffect(() => {
    let current = true;
    layoutOf(key, items, plain, all).then(
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
  const bottom = Math.max(0, ...placed.map((item) => positions.at[item.id].y + SIZE[item.shape].height));
  const right = Math.max(1, ...placed.map((item) => positions.at[item.id].x + SIZE[item.shape].width));
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
      onNodeClick={(_event, node) => node.data.shape !== 'stub' && node.data.shape !== 'more' && onSelect(node.id)}
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
