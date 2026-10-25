import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Background, Handle, MarkerType, useConnection, NodeToolbar, Panel, Position, ReactFlow, SelectionMode, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Trash2 } from 'lucide-react';
import { Box, CanvasToolbar, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger, EmptyState, EventFlowCard, Inline, SelectionToolbox, Stack, Text } from '@loca/ui';
import { personStyle, usePersonColors } from '@/lib/person-colors';
import { useIsDark } from '@/lib/theme';
import { GRAPH_KEYS, useGraphShortcuts } from '@/lib/graph-shortcuts';
import { keyLabel } from '@/lib/keys';
import { EVENT_CARD as CARD, layoutSection, type EventFlowDirection } from './event-flow-layout.ts';
import { lineKey, parseLineKey, type EventFlowActions, type FlowLine } from './event-actions';

/** Space between one section's flow and the next, and for its title. */
const SECTION_GAP = 96;

export interface FlowEvent {
  id: string;
  title: string;
  summary: string;
  participants: string[];
  status: string;
  at: { seq: number; section: string | null; scene: string; key: string } | null;
  /** Events this one leads to: derived from the dialogue graph (with the choice/condition way when it splits), or drawn by hand. */
  next: ({ id: string; label: string | null; source: 'graph' } | { id: string; label: null; source: 'added'; origin: string })[];
}

type EventNode = Node<{ event: FlowEvent; badge: ReactNode; elsewhere: string | null; direction: EventFlowDirection; target: boolean; colorOf: (name: string) => string | undefined }, 'event'>;
type SectionNode = Node<{ title: string }, 'section'>;

/** Events copied with ⌘/Ctrl+C or 복사, pasted as copies ("제목 (복사)"). */
let eventClipboard: string[] = [];

/** A connecting dot as in the other graphs (with a wider grab area); none where the flow only shows. */
const dot = (connectable: boolean): 'event' | 'eventIdle' => (connectable ? 'event' : 'eventIdle')

function EventCard({ data, selected, isConnectable }: NodeProps<EventNode>) {
  const { event } = data;
  // While a line is being drawn, the card under the pointer is framed: that is where it lands.
  const drawing = useConnection((connection) => connection.inProgress);
  const target = data.direction === 'vertical' ? Position.Top : Position.Left;
  const source = data.direction === 'vertical' ? Position.Bottom : Position.Right;
  return (
    <EventFlowCard framed={selected || data.target} drawing={drawing} candidate={event.status === 'candidate'} style={CARD}>
      {/* Two dots, since a line has a before and an after: the top (left) one takes a line from the event
          before, the bottom (right) one draws to the event after. Dots only start lines: a drag ends on
          whichever card it is dropped on (EventFlow's onConnectEnd), never snapping to that card's dots. */}
      <Box asChild flowHandle={dot(isConnectable)}><Handle type="target" position={target} isConnectable={isConnectable} isConnectableEnd={false} title="끌어서 앞 사건과 잇기" /></Box>
      <Stack as="span" direction="row" align="baseline" gap="condensed">
        <Text variant="label" truncate>{event.title}</Text>
        <Text marginLeft="auto" shrink={false}>{data.badge}</Text>
      </Stack>
      <Text variant="caption" tone="muted" truncate>
        {event.at?.scene}
        {event.at?.scene && event.participants.length > 0 && ' — '}
        {event.participants.map((name, index) => (
          <span key={`${name}-${index}`}>
            {index > 0 && ' · '}
            <span style={personStyle(data.colorOf(name))}>{name}</span>
          </span>
        ))}
      </Text>
      {event.summary && <Text variant="caption" tone="muted" lines={2} marginTop="hair">{event.summary}</Text>}
      {data.elsewhere && <Text variant="caption" tone="muted" truncate marginTop="auto">→ {data.elsewhere}</Text>}
      <Box asChild flowHandle={dot(isConnectable)}><Handle type="source" position={source} isConnectable={isConnectable} isConnectableEnd={false} title="끌어서 다음 사건과 잇기" /></Box>
    </EventFlowCard>
  );
}

function SectionTitle({ data }: NodeProps<SectionNode>) {
  return <Text as="div" variant="reading" weight="semibold" nowrap>{data.title}</Text>;
}

const nodeTypes = { event: EventCard, section: SectionTitle };

/**
 * Events as a top-to-bottom flow, like the source graph, one block per section (the file's
 * chapter / act / day). A line joins two events when the dialogue graph leads from one to the other
 * (derived, never guessed; where an event leads several ways the flow splits sideways with the ways'
 * choice labels), or when a person drew one; a derived line someone deleted stays away. Events with
 * no line keep script order. It works like the other graphs: the same keys (lib/graph-shortcuts),
 * right-click menus, a toolbox over one picked event, the canvas toolbar (with 가로·세로). Dragged
 * positions stay in this browser until 자동 정렬; an edit keeps everyone where they are.
 */
export function EventFlow({ projectId, events, selected, onOpen, badge, filtered, direction = 'vertical', onDirectionChange, actions }: {
  projectId: string;
  events: FlowEvent[];
  /** Filters are set (so none matching is not the same as none yet). */
  filtered?: boolean;
  /** The page's open item: an event id, or a line's key (lineKey). */
  selected?: string;
  onOpen: (item?: string) => void;
  badge: (event: FlowEvent) => ReactNode;
  direction?: EventFlowDirection;
  onDirectionChange?: (direction: EventFlowDirection) => void;
  /** What it can change (the page's, each undoable); without it the flow only shows and selects. */
  actions?: EventFlowActions;
}) {
  const dark = useIsDark();
  const colorOf = usePersonColors(projectId);
  const placed = useMemo(() => events.filter((event) => event.at).sort((a, b) => a.at!.seq - b.at!.seq), [events]);
  const sections = useMemo(() => [...Map.groupBy(placed, (event) => event.at!.section ?? '').entries()], [placed]);
  const unplaced = useMemo(() => events.filter((event) => !event.at), [events]);
  const sectionOf = useMemo(() => new Map(events.map((event) => [event.id, event.at ? (event.at.section ?? '') : null])), [events]);
  const byId = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const titled = sections.length > 1 || sections.some(([section]) => section) || unplaced.length > 0;
  const layoutKey = `${direction}:${events.map((event) => `${event.id}>${event.next.map((step) => step.id).join(',')}`).join('|')}`;
  const selectedLine = parseLineKey(selected);
  const selectedEvent = selectedLine ? undefined : selected;

  // Dragged positions: a per-browser convenience, like the relationship graph.
  const storageKey = `tw.events.layout.${projectId}${direction === 'horizontal' ? '.horizontal' : ''}`;
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    } catch {
      return {};
    }
  });
  const movedRef = useRef(moved);
  movedRef.current = moved;
  const remember = (next: Record<string, { x: number; y: number }>) => {
    setMoved(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Without storage the positions last until reload.
    }
  };

  const [layout, setLayout] = useState<{ key: string; positions: Record<string, { x: number; y: number }>; titles: { id: string; title: string; x: number; y: number; ids: string[] }[] }>();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    let live = true;
    const blocks = [...sections.map(([section, list]) => ({ title: section || '구역 없음', list })), ...(unplaced.length ? [{ title: '위치 모름', list: unplaced }] : [])];
    void Promise.all(blocks.map((block) => layoutSection(block.list, direction))).then((results) => {
      if (!live) return;
      const positions: Record<string, { x: number; y: number }> = {};
      const titles: { id: string; title: string; x: number; y: number; ids: string[] }[] = [];
      let top = 0;
      results.forEach((result, i) => {
        const offset = titled ? 40 : 0;
        if (titled) titles.push({ id: `section:${i}`, title: blocks[i].title, x: 0, y: top, ids: blocks[i].list.map((event) => event.id) });
        for (const [id, at] of Object.entries(result.positions)) positions[id] = { x: at.x, y: top + offset + at.y };
        top += offset + result.height + SECTION_GAP;
      });
      setLayout({ key: layoutKey, positions, titles });
    });
    return () => {
      live = false;
    };
    // layoutKey describes the events, their links, and the requested direction.
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Events picked with a Shift+drag box or ⌘/Ctrl+click, as in the other graphs; a plain click opens one in the pane.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ kind: 'events'; ids: string[] } | { kind: 'line'; line: FlowLine } | { kind: 'pane'; at: { x: number; y: number } } | null>(null);
  const menuFor = menu?.kind === 'events' ? menu.ids : null;
  const selection = picked.size ? [...picked] : selectedEvent && byId.has(selectedEvent) ? [selectedEvent] : [];
  const [flow, setFlow] = useState<ReactFlowInstance<EventNode | SectionNode, Edge>>();
  const [zoom, setZoom] = useState(1);

  // An edit changes the events or lines, which would lay the flow out anew: first everyone is kept
  // where they are shown (as if dragged there), and the view does not refit. 자동 정렬 lays it out again.
  const editedRef = useRef(0);
  const edit = <A extends unknown[], R>(run: (...args: A) => R) => (...args: A) => {
    editedRef.current = Date.now();
    remember({ ...layoutRef.current?.positions, ...movedRef.current });
    return run(...args);
  };
  const edits = actions && { ...actions, remove: edit(actions.remove), connect: edit(actions.connect), addEvent: edit(actions.addEvent), duplicate: edit(actions.duplicate), undo: edit(actions.undo), redo: edit(actions.redo) };
  const removeSelection = () => {
    if (!edits) return;
    setPicked(new Set());
    void edits.remove({ eventIds: selection, lines: !selection.length && selectedLine ? [selectedLine] : [] });
    onOpen(undefined);
  };
  // Copies go beside their originals, picked.
  const paste = async (ids: string[]) => {
    if (!edits || !ids.length) return;
    const made = await edits.duplicate(ids);
    const at = (id: string) => movedRef.current[id] ?? layoutRef.current?.positions[id] ?? { x: 0, y: 0 };
    remember({ ...movedRef.current, ...Object.fromEntries([...made].map(([from, to]) => [to, { x: at(from).x + 60, y: at(from).y + 60 }])) });
    setPicked(new Set(made.values()));
    onOpen(undefined);
  };
  const clipboard = () => eventClipboard.filter((id) => byId.has(id));
  // The shared graph keys (lib/graph-shortcuts), the same as in the workflow editor and the relationship graph.
  useGraphShortcuts(
    {
      undo: () => void edits?.undo(),
      redo: () => void edits?.redo(),
      copy: () => void (selection.length && (eventClipboard = selection)),
      cut: () => {
        if (!selection.length) return;
        eventClipboard = selection;
        removeSelection();
      },
      paste: () => void paste(clipboard()),
      remove: () => (selection.length || selectedLine ? removeSelection() : undefined),
    },
    Boolean(actions),
  );

  const nodes = useMemo<(EventNode | SectionNode)[]>(() => {
    if (!layout) return [];
    return [
      // A section's title sits above its cards wherever they were moved (or kept by an edit).
      ...layout.titles.map((title): SectionNode => {
        const at = title.ids.map((id) => moved[id] ?? layout.positions[id]).filter(Boolean);
        const position = at.length ? { x: Math.min(...at.map((point) => point!.x)), y: Math.min(...at.map((point) => point!.y)) - 40 } : { x: title.x, y: title.y };
        return { id: title.id, type: 'section', position, data: { title: title.title }, draggable: false, selectable: false };
      }),
      ...events.map((event): EventNode => {
        // Derived lines to another section are named on the card (the flow is laid out per section); drawn ones are drawn.
        const elsewhere = event.next.filter((step) => step.source === 'graph' && event.at && sectionOf.get(step.id) !== sectionOf.get(event.id));
        return {
          id: event.id,
          type: 'event',
          position: moved[event.id] ?? layout.positions[event.id] ?? { x: 0, y: 0 },
          data: { event, badge: badge(event), colorOf, elsewhere: elsewhere.length ? elsewhere.map((step) => `${sectionOf.get(step.id) || '다른 구역'}: ${byId.get(step.id)?.title}`).join(', ') : null, direction, target: Boolean(menuFor?.includes(event.id)) },
          selected: picked.size ? picked.has(event.id) : event.id === selectedEvent,
          width: CARD.width,
          height: CARD.height,
        };
      }),
    ];
  }, [layout, events, moved, selectedEvent, sectionOf, byId, badge, direction, picked, menuFor, colorOf]);
  // Positions while dragging sit on top of the memoized nodes; the drop is kept in `moved`.
  const frame = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const flowNodes = useMemo(() => nodes.map((node) => (dragging[node.id] ? { ...node, position: dragging[node.id] } : node)), [nodes, dragging]);

  const edges = useMemo<Edge[]>(
    () =>
      events.flatMap((event) =>
        event.next
          .filter((step) => byId.has(step.id) && (step.source === 'added' || sectionOf.get(step.id) === sectionOf.get(event.id)))
          .map((step) => {
            const focus = selectedLine?.fromId === event.id && selectedLine.toId === step.id;
            const stroke = focus ? 'var(--primary)' : 'var(--graph-edge)';
            return {
              id: `${event.id}>${step.id}`,
              source: event.id,
              target: step.id,
              type: 'smoothstep',
              label: step.label ?? undefined,
              labelBgPadding: [4, 2] as [number, number],
              labelStyle: { fontSize: 12, fill: 'var(--muted-foreground)' },
              style: { stroke, strokeWidth: focus ? 2.5 : 1.5 },
              // A wide invisible band so a line is easy to click.
              interactionWidth: 16,
              markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
            };
          }),
      ),
    [events, sectionOf, byId, selectedLine?.fromId, selectedLine?.toId],
  );
  const lineOf = (edge: Edge): FlowLine => ({ fromId: edge.source, toId: edge.target });

  // A new layout (other events shown) refits the view by remounting it; one that follows an edit keeps the view.
  const viewKey = useRef(layout?.key);
  const seenKey = useRef(layout?.key);
  if (layout && layout.key !== seenKey.current) {
    seenKey.current = layout.key;
    // The data an edit changes can arrive in more than one refresh.
    if (Date.now() - editedRef.current > 5000 || !viewKey.current) viewKey.current = layout.key;
  }

  if (!events.length) return <EmptyState noun="사건" filtered={filtered} />;
  if (!layout) return <Inline height="full" justify="center" variant="body" tone="muted">배치 계산 중…</Inline>;
  const one = selection.length === 1 && !picked.size ? selection[0] : undefined;
  const menuLine = menu?.kind === 'line' ? menu.line : undefined;
  return (
    <ContextMenu onOpenChange={(open) => !open && setMenu(null)}>
    <ContextMenuTrigger asChild>
    <Box ref={frame} height="full">
    <ReactFlow colorMode={dark ? 'dark' : 'light'}
      key={viewKey.current}
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={(changes: NodeChange<EventNode | SectionNode>[]) => {
        const moving = changes.flatMap((change) => (change.type === 'position' && change.position ? [[change.id, change.position] as const] : []));
        if (moving.length) setDragging((current) => ({ ...current, ...Object.fromEntries(moving) }));
        const select = changes.filter((change) => change.type === 'select');
        if (!select.length) return;
        const next = new Set(selection);
        for (const change of select) {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
        setPicked(next);
        if (next.size && selectedEvent) onOpen(undefined);
      }}
      onNodeDragStop={(_event, _node, dragged) => {
        remember({ ...moved, ...Object.fromEntries(dragged.map((node) => [node.id, node.position])) });
        setDragging({});
      }}
      // A ⌘/Ctrl+click adds to the picked set (above); a plain click opens the event.
      onNodeClick={(event, node) => {
        if (node.type !== 'event' || event.metaKey || event.ctrlKey) return;
        setPicked(new Set());
        onOpen(node.id);
      }}
      // A plain click on a line opens it (where it comes from, 삭제), as in the other graphs.
      onEdgeClick={(_event, edge) => {
        setPicked(new Set());
        onOpen(lineKey(lineOf(edge)));
      }}
      onPaneClick={() => {
        setPicked(new Set());
        if (selected) onOpen(undefined);
      }}
      onNodeContextMenu={(_event, node) => node.type === 'event' && setMenu({ kind: 'events', ids: picked.has(node.id) ? [...picked] : [node.id] })}
      onEdgeContextMenu={(_event, edge) => setMenu({ kind: 'line', line: lineOf(edge) })}
      onPaneContextMenu={(event) => flow && setMenu({ kind: 'pane', at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) })}
      // Start at the top of the flow (the first events) at a readable zoom; fit it all only when it is small.
      onInit={(instance) => {
        setFlow(instance);
        const bounds = instance.getNodesBounds(instance.getNodes());
        const width = frame.current?.clientWidth ?? 800, height = frame.current?.clientHeight ?? 600;
        const fit = Math.min(1, (width - 48) / bounds.width, (height - 48) / bounds.height);
        if (fit >= 0.7) void instance.fitView({ padding: 0.1, maxZoom: 1 });
        else void instance.setViewport({ x: Math.max(24, (width - bounds.width * 0.8) / 2) - bounds.x * 0.8, y: 56 - bounds.y * 0.8, zoom: 0.8 });
        setZoom(instance.getZoom());
      }}
      onMove={(_event, viewport) => setZoom(viewport.zoom)}
      minZoom={0.1}
      // Drawing from an event's dot to another event makes a line (the page opens it).
      nodesConnectable={Boolean(actions)}
      // No snapping: the dots only start lines, and a drag ends on the card under the pointer.
      connectionRadius={0}
      connectOnClick={false}
      onConnectEnd={(event, state) => {
        if (!edits || !state.fromNode) return;
        const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
        // The card under the pointer, or else the nearest one within a short reach (a drop just beside a card).
        const reach = 40 / (flow?.getZoom() ?? 1);
        const at = flow?.screenToFlowPosition({ x: point.clientX, y: point.clientY });
        const nearest = () => {
          if (!at) return undefined;
          const gap = (node: Node) => Math.hypot(Math.max(node.position.x - at.x, 0, at.x - node.position.x - CARD.width), Math.max(node.position.y - at.y, 0, at.y - node.position.y - CARD.height));
          const near = flowNodes.filter((node) => node.type === 'event' && node.id !== state.fromNode!.id && gap(node) <= reach).sort((a, b) => gap(a) - gap(b));
          return near[0]?.id;
        };
        const hit = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node')?.getAttribute('data-id');
        const id = hit && byId.has(hit) ? hit : nearest();
        if (!id || id === state.fromNode.id || !byId.has(id)) return;
        // From the bottom (right) dot the line goes out to the card; from the top (left) one it comes in from it.
        const out = state.fromHandle?.type === 'source';
        void edits.connect(out ? state.fromNode.id : id, out ? id : state.fromNode.id);
      }}
      // Same as the other graphs: left or middle drag pans, Shift+drag draws a selection box, ⌘/Ctrl+click adds an event.
      panOnDrag={[0, 1]}
      selectionKeyCode="Shift"
      multiSelectionKeyCode={['Meta', 'Control']}
      selectionMode={SelectionMode.Partial}
      // Delete goes through the shared graph keys, undoable.
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Panel position="bottom-right">
        <CanvasToolbar
          zoomPercent={zoom * 100}
          onZoomIn={() => void flow?.zoomIn()}
          onZoomOut={() => void flow?.zoomOut()}
          onFit={() => void flow?.fitView({ padding: 0.1, duration: 200 })}
          onResetZoom={() => void flow?.zoomTo(1, { duration: 180 })}
          // Positions events were dragged to are dropped: the computed layout again.
          onLayout={() => remember({})}
          layoutLabel="자동 정렬"
          direction={direction}
          onDirectionChange={onDirectionChange}
        />
      </Panel>
      {edits && one && (
        <NodeToolbar nodeId={one} isVisible position={Position.Top} offset={12}>
          <SelectionToolbox actions={[
            { id: 'copy', label: '복제', icon: <Copy />, onSelect: () => void paste([one]) },
            { id: 'delete', label: '삭제', icon: <Trash2 />, onSelect: removeSelection },
          ]} />
        </NodeToolbar>
      )}
    </ReactFlow>
    </Box>
    </ContextMenuTrigger>
    {menu && (
      <ContextMenuContent>
        {menu.kind === 'events' && (
          <>
            {menu.ids.length === 1 && <ContextMenuItem onClick={() => onOpen(menu.ids[0])}>상세 열기</ContextMenuItem>}
            {edits && (
              <>
                <ContextMenuItem onClick={() => void paste(menu.ids)}>복제</ContextMenuItem>
                <ContextMenuItem onClick={() => (eventClipboard = menu.ids)}>
                  복사
                  <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.copy)}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => {
                  setPicked(new Set());
                  void edits.remove({ eventIds: menu.ids, lines: [] });
                }}>
                  {menu.ids.length > 1 ? `삭제 (${menu.ids.length}개)` : '삭제'}
                  <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</ContextMenuShortcut>
                </ContextMenuItem>
              </>
            )}
          </>
        )}
        {menuLine && (
          <>
            <ContextMenuItem onClick={() => onOpen(lineKey(menuLine))}>상세 열기</ContextMenuItem>
            {edits && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => void edits.remove({ eventIds: [], lines: [menuLine] })}>
                  삭제
                  <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</ContextMenuShortcut>
                </ContextMenuItem>
              </>
            )}
          </>
        )}
        {menu.kind === 'pane' && (
          <>
            {edits && (
              <ContextMenuItem onClick={() => {
                const at = menu.at;
                void edits.addEvent().then((id) => id && remember({ ...movedRef.current, [id]: at }));
              }}>사건 추가</ContextMenuItem>
            )}
            {edits && clipboard().length > 0 && (
              <ContextMenuItem onClick={() => void paste(clipboard())}>
                붙여넣기
                <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.paste)}</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => remember({})}>자동 정렬</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    )}
    </ContextMenu>
  );
}
