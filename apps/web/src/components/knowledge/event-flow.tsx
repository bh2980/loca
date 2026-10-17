import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Background, Controls, Handle, MarkerType, Panel, Position, ReactFlow, type Edge, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import '@xyflow/react/dist/style.css';
import { Button } from '@loca/ui';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';

const elk = new ELK();
const CARD = { width: 288, height: 92 };
/** Space between one section's flow and the next, and for its title. */
const SECTION_GAP = 96;

export interface FlowEvent {
  id: string;
  title: string;
  summary: string;
  participants: string[];
  status: string;
  at: { seq: number; section: string | null; scene: string; key: string } | null;
  /** Events this one leads to directly in the dialogue graph, with the choice/condition way when it splits. */
  next: { id: string; label: string | null }[];
}

type EventNode = Node<{ event: FlowEvent; badge: ReactNode; elsewhere: string | null }, 'event'>;
type SectionNode = Node<{ title: string }, 'section'>;

function EventCard({ data, selected }: NodeProps<EventNode>) {
  const { event } = data;
  return (
    <div className={cn('flex flex-col rounded-md border bg-background px-3 py-2 text-left shadow-xs', selected && 'border-primary ring-2 ring-primary/30', event.status === 'candidate' && 'border-dashed')} style={CARD}>
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <span className="flex items-baseline gap-2">
        <span className="truncate text-sm font-medium">{event.title}</span>
        <span className="ml-auto shrink-0">{data.badge}</span>
      </span>
      <span className="truncate text-xs text-muted-foreground">{[event.at?.scene, event.participants.join(' · ')].filter(Boolean).join(' — ')}</span>
      {event.summary && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{event.summary}</span>}
      {data.elsewhere && <span className="mt-auto truncate text-xs text-muted-foreground">→ {data.elsewhere}</span>}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

function SectionTitle({ data }: NodeProps<SectionNode>) {
  return <div className="text-base font-semibold whitespace-nowrap">{data.title}</div>;
}

const nodeTypes = { event: EventCard, section: SectionTitle };

/**
 * Events as a top-to-bottom flow, like the source graph, one block per section (the file's
 * chapter / act / day). A line joins two events only when the dialogue graph leads from one to the
 * other (derived, never guessed); where an event leads several ways the flow splits sideways with
 * the ways' choice labels and joins where the routes meet, nested splits included. Events with no
 * such link keep script order without a line. Cards can be dragged; positions are remembered in
 * this browser until "배치 되돌리기". Events whose evidence is not in the script sit in a last block.
 */
export function EventFlow({ projectId, events, selected, onOpen, badge, filtered }: { projectId: string; events: FlowEvent[]; /** Filters are set (so none matching is not the same as none yet). */ filtered?: boolean; selected?: string; onOpen: (id?: string) => void; badge: (event: FlowEvent) => ReactNode }) {
  const placed = useMemo(() => events.filter((event) => event.at).sort((a, b) => a.at!.seq - b.at!.seq), [events]);
  const sections = useMemo(() => [...Map.groupBy(placed, (event) => event.at!.section ?? '').entries()], [placed]);
  const unplaced = useMemo(() => events.filter((event) => !event.at), [events]);
  const sectionOf = useMemo(() => new Map(placed.map((event) => [event.id, event.at!.section ?? ''])), [placed]);
  const byId = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const titled = sections.length > 1 || sections.some(([section]) => section) || unplaced.length > 0;
  const layoutKey = events.map((event) => `${event.id}>${event.next.map((step) => step.id).join(',')}`).join('|');

  // Dragged positions: a per-browser convenience, like the relationship graph.
  const storageKey = `tw.events.layout.${projectId}`;
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    } catch {
      return {};
    }
  });
  const remember = (next: Record<string, { x: number; y: number }>) => {
    setMoved(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Without storage the positions last until reload.
    }
  };

  const [layout, setLayout] = useState<{ key: string; positions: Record<string, { x: number; y: number }>; titles: { id: string; title: string; x: number; y: number }[] }>();
  useEffect(() => {
    let live = true;
    const blocks = [...sections.map(([section, list]) => ({ title: section || '구역 없음', list })), ...(unplaced.length ? [{ title: '위치 모름 · 근거 대사가 대본에 없음', list: unplaced }] : [])];
    void Promise.all(blocks.map((block) => layoutSection(block.list))).then((results) => {
      if (!live) return;
      const positions: Record<string, { x: number; y: number }> = {};
      const titles: { id: string; title: string; x: number; y: number }[] = [];
      let top = 0;
      results.forEach((result, i) => {
        const offset = titled ? 40 : 0;
        if (titled) titles.push({ id: `section:${i}`, title: blocks[i].title, x: 0, y: top });
        for (const [id, at] of Object.entries(result.positions)) positions[id] = { x: at.x, y: top + offset + at.y };
        top += offset + result.height + SECTION_GAP;
      });
      setLayout({ key: layoutKey, positions, titles });
    });
    return () => {
      live = false;
    };
    // layoutKey describes which events there are and how they link.
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = useMemo<(EventNode | SectionNode)[]>(() => {
    if (!layout) return [];
    return [
      ...layout.titles.map((title): SectionNode => ({ id: title.id, type: 'section', position: { x: title.x, y: title.y }, data: { title: title.title }, draggable: false, selectable: false })),
      ...events.map((event): EventNode => {
        const elsewhere = event.next.filter((step) => event.at && sectionOf.get(step.id) !== sectionOf.get(event.id));
        return {
          id: event.id,
          type: 'event',
          position: moved[event.id] ?? layout.positions[event.id] ?? { x: 0, y: 0 },
          data: { event, badge: badge(event), elsewhere: elsewhere.length ? elsewhere.map((step) => `${sectionOf.get(step.id) || '다른 구역'}: ${byId.get(step.id)?.title}`).join(', ') : null },
          selected: event.id === selected,
          width: CARD.width,
          height: CARD.height,
        };
      }),
    ];
  }, [layout, events, moved, selected, sectionOf, byId, badge]);
  // Positions while dragging sit on top of the memoized nodes; the drop is kept in `moved`.
  const frame = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const flowNodes = useMemo(() => nodes.map((node) => (dragging[node.id] ? { ...node, position: dragging[node.id] } : node)), [nodes, dragging]);

  const edges = useMemo<Edge[]>(
    () =>
      events.flatMap((event) =>
        event.next
          .filter((step) => sectionOf.get(step.id) === sectionOf.get(event.id))
          .map((step) => ({
            id: `${event.id}>${step.id}`,
            source: event.id,
            target: step.id,
            type: 'smoothstep',
            label: step.label ?? undefined,
            labelBgPadding: [4, 2] as [number, number],
            labelStyle: { fontSize: 12, fill: 'var(--muted-foreground)' },
            style: { stroke: 'var(--graph-edge)', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--graph-edge)' },
            selectable: false,
          })),
      ),
    [events, sectionOf],
  );

  if (!events.length) return <EmptyState noun="사건" filtered={filtered} hint="“작품 분석”으로 초안을 받거나 표에서 추가하세요." />;
  if (!layout) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">배치 계산 중…</div>;
  return (
    <div ref={frame} className="h-full">
    <ReactFlow
      key={layout.key}
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={(changes: NodeChange[]) => {
        const moving = changes.flatMap((change) => (change.type === 'position' && change.position ? [[change.id, change.position] as const] : []));
        if (moving.length) setDragging((current) => ({ ...current, ...Object.fromEntries(moving) }));
      }}
      onNodeDragStop={(_event, _node, dragged) => {
        remember({ ...moved, ...Object.fromEntries(dragged.map((node) => [node.id, node.position])) });
        setDragging({});
      }}
      onNodeClick={(_event, node) => node.type === 'event' && onOpen(node.id === selected ? undefined : node.id)}
      onPaneClick={() => selected && onOpen(undefined)}
      // Start at the top of the flow (the first events) at a readable zoom; fit it all only when it is small.
      onInit={(flow) => {
        const bounds = flow.getNodesBounds(flow.getNodes());
        const width = frame.current?.clientWidth ?? 800, height = frame.current?.clientHeight ?? 600;
        const zoom = Math.min(1, (width - 48) / bounds.width, (height - 48) / bounds.height);
        if (zoom >= 0.7) void flow.fitView({ padding: 0.1, maxZoom: 1 });
        else void flow.setViewport({ x: Math.max(24, (width - bounds.width * 0.8) / 2) - bounds.x * 0.8, y: 56 - bounds.y * 0.8, zoom: 0.8 });
      }}
      minZoom={0.1}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
      <Panel position="bottom-right" className="max-w-sm rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        선은 대사 그래프에서 이어지는 사건 사이에만 그립니다. 선이 없는 사건은 대본 순서로 놓았습니다.
      </Panel>
      {Object.keys(moved).length > 0 && (
        <Panel position="top-right">
          <Button variant="outline" className="bg-background" onClick={() => remember({})}>
            배치 되돌리기
          </Button>
        </Panel>
      )}
    </ReactFlow>
    </div>
  );
}

/** One section laid out top to bottom. Script order between unlinked events is kept with layout-only links that are never drawn. */
async function layoutSection(events: FlowEvent[]) {
  const ids = new Set(events.map((event) => event.id));
  const real = events.flatMap((event) => event.next.filter((step) => ids.has(step.id)).map((step) => ({ id: `${event.id}>${step.id}`, from: event.id, to: step.id, label: step.label })));
  const reached = new Set(real.map((edge) => edge.to));
  // An event nothing leads to sits under the one before it in script order.
  const order = events.slice(1).flatMap((event, i) => (reached.has(event.id) ? [] : [{ id: `order:${event.id}`, from: events[i].id, to: event.id }]));
  const graph: ElkNode = {
    id: 'section',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.spacing.nodeNode': '32',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
    },
    children: events.map((event) => ({ id: event.id, ...CARD })),
    edges: [
      ...real.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to], labels: edge.label ? [{ text: edge.label, width: Math.min(160, edge.label.length * 12 + 12), height: 18 }] : [] })),
      ...order.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
    ],
  };
  const result = await elk.layout(graph);
  return { height: result.height ?? 0, positions: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])) };
}
