import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, Background, type Edge, type EdgeProps, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import { isIdentifierLabel } from '@tw/shared';
import ELK from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import '@xyflow/react/dist/style.css';
import { useSize } from '@/hooks/use-size';
import { Button, Badge, Tooltip, TooltipContent, TooltipTrigger, HelpTip } from '@loca/ui';
import { SeamStateChip } from '@/components/graph/seam-check-pane';
import { q } from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';
import { foldTranslated, splitBackEdges, windowOf, placeSeams, type Arm, type Hub, type Overview } from '@/components/graph/path-window';
import { cn } from '@/lib/utils';
import { useIsDark } from '@/lib/theme';

/** What a slice block needs from the graph's node list (the first line of a node). */
export interface PathNodeText {
  speaker: string | null;
  text: string | null;
}
export interface PathSlice {
  blocks: { id: string; nodeIds: string[]; unitIds: string[]; kind: string; translated: number }[];
  edges: { from: string; to: string; label: string | null; kind: 'path' | 'stub' | 'rejoin' }[];
  forks: { nodeId: string; mode: 'choice' | 'parallel'; arms: { nodeId: string; label: string; chosen: boolean; picked: boolean }[] }[];
  stubs: { id: string; fork: string; arm: string; label: string; lines: number; rejoins: string[] }[];
  seams: { nodeId: string; from: string }[];
  overview: Overview;
}

type Shape = 'line' | 'choice' | 'fork' | 'section' | 'more' | 'folded';
type PathNodeData = {
  shape: Shape;
  speaker?: string | null;
  text?: string | null;
  lines: number;
  /** Of them, the lines that have a translation (0 when none, or not known). */
  translated?: number;
  /** Folded: how many boxes it stands for. */
  parts?: number;
  /** Pill text of an anchor without lines ('조건' / '시작' / '이어짐'). */
  pill?: string;
  /** Section: ways opened at once inside it (0: none). */
  lanes?: number;
  /** A choice is made here (not drawn; keeps the node open and unfolded). */
  fork?: boolean;
  /** Marker: where it leads ('이 앞으로 이어짐' / '이 뒤에서 이어짐'). */
  hint?: string;
  onMove?: () => void;
  /** Folded: opens it in place. */
  onExpand?: () => void;
  /** The list is here (the window's centre). */
  here?: boolean;
  /** Starts one of several choices that open at the same place ("동시에 열림 i/n"). */
  arm?: Arm;
  /** Window: arms the column numbers at this node, and targets that only loop back (replaces `lanes`). */
  hub?: Hub;
  /** A seam whose entering edge is not drawn: marked here instead ('이음새' + check state). */
  seamMark?: { state: 'checked' | 'stale' | undefined };
  /** Seam (round 2 on): the first lines after it are shown open, with their translation. */
  seam?: { projectId: string; nodeId: string };
};
type PathNode = Node<PathNodeData, 'path'>;

const SIZE: Record<Shape, { width: number; height: number }> = {
  line: { width: 260, height: 76 },
  choice: { width: 260, height: 52 },
  fork: { width: 130, height: 28 },
  section: { width: 260, height: 76 },
  more: { width: 56, height: 28 },
  folded: { width: 260, height: 36 },
};
/** A seam shows its first two lines (source and translation, one row each) instead of the 2-line preview. */
const SEAM_EXTRA = 64;
const boxOf = (shape: Shape, seam = false, wide = false) => {
  const base = SIZE[shape];
  // A pill that also says 'i/n' or '이음새' keeps it on one line.
  if (shape === 'fork') return { width: wide ? 210 : base.width, height: base.height };
  return { width: base.width, height: base.height + (seam ? SEAM_EXTRA : 0) };
};
const boxOfData = (shape: Shape, data: PathNodeData) => boxOf(shape, !!data.seam && shape !== 'fork', !!data.arm || !!data.seamMark);
// Dense slices (hundreds of blocks with many parallel lanes) take seconds: laid out off the page's thread.
const elk = new ELK({ workerFactory: () => new ElkWorker() });

/** The first lines after a seam, with their translation: these stay open where the translated stretch behind them folds. */
function SeamLines({ seam }: { seam: NonNullable<PathNodeData['seam']> }) {
  const detail = useQuery(q.seamDetail(seam.projectId, seam.nodeId)).data;
  if (!detail) return <p className="text-xs text-muted-foreground">불러오는 중…</p>;
  return (
    <ul className="space-y-0.5" data-testid="seam-open-lines">
      {detail.after.map((line) => (
        <li key={line.unitId} className="min-w-0">
          <p className="truncate text-sm leading-snug">{line.source}</p>
          <p className="truncate text-xs text-muted-foreground">{line.translation || '번역 없음'}</p>
        </li>
      ))}
    </ul>
  );
}

/** 'i/n': this starts one of several choices that open at the same place. It is not a story connection, and says so. */
function ArmChip({ arm, className }: { arm: Arm; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className={cn('shrink-0 tabular-nums', className)} data-testid="arm-chip">
          {arm.index}/{arm.count}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{`같은 자리에서 함께 열리는 선택지 ${arm.index}/${arm.count}, 이야기 연결이 아님`}</TooltipContent>
    </Tooltip>
  );
}

/** '동시에 열림 n' counts the arms the column numbers; targets that only loop back are said apart ('↺ n'). */
function HubChips({ arms, loops, behind }: { arms: number; loops: number; behind: number }) {
  const notes = [loops ? `직접 연결 ${loops}개는 이 노드로 되돌아오는 길이라 갈래로 세지 않았습니다(↺).` : '', behind ? `직접 연결 ${behind}개는 다른 갈래 뒤에서 이어져 갈래로 세지 않았습니다.` : ''].filter(Boolean);
  if (!arms && !loops) return null;
  return (
    <Badge variant="secondary" className="min-w-0 truncate tabular-nums" title={notes.join(' ') || undefined}>
      {arms > 0 ? `동시에 열림 ${arms.toLocaleString()}` : '되돌아감'}
      {loops > 0 ? ` · ↺${loops.toLocaleString()}` : ''}
    </Badge>
  );
}

/** The seam's marker on its own node: used when the edge into it is not drawn. */
function SeamMark({ state }: { state: 'checked' | 'stale' | undefined }) {
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid="seam-mark">
      이음새
      <SeamStateChip state={state} className="h-4 px-1.5 text-xs" />
    </span>
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
  if (data.shape === 'folded')
    return (
      <div style={size} className="flex items-center">
        <Button variant="outline" className="nodrag h-full w-full border-dashed bg-muted font-normal text-muted-foreground" title={`번역을 마친 ${data.parts?.toLocaleString()}개 구간을 접었습니다. 누르면 펼칩니다.`} onClick={data.onExpand}>
          번역함 · {data.lines.toLocaleString()}줄
          {data.arm && <ArmChip arm={data.arm} className="ml-2" />}
        </Button>
        {handles}
      </div>
    );
  if (data.shape === 'fork')
    return (
      <div style={size} className={cn('flex flex-col items-center gap-1', selected && 'ring-2 ring-primary/30')} data-here={data.here || undefined}>
        <div className="flex h-7 w-full items-center justify-center gap-1 rounded-full border bg-muted px-2 text-xs whitespace-nowrap text-muted-foreground">
          {data.pill}
          {data.seamMark && <SeamMark state={data.seamMark.state} />}
          {data.arm && <ArmChip arm={data.arm} />}
        </div>
        {handles}
      </div>
    );
  return (
    <div style={size} className={cn('relative flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border bg-background px-3 py-1.5 text-sm shadow-xs', data.here && 'shadow-[inset_3px_0_0_var(--primary)]', selected && 'border-primary ring-2 ring-primary/30')} data-here={data.here || undefined}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className={cn('max-w-48 truncate', data.shape === 'section' && 'shrink-0')}>
          {data.shape === 'section' ? (data.translated && data.translated < data.lines ? '구간' : `구간 · ${data.lines.toLocaleString()}줄`) : data.shape === 'choice' ? '선택지' : (data.speaker ?? '지문·화면 문구')}
        </span>
        {data.shape !== 'section' && data.lines > 1 && <Badge variant="secondary" className="shrink-0">{data.lines.toLocaleString()}줄</Badge>}
        {!!data.translated && data.translated < data.lines && (
          <span className="inline-flex items-center gap-1"><Badge variant="outline" className="shrink-0 tabular-nums">{data.translated.toLocaleString()}/{data.lines.toLocaleString()}</Badge><HelpTip>번역한 줄 / 이 노드의 줄</HelpTip></span>
        )}
        {!!data.lanes && <HubChips arms={data.hub ? data.hub.arms : data.lanes} loops={data.hub?.loops ?? 0} behind={data.hub?.behind ?? 0} />}
        {data.seamMark && <SeamMark state={data.seamMark.state} />}
        {data.arm && <ArmChip arm={data.arm} />}
      </div>
      {data.seam && data.shape !== 'section' ? (
        <SeamLines seam={data.seam} />
      ) : (
      <p className="line-clamp-2 text-sm leading-snug">
        {data.shape === 'choice' ? `▶ ${data.text ?? ''}` : data.shape === 'section' ? (data.text ? `${data.speaker ? `${data.speaker}: ` : ''}${data.text}` : '대사 없는 이어짐') : (data.text ?? '')}
      </p>
      )}
      {handles}
    </div>
  );
}

/** The edge into a seam: 이음새 label with its check state; `base` is the text the edge had. */
type SeamEdge = { state: 'checked' | 'stale' | undefined; base?: string };
const seamWord = (state: SeamEdge['state']) => (state === 'checked' ? '점검함' : state === 'stale' ? '바뀜' : '미점검');

/** An edge routed by ELK (orthogonal, around the boxes), with its label where ELK left room for it. */
type Route = { points: { x: number; y: number }[]; label?: { x: number; y: number; width: number } };
function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps<Edge<{ route?: Route; label?: string; seam?: SeamEdge }>>) {
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
            className="nodrag nopan pointer-events-none absolute flex items-center gap-1 rounded-sm bg-background px-1 text-xs text-muted-foreground"
            style={{ transform: `translate(${route.label.x}px, ${route.label.y}px)`, width: route.label.width }}
            title={data.label}
          >
            {data.seam ? (
              <>
                {data.seam.base && <span className="min-w-0 truncate">{data.seam.base}</span>}
                <span className="shrink-0">이음새</span>
                <SeamStateChip state={data.seam.state} className="h-4 px-1.5 text-xs" />
              </>
            ) : (
              <span className="truncate">{data.label}</span>
            )}
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
const foldStore = (projectId: string) => `tw.graph.path.folds.${projectId}`;
function readExpanded(projectId: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(foldStore(projectId)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeExpanded(projectId: string, expanded: Set<string>) {
  try {
    sessionStorage.setItem(foldStore(projectId), JSON.stringify([...expanded]));
  } catch {
    // A convenience: without storage a reload folds again.
  }
}
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
 * section or anchor selects it (the page's `node`; the other choices of a fork and its loops are said in the pane), clicking a
 * marker at the window's edge moves the window. Pan and zoom are kept in sessionStorage only, never in history.
 */
export function PathGraph({ projectId, slice, texts, checks, at, all, selectedId, folds = true, onSelect, onMove, onReady }: {
  projectId: string;
  slice: PathSlice;
  texts: Map<string, PathNodeText>;
  /** 이음새 점검 per seam (the seam's block id), for the state on the edge into it. */
  checks?: Record<string, { state: 'checked' | 'stale' }>;
  /** The overview node the window is around. */
  at?: string;
  /** Draw the whole overview instead of the window. */
  all: boolean;
  selectedId?: string;
  /** Fold translated stretches into one node and open a seam's first lines on its node (the map beside the translation list does neither: the list does). */
  folds?: boolean;
  /** A section or anchor was clicked. */
  onSelect: (id: string | undefined) => void;
  /** A marker was clicked: the window moves there. */
  onMove: (id: string) => void;
  /** Called once the first layout is on screen (for timing). */
  onReady?: () => void;
}) {
  const dark = useIsDark();
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  // Folded stretches the person opened (first overview node of the stretch): a session convenience, not page state.
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded(projectId));
  const expand = useCallback((first: string) => {
    setExpanded((current) => {
      const next = new Set(current).add(first);
      writeExpanded(projectId, next);
      return next;
    });
  }, [projectId]);
  // Every overview node as a drawable item, made once per slice.
  const catalog = useMemo(() => {
    const blocks = new Map(slice.blocks.map((block) => [block.id, block] as const));
    const items = new Map<string, { id: string; shape: Shape; data: PathNodeData }>();
    for (const node of slice.overview.nodes) {
      const translated = node.blockIds.reduce((sum, id) => sum + (blocks.get(id)?.translated ?? 0), 0);
      // A seam's first lines are shown open on its node; the map beside the translation list leaves them to the list.
      const common = { lines: node.unitIds.length, translated, fork: node.choice, seam: node.seam && folds ? { projectId, nodeId: node.id } : undefined };
      const first = node.nodeIds.map((id) => texts.get(id)).find((item) => item?.text);
      if (node.kind === 'section') {
        items.set(node.id, { id: node.id, shape: 'section', data: { ...common, shape: 'section', lanes: node.lanes, seam: undefined, fork: false, speaker: first?.speaker, text: first?.text } });
      } else if (!node.unitIds.length) {
        const pill = node.choice ? '조건' : node.join || node.seam ? '이어짐' : '시작';
        items.set(node.id, { id: node.id, shape: 'fork', data: { ...common, shape: 'fork', pill, fork: false } });
      } else {
        const choice = blocks.get(node.id)?.kind === 'choice';
        items.set(node.id, { id: node.id, shape: choice ? 'choice' : 'line', data: { ...common, shape: choice ? 'choice' : 'line', speaker: first?.speaker, text: first?.text } });
      }
    }
    return items;
  }, [slice, texts, projectId, folds]);

  const { items, flowEdges, plain, key, foldOf } = useMemo(() => {
    const windowed = windowOf(slice.overview, at, all);
    const markers = new Map(windowed.markers.map((marker) => [marker.id, marker] as const));
    // A loop back to a box above would circle round the boxes: left out of the drawing (the pane of the node it leaves says where it goes).
    const split = windowed.back ? { forward: windowed.edges, back: windowed.back } : splitBackEdges(windowed.ids, windowed.edges);
    // Stretches whose lines are all translated fold into one node; choices, seams (their first lines stay open) and the selection stay open.
    const foldable = (id: string) => {
      const data = catalog.get(id)?.data;
      return folds && !!data && data.shape !== 'fork' && data.lines > 0 && data.translated === data.lines && !data.fork && !data.seam && id !== selectedId;
    };
    const folded = foldTranslated(windowed.ids, split.forward, foldable, expanded);
    const forward = folded.edges;
    const foldById = new Map(folded.folds.map((fold) => [fold.id, fold] as const));
    const foldOf = new Map(folded.folds.flatMap((fold) => fold.members.map((member) => [member, fold.id] as const)));
    const ovOf = new Map(slice.overview.nodes.flatMap((node) => node.blockIds.map((id) => [id, node.id] as const)));
    // One marker per seam: on the edge into it when that edge is drawn, else on the seam node.
    const placed = placeSeams({ ids: folded.ids, edges: forward, seams: slice.seams, ovOf, isMarker: (id) => markers.has(id), foldMembers: (id) => foldById.get(id)?.members });
    const items = folded.ids.flatMap((id) => {
      const fold = foldById.get(id);
      if (fold) {
        const lines = fold.members.reduce((sum, member) => sum + (catalog.get(member)?.data.lines ?? 0), 0);
        return [{ id, shape: 'folded' as const, data: { shape: 'folded' as const, lines, parts: fold.members.length, arm: windowed.arms?.get(fold.members[0]!), onExpand: () => expand(fold.members[0]!) } }];
      }
      const marker = markers.get(id);
      if (marker) return [{ id, shape: 'more' as const, data: { shape: 'more' as const, lines: 0, hint: marker.direction === 'ahead' ? '이 앞으로 이어짐' : '이 뒤에서 이어짐', onMove: () => moveRef.current(marker.target) } }];
      const item = catalog.get(id);
      const arm = windowed.arms?.get(id);
      const hub = item?.shape === 'section' && item.data.lanes ? (windowed.hubs?.get(id) ?? (windowed.hubs ? { arms: 0, loops: 0, behind: 0 } : undefined)) : undefined;
      const seamMark = placed.node.has(id) ? { state: checks?.[id]?.state } : undefined;
      return item ? [arm || hub || seamMark ? { ...item, data: { ...item.data, arm, hub, seamMark } } : item] : [];
    });
    // Only text a person reads goes on an edge: exporter identifiers ("tps-01-game-intro", "rules-x=0") would clutter the line.
    // The edges into a seam: from a block of the route's new lines (it may sit in a fold) or from a marker at the window's edge.
    const drawn = forward.map((edge, i) => {
      const readable = edge.label && !isIdentifierLabel(edge.label) ? edge.label : undefined;
      // A reading connector is not a story edge: it says so (and carries the option text of the arm it leads to).
      const reading = (edge as { kind?: string }).kind === 'reading';
      // A reading connector is not a story edge: dashed and without text (its arm start carries the 'i/n' chip).
      const base = reading ? undefined : readable;
      const seam: SeamEdge | undefined = placed.edge[i] ? { state: checks?.[edge.to]?.state, base } : undefined;
      // The layout reserves room for the longest state word, so a check never moves the boxes (or the saved view).
      const reserve = (state: SeamEdge['state']) => `${base ? `${base} · ` : ''}이음새 · ${seamWord(state)}`;
      return { edge, reading, id: `${edge.from}>${edge.to}#${i}`, label: seam ? reserve(seam.state) : base, room: seam ? reserve(undefined) : base, seam };
    });
    const flowEdges: Edge[] = drawn.map(({ reading, edge, id, label, seam }) => {
      const color = reading ? 'var(--muted-foreground)' : 'var(--foreground)';
      return {
        id,
        source: edge.from,
        target: edge.to,
        label,
        data: { seam },
        labelStyle: { fontSize: 12, fill: 'var(--muted-foreground)' },
        labelBgStyle: { fill: 'var(--background)' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: reading ? { stroke: color, strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.7 } : { stroke: color, strokeWidth: 1.25, opacity: 0.85 },
      };
    });
    const plain: LayoutEdge[] = drawn.map(({ edge, id, room }) => ({ id, from: edge.from, to: edge.to, label: room }));
    const armKey = [...(windowed.arms ?? [])].map(([id, arm]) => `${id}=${arm.index}/${arm.count}`).join(',');
    const key = `${items.map((item) => `${item.id}:${item.shape}${item.data.seam ? 's' : ''}${item.data.seamMark ? 'S' : ''}${item.data.hub ? `h${item.data.hub.arms}.${item.data.hub.loops}` : ''}`).join('|')}#${plain.map((edge) => `${edge.from}>${edge.to}${edge.label ? `:${edge.label}` : ''}`).join('|')}#${drawn.map((item) => (item.reading ? 'r' : 'p')).join('')}#${armKey}`;
    return { items, flowEdges, plain, key, foldOf };
  }, [slice.overview, slice.seams, catalog, checks, at, all, expanded, selectedId, folds, expand]);

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
    () => (positions ? items.filter((item) => positions.at[item.id]).map((item) => ({ id: item.id, type: 'path', position: positions.at[item.id], data: item.id === at ? { ...item.data, here: true } : item.data, selected: item.id === selectedId, draggable: false, connectable: false })) : []),
    [items, positions, selectedId, at],
  );

  const edges = useMemo(
    () => flowEdges.map((edge) => (positions?.routes?.[edge.id] ? { ...edge, type: 'routed', label: undefined, data: { route: positions.routes[edge.id], label: edge.label, seam: (edge.data as { seam?: SeamEdge } | undefined)?.seam } } : edge)),
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
  const focus = at ? (positions.at[at] ?? positions.at[foldOf.get(at) ?? '']) : undefined;
  const viewport = !all && !saved && size.width && size.height ? windowViewport({ left, top, width: right - left, height: bottom - top }, size, (focus?.x ?? left) + SIZE.section.width / 2) : saved;
  const fitted = size.width && size.height ? Math.min(size.width / right, size.height / bottom) : 1;
  const opening = all && fitted < MIN_FIT_ZOOM ? placed.filter((item) => positions.at[item.id].y < size.height / OPEN_ZOOM).map((item) => ({ id: item.id })) : undefined;
  return (
    <div ref={frame} className="h-full w-full" data-path-nodes={placed.length}>
    <ReactFlow colorMode={dark ? 'dark' : 'light'}
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
      onNodeClick={(_event, node) => node.data.shape !== 'more' && node.data.shape !== 'folded' && onSelect(node.id)}
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
