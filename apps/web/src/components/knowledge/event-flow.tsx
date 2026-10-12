import { useEffect, useMemo, useState } from 'react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { cn } from '@/lib/utils';

const elk = new ELK();
const CARD = { width: 288, height: 92 };

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

interface Layout {
  width: number;
  height: number;
  cards: { id: string; x: number; y: number }[];
  edges: { id: string; points: { x: number; y: number }[]; label?: { text: string; x: number; y: number } }[];
}

/**
 * Events as a top-to-bottom flow, one block per section (the file's chapter / act / day). A line
 * joins two events only when the dialogue graph leads from one to the other (derived, never
 * guessed); where an event leads several ways the flow splits sideways and the ways carry their
 * choice labels, then joins again where the routes meet — nested splits included. Events with no
 * such link keep script order without a line. Events whose evidence is not in the script go last.
 */
export function EventFlow({ events, selected, onOpen, badge }: { events: FlowEvent[]; selected?: string; onOpen: (id: string) => void; badge: (event: FlowEvent) => React.ReactNode }) {
  const placed = useMemo(() => events.filter((event) => event.at).sort((a, b) => a.at!.seq - b.at!.seq), [events]);
  const sections = useMemo(() => [...Map.groupBy(placed, (event) => event.at!.section ?? '').entries()], [placed]);
  const unplaced = events.filter((event) => !event.at);
  const sectionOf = useMemo(() => new Map(placed.map((event) => [event.id, event.at!.section ?? ''])), [placed]);
  const byId = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const titled = sections.length > 1 || sections.some(([section]) => section);

  if (!events.length) return <p className="px-6 py-12 text-center text-sm text-muted-foreground">사건이 없습니다. “작품 분석”으로 초안을 받거나 표에서 추가하세요.</p>;
  const card = (event: FlowEvent) => {
    const elsewhere = event.next.filter((step) => sectionOf.get(step.id) !== sectionOf.get(event.id));
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(event.id)}
        onKeyDown={(key) => (key.key === 'Enter' || key.key === ' ') && (key.preventDefault(), onOpen(event.id))}
        className={cn('flex h-full cursor-pointer flex-col rounded-md border bg-background px-3 py-2 text-left hover:bg-muted/40', event.id === selected && 'border-primary ring-1 ring-primary/30', event.status === 'candidate' && 'border-dashed')}
      >
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{event.title}</span>
          <span className="ml-auto shrink-0">{badge(event)}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{[event.at?.scene, event.participants.join(' · ')].filter(Boolean).join(' — ')}</span>
        {event.summary && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{event.summary}</span>}
        {elsewhere.length > 0 && <span className="mt-auto truncate text-xs text-muted-foreground">→ {elsewhere.map((step) => `${sectionOf.get(step.id) || '다른 구역'}: ${byId.get(step.id)?.title}`).join(', ')}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-8 px-6 py-4">
      <p className="text-xs text-muted-foreground">선은 대사 그래프에서 이어지는 사건 사이에만 그립니다. 선이 없는 사건은 대본 순서로 놓았습니다.</p>
      {sections.map(([section, list]) => (
        <section key={section}>
          {titled && <h3 className="mb-3 text-sm font-semibold">{section || '구역 없음'}</h3>}
          <SectionFlow events={list} card={card} />
        </section>
      ))}
      {unplaced.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">
            위치 모름 <span className="font-normal text-muted-foreground">근거 대사가 대본에 없음</span>
          </h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD.width}px, 1fr))` }}>
            {unplaced.map((event) => (
              <div key={event.id} style={{ height: CARD.height }}>
                {card(event)}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** One section laid out by ELK, top to bottom. Script order between unlinked events is kept with layout-only links that are never drawn. */
function SectionFlow({ events, card }: { events: FlowEvent[]; card: (event: FlowEvent) => React.ReactNode }) {
  const [layout, setLayout] = useState<Layout>();
  const key = events.map((event) => `${event.id}>${event.next.map((step) => step.id).join(',')}`).join('|');
  useEffect(() => {
    let live = true;
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
        'elk.spacing.nodeNode': '24',
        'elk.layered.spacing.nodeNodeBetweenLayers': '36',
        'elk.edgeLabels.placement': 'CENTER',
      },
      children: events.map((event) => ({ id: event.id, ...CARD })),
      edges: [
        ...real.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to], labels: edge.label ? [{ text: edge.label, width: Math.min(160, edge.label.length * 12 + 12), height: 18 }] : [] })),
        ...order.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
      ],
    };
    void elk.layout(graph).then((result) => {
      if (!live) return;
      setLayout({
        width: result.width ?? 0,
        height: result.height ?? 0,
        cards: (result.children ?? []).map((child) => ({ id: child.id, x: child.x ?? 0, y: child.y ?? 0 })),
        edges: (result.edges ?? [])
          .filter((edge) => !edge.id.startsWith('order:'))
          .map((edge) => {
            const section = edge.sections?.[0];
            const label = edge.labels?.[0];
            return {
              id: edge.id,
              points: section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : [],
              label: label?.text ? { text: label.text, x: label.x ?? 0, y: label.y ?? 0 } : undefined,
            };
          }),
      });
    });
    return () => {
      live = false;
    };
    // The layout depends only on which events there are and how they link.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layout) return <div className="h-24 animate-pulse rounded-md bg-muted/40" />;
  const byId = new Map(events.map((event) => [event.id, event]));
  return (
    <div className="overflow-x-auto">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden>
          <defs>
            <marker id="event-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--graph-edge)" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <polyline key={edge.id} points={edge.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="var(--graph-edge)" strokeWidth={1.5} markerEnd="url(#event-arrow)" />
          ))}
        </svg>
        {layout.edges.map(
          (edge) =>
            edge.label && (
              <span key={`${edge.id}:label`} className="absolute max-w-40 truncate rounded bg-background px-1 text-xs text-muted-foreground" style={{ left: edge.label.x, top: edge.label.y }} title={edge.label.text}>
                {edge.label.text}
              </span>
            ),
        )}
        {layout.cards.map((position) => {
          const event = byId.get(position.id);
          return event ? (
            <div key={position.id} className="absolute" style={{ left: position.x, top: position.y, width: CARD.width, height: CARD.height }}>
              {card(event)}
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}
