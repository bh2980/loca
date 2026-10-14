import { useEffect, useMemo, useState } from 'react';
import { Controls, Handle, MarkerType, Position, ReactFlow, Background, type Edge, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import ELK from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import '@xyflow/react/dist/style.css';
import { useSize } from '@/hooks/use-size';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
}

type Shape = 'line' | 'choice' | 'fork' | 'stub';
type PathNodeData = {
  shape: Shape;
  speaker?: string | null;
  text?: string | null;
  lines: number;
  join: boolean;
  /** Fork pill text ('조건' / '동시에 열림'). */
  pill?: string;
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
        <span className="truncate">{data.shape === 'choice' ? '선택지' : (data.speaker ?? '지문·화면 문구')}</span>
        {data.lines > 1 && <Badge variant="secondary">{data.lines.toLocaleString()}줄</Badge>}
        {data.join && <Badge variant="outline">합류</Badge>}
        {data.picked && (
          <Button variant="ghost" size="inline" className="nodrag ml-auto" onClick={data.onAuto}>
            자동으로 고르기
          </Button>
        )}
      </div>
      <p className="line-clamp-2 text-sm leading-snug">{data.shape === 'choice' ? `▶ ${data.text ?? ''}` : (data.text ?? '')}</p>
      {handles}
    </div>
  );
}
const nodeTypes = { path: PathNodeView };

type Positions = { key: string; at: Record<string, { x: number; y: number }> };
/** Layouts already made, by the slice they were made from: coming back to the same slice does not run ELK again. */
const layouts = new Map<string, Positions>();
const LAYOUTS_KEPT = 8;

/** The latest layout is also kept for this tab, so a reload does not wait for ELK again. */
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

async function layoutOf(key: string, items: { id: string; shape: Shape }[], edges: { from: string; to: string }[]): Promise<Positions> {
  const hit = layouts.get(key) ?? storedLayout(key);
  if (hit) return hit;
  const ids = new Set(items.map((item) => item.id));
  const result = await elk.layout({
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '44', 'elk.layered.thoroughness': '1' },
    children: items.map((item) => ({ id: item.id, ...SIZE[item.shape] })),
    edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge, i) => ({ id: `e${i}`, sources: [edge.from], targets: [edge.to] })),
  });
  const layout: Positions = { key, at: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])) };
  layouts.set(key, layout);
  try {
    sessionStorage.setItem(LAYOUT_STORE, JSON.stringify({ hash: hashOf(key), layout }));
  } catch {
    // A convenience: without storage the slice is laid out again.
  }
  if (layouts.size > LAYOUTS_KEPT) layouts.delete(layouts.keys().next().value!);
  return layout;
}

const MIN_FIT_ZOOM = 0.35;
const OPEN_ZOOM = 0.7;
const viewportStore = (projectId: string) => `tw.graph.path.${projectId}`;
function readViewport(projectId: string, key: string): Viewport | undefined {
  try {
    const stored = JSON.parse(sessionStorage.getItem(viewportStore(projectId)) ?? 'null') as { key: string; viewport: Viewport } | null;
    return stored?.key === key ? stored.viewport : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 길 따라 보기: the route slice (services/route-slice.ts) drawn top-to-bottom. Lines come from the
 * dialogue graph's node list; clicking a block selects it (the page's `node`), clicking a stub picks
 * that arm. Pan and zoom are kept in sessionStorage only, never in history.
 */
export function PathGraph({ projectId, slice, texts, selectedId, onSelect, onPick, onAuto, onReady }: {
  projectId: string;
  slice: PathSlice;
  texts: Map<string, PathNodeText>;
  selectedId?: string;
  onSelect: (blockId: string | undefined) => void;
  onPick: (forkNodeId: string, armNodeId: string) => void;
  onAuto: (forkNodeId: string) => void;
  /** Called once the first layout is on screen (for timing). */
  onReady?: () => void;
}) {
  const { items, flowEdges, key } = useMemo(() => {
    const joins = new Set(slice.joins);
    const blockOf = new Map(slice.blocks.flatMap((block) => block.nodeIds.map((id) => [id, block.id] as const)));
    const forkAt = new Map(slice.forks.map((fork) => [blockOf.get(fork.nodeId) ?? fork.nodeId, fork] as const));
    const items: { id: string; shape: Shape; data: PathNodeData }[] = [];
    for (const block of slice.blocks) {
      const fork = forkAt.get(block.id);
      const picked = fork?.mode === 'choice' && fork.arms.some((arm) => arm.picked);
      const common = { lines: block.unitIds.length, join: joins.has(block.id), picked, onAuto: fork ? () => onAuto(fork.nodeId) : undefined };
      if (!block.unitIds.length) {
        items.push({ id: block.id, shape: 'fork', data: { ...common, shape: 'fork', pill: fork ? (fork.mode === 'choice' ? '조건' : '동시에 열림') : '이어짐' } });
        continue;
      }
      const first = block.nodeIds.map((id) => texts.get(id)).find((node) => node?.text);
      const choice = block.kind === 'choice';
      items.push({ id: block.id, shape: choice ? 'choice' : 'line', data: { ...common, shape: choice ? 'choice' : 'line', speaker: first?.speaker, text: first?.text } });
    }
    for (const stub of slice.stubs) {
      items.push({ id: stub.id, shape: 'stub', data: { shape: 'stub', lines: stub.lines, join: false, label: stub.label, alone: stub.rejoins.length === 0, onStub: () => onPick(stub.fork, stub.arm) } });
    }
    const flowEdges: Edge[] = slice.edges.map((edge, i) => {
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
    const key = `${items.map((item) => `${item.id}:${item.shape}`).join('|')}#${slice.edges.map((edge) => `${edge.from}>${edge.to}`).join('|')}`;
    return { items, flowEdges, key };
  }, [slice, texts, onPick, onAuto]);

  const [positions, setPositions] = useState<Positions>();
  const [failed, setFailed] = useState<string>();
  const [frame, size] = useSize<HTMLDivElement>();
  useEffect(() => {
    let current = true;
    layoutOf(key, items, slice.edges).then(
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
  // Opening fits the whole slice; one too long to read when fitted (a tall single column) opens on its beginning instead (전체 맞춤 shows all).
  const placed = items.filter((item) => positions.at[item.id]);
  const bottom = Math.max(0, ...placed.map((item) => positions.at[item.id].y + SIZE[item.shape].height));
  const right = Math.max(1, ...placed.map((item) => positions.at[item.id].x + SIZE[item.shape].width));
  const fitted = size.width && size.height ? Math.min(size.width / right, size.height / bottom) : 1;
  const opening = fitted >= MIN_FIT_ZOOM ? undefined : placed.filter((item) => positions.at[item.id].y < size.height / OPEN_ZOOM).map((item) => ({ id: item.id }));
  return (
    <div ref={frame} className="h-full w-full">
    <ReactFlow
      key={key}
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      defaultViewport={saved}
      fitView={!saved}
      fitViewOptions={{ padding: 0.15, maxZoom: 1, nodes: opening }}
      minZoom={0.05}
      maxZoom={2}
      onlyRenderVisibleElements
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_event, node) => node.data.shape !== 'stub' && onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      onMoveEnd={(_event, viewport) => {
        try {
          sessionStorage.setItem(viewportStore(projectId), JSON.stringify({ key, viewport }));
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
