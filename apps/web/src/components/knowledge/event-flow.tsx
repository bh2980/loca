import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Handle, MarkerType, useConnection, Position, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { AiMark, EmptyState, EventFlowCard, Inline, Stack, Text, FlowHandle } from '@loca/ui';
import { personStyle, usePersonColors } from '@/lib/person-colors';
import { EVENT_CARD as CARD, layoutSection, type EventFlowDirection } from './event-flow-layout.ts';
import { EditableFlow, type EditableFlowActions } from './editable-flow';
import { lineKey, parseLineKey, type FlowLine } from './event-actions';
import { STORED, useStored } from '@/lib/storage';

/** Space between one section's flow and the next, and for its title. */
const SECTION_GAP = 96;

export interface FlowEvent {
  id: string;
  title: string;
  summary: string;
  participants: string[];
  status: string;
  /** Who confirmed it: ✦ before the title while AI did and no person has looked. */
  statusBy?: 'ai' | 'human' | null;
  at: { seq: number; section: string | null; scene: string; key: string } | null;
  /** Events this one leads to: derived from the dialogue graph (with the choice/condition way when it splits), or drawn by hand. */
  next: ({ id: string; label: string | null; source: 'graph' } | { id: string; label: null; source: 'added'; origin: string })[];
}

type EventNode = Node<{ event: FlowEvent; elsewhere: string | null; direction: EventFlowDirection; target: boolean; colorOf: (name: string) => string | undefined }, 'event'>;
type SectionNode = Node<{ title: string }, 'section'>;

/** A connecting dot as in the other graphs (with a wider grab area); none where the flow only shows. */
const dot = (connectable: boolean): 'event' | 'event-idle' => (connectable ? 'event' : 'event-idle')

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
      <FlowHandle look={dot(isConnectable)}><Handle type="target" position={target} isConnectable={isConnectable} isConnectableEnd={false} title="끌어서 앞 사건과 잇기" /></FlowHandle>
      <Stack as="span" direction="row" align="baseline" gap="condensed">
        <Text variant="label" lines={2}>{event.status !== 'candidate' && event.statusBy === 'ai' && <><AiMark by="ai" />{' '}</>}{event.title}</Text>
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
      {event.summary && <Text variant="caption" tone="muted" lines={1} marginTop="hair">{event.summary}</Text>}
      {data.elsewhere && <Text variant="caption" tone="muted" truncate marginTop="auto">→ {data.elsewhere}</Text>}
      <FlowHandle look={dot(isConnectable)}><Handle type="source" position={source} isConnectable={isConnectable} isConnectableEnd={false} title="끌어서 다음 사건과 잇기" /></FlowHandle>
    </EventFlowCard>
  );
}

function SectionTitle({ data }: NodeProps<SectionNode>) {
  return <Text as="div" variant="reading" weight="semibold" nowrap>{data.title}</Text>;
}

const nodeTypes = { event: EventCard, section: SectionTitle };

/** Start at the top of the flow (the first events) at a readable zoom; fit it all only when it is small. */
function openAtStart(flow: ReactFlowInstance<EventNode | SectionNode, Edge>, frame: HTMLElement | null) {
  const bounds = flow.getNodesBounds(flow.getNodes());
  const width = frame?.clientWidth ?? 800, height = frame?.clientHeight ?? 600;
  const fit = Math.min(1, (width - 48) / bounds.width, (height - 48) / bounds.height);
  if (fit >= 0.7) void flow.fitView({ padding: 0.1, maxZoom: 1 });
  else void flow.setViewport({ x: Math.max(24, (width - bounds.width * 0.8) / 2) - bounds.x * 0.8, y: 56 - bounds.y * 0.8, zoom: 0.8 });
}

/**
 * Events as a top-to-bottom flow, like the source graph, one block per section (the file's
 * chapter / act / day). A line joins two events when the dialogue graph leads from one to the other
 * (derived, never guessed; where an event leads several ways the flow splits sideways with the ways'
 * choice labels), or when a person drew one; a derived line someone deleted stays away. Events with
 * no line keep script order. Picking, the keys, menus, copy and paste, the toolbox and the remembered view are
 * EditableFlow's, shared with the relationship graph; this file holds the cards and lines, their layout per
 * section, and where a drawn line lands. Dragged positions stay in this browser until 자동 정렬.
 */
export function EventFlow({ projectId, events, selected, onOpen, filtered, direction = 'vertical', onDirectionChange, actions, emptyAction }: {
  projectId: string;
  events: FlowEvent[];
  /** Filters are set (so none matching is not the same as none yet). */
  filtered?: boolean;
  /** The page's open item: an event id, or a line's key (lineKey). */
  selected?: string;
  onOpen: (item?: string) => void;
  direction?: EventFlowDirection;
  onDirectionChange?: (direction: EventFlowDirection) => void;
  /** What it can change (the page's, each undoable); without it the flow only shows and selects. */
  actions?: EditableFlowActions<FlowLine>;
  /** With no events yet: the way to get some (add one, run an extraction). */
  emptyAction?: ReactNode;
}) {
  const colorOf = usePersonColors(projectId);
  const placed = useMemo(() => events.filter((event) => event.at).sort((a, b) => a.at!.seq - b.at!.seq), [events]);
  const sections = useMemo(() => [...Map.groupBy(placed, (event) => event.at!.section ?? '').entries()], [placed]);
  const unplaced = useMemo(() => events.filter((event) => !event.at), [events]);
  const sectionOf = useMemo(() => new Map(events.map((event) => [event.id, event.at ? (event.at.section ?? '') : null])), [events]);
  const byId = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const eventIds = useMemo(() => new Set(byId.keys()), [byId]);
  const titled = sections.length > 1 || sections.some(([section]) => section) || unplaced.length > 0;
  const layoutKey = `${direction}:${events.map((event) => `${event.id}>${event.next.map((step) => step.id).join(',')}`).join('|')}`;
  const selectedLine = parseLineKey(selected);
  const selectedEvent = selectedLine ? undefined : selected;

  // Dragged positions: a per-browser convenience, like the relationship graph.
  const [moved, remember] = useStored(STORED.eventFlowPositions, projectId, direction);

  const [layout, setLayout] = useState<{ key: string; positions: Record<string, { x: number; y: number }>; titles: { id: string; title: string; x: number; y: number; ids: string[] }[] }>();
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
          data: { event, colorOf, elsewhere: elsewhere.length ? elsewhere.map((step) => `${sectionOf.get(step.id) || '다른 구역'}: ${byId.get(step.id)?.title}`).join(', ') : null, direction, target: false },
          width: CARD.width,
          height: CARD.height,
        };
      }),
    ];
  }, [layout, events, moved, sectionOf, byId, direction, colorOf]);

  const edges = useMemo<Edge[]>(
    () =>
      events.flatMap((event) =>
        event.next
          .filter((step) => byId.has(step.id) && (step.source === 'added' || sectionOf.get(step.id) === sectionOf.get(event.id)))
          .map((step) => {
            const focus = selectedLine?.fromId === event.id && selectedLine.toId === step.id;
            const stroke = focus ? 'var(--stroke-accent)' : 'var(--stroke-graph-edge)';
            return {
              id: `${event.id}>${step.id}`,
              source: event.id,
              target: step.id,
              type: 'smoothstep',
              label: step.label ?? undefined,
              labelBgPadding: [4, 2] as [number, number],
              labelStyle: { fontSize: 12, fill: 'var(--fill-muted)' },
              style: { stroke, strokeWidth: focus ? 2.5 : 1.5 },
              // A wide invisible band so a line is easy to click.
              interactionWidth: 16,
              markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
            };
          }),
      ),
    [events, sectionOf, byId, selectedLine?.fromId, selectedLine?.toId],
  );
  if (!events.length) return <EmptyState noun="사건" filtered={filtered} hint="대본에서 사건을 뽑아 오거나 직접 추가합니다." action={emptyAction} />;
  if (!layout) return <Inline height="full" justify="center" variant="body" tone="muted">배치 계산 중…</Inline>;
  return (
    <EditableFlow<EventNode | SectionNode, Edge, FlowLine>
      projectId={projectId}
      graph="events"
      scope={direction}
      clipboard="events"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      itemIds={eventIds}
      layoutKey={layout.key}
      computed={layout.positions}
      placed={moved}
      place={remember}
      openId={selectedEvent}
      openLine={selectedLine ?? undefined}
      onOpen={onOpen}
      onOpenLine={(line) => onOpen(lineKey(line))}
      onClear={() => onOpen(undefined)}
      lineOf={(edge) => ({ fromId: edge.source, toId: edge.target })}
      actions={actions}
      labels={{ add: '사건 추가', count: (n) => `${n}개` }}
      // Beside the card, on the side no line comes in from: over it, it hid the 장 title above the first event.
      toolbox={{ position: direction === 'vertical' ? Position.Right : Position.Bottom, align: 'start', offset: 8 }}
      fitPadding={0.1}
      openView={openAtStart}
      direction={direction}
      onDirectionChange={onDirectionChange}
      // No snapping: the dots only start lines, and a drag ends on the card under the pointer.
      connectionRadius={0}
      onConnectEnd={(event, state, { flow, nodes: drawn, connect }) => {
        if (!state.fromNode) return;
        const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
        // The card under the pointer, or else the nearest one within a short reach (a drop just beside a card).
        const reach = 40 / (flow?.getZoom() ?? 1);
        const at = flow?.screenToFlowPosition({ x: point.clientX, y: point.clientY });
        const nearest = () => {
          if (!at) return undefined;
          const gap = (node: Node) => Math.hypot(Math.max(node.position.x - at.x, 0, at.x - node.position.x - CARD.width), Math.max(node.position.y - at.y, 0, at.y - node.position.y - CARD.height));
          const near = drawn.filter((node) => node.type === 'event' && node.id !== state.fromNode!.id && gap(node) <= reach).sort((a, b) => gap(a) - gap(b));
          return near[0]?.id;
        };
        const hit = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node')?.getAttribute('data-id');
        const id = hit && byId.has(hit) ? hit : nearest();
        if (!id || id === state.fromNode.id || !byId.has(id)) return;
        // From the bottom (right) dot the line goes out to the card; from the top (left) one it comes in from it.
        const out = state.fromHandle?.type === 'source';
        connect(out ? state.fromNode.id : id, out ? id : state.fromNode.id);
      }}
    />
  );
}
