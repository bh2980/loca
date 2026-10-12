import { useEffect, useMemo, useState } from 'react';
import { BaseEdge, Background, Controls, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, ReactFlow, useInternalNode, type Edge, type EdgeProps, type InternalNode, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import ELK from 'elkjs/lib/elk.bundled.js';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';

export interface GraphCharacter {
  id: string;
  name: string;
}
export interface GraphRelationship {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  mutual: boolean;
  /** Drawn dashed: a candidate not yet used as context. */
  dashed?: boolean;
}

const NODE_WIDTH = 150;
const NODE_HEIGHT = 44;
const elk = new ELK();

type PersonNode = Node<{ label: string; dim: boolean }, 'person'>;
/** A line's label: one row per relationship it stands for (two when the pair goes both ways). */
type LabelRow = { id: string; text: string; selected: boolean };
type RelationEdge = Edge<{ offset: number; rows: LabelRow[]; dim: boolean; focus: boolean; dashed?: boolean; showLabel: boolean; onPick: (id: string) => void }, 'relation'>;

function PersonNodeView({ data, selected }: NodeProps<PersonNode>) {
  return (
    <div
      className={cn('flex items-center justify-center rounded-lg border bg-background px-3 text-sm font-medium shadow-xs transition-opacity', selected && 'border-primary ring-2 ring-primary/30', data.dim && 'opacity-30')}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <span className="truncate">{data.label}</span>
      {/* Edges are floating (they attach to the node border), these handles only satisfy React Flow. */}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

/** Point where the line from this node's center toward `other` leaves the node's rectangle. */
function borderPoint(node: InternalNode, other: InternalNode) {
  const width = node.measured.width ?? NODE_WIDTH;
  const height = node.measured.height ?? NODE_HEIGHT;
  const center = { x: node.internals.positionAbsolute.x + width / 2, y: node.internals.positionAbsolute.y + height / 2 };
  const otherCenter = { x: other.internals.positionAbsolute.x + (other.measured.width ?? NODE_WIDTH) / 2, y: other.internals.positionAbsolute.y + (other.measured.height ?? NODE_HEIGHT) / 2 };
  const dx = otherCenter.x - center.x || 0.0001;
  const dy = otherCenter.y - center.y || 0.0001;
  const scale = Math.min(width / 2 / Math.abs(dx), height / 2 / Math.abs(dy));
  return { x: center.x + dx * scale, y: center.y + dy * scale, center, otherCenter };
}

function FloatingEdge({ id, source, target, markerStart, markerEnd, data, selected }: EdgeProps<RelationEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const from = borderPoint(sourceNode, targetNode);
  const to = borderPoint(targetNode, sourceNode);
  // Parallel relationships between the same pair are bent apart so each stays clickable.
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const offset = data?.offset ?? 0;
  const control = { x: (from.x + to.x) / 2 - ((to.y - from.y) / length) * offset, y: (from.y + to.y) / 2 + ((to.x - from.x) / length) * offset };
  const path = `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
  const label = { x: 0.25 * from.x + 0.5 * control.x + 0.25 * to.x, y: 0.25 * from.y + 0.5 * control.y + 0.25 * to.y };
  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={20} style={{ stroke: selected || data?.focus ? 'var(--color-primary)' : '#a1a1aa', strokeWidth: selected ? 2.5 : data?.focus ? 2 : 1.5, opacity: data?.dim ? 0.2 : 1, strokeDasharray: data?.dashed ? '5 4' : undefined }} />
      {/* Labels of every relationship at once pile up; they show for the selected or hovered person, or on the selected line. */}
      {(selected || data?.showLabel) && (
        <EdgeLabelRenderer>
          <div
            data-relation-label
            className={cn('nodrag nopan absolute flex flex-col rounded border bg-background text-xs shadow-xs', (selected || data?.focus) && 'border-primary', data?.dim && 'opacity-30')}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: 'all' }}
          >
            {data?.rows.map((row) => (
              <Button key={row.id} variant="ghost" size="inline" className={cn('justify-start rounded-none font-normal whitespace-nowrap', row.selected ? 'font-medium text-primary' : (selected || data.focus) && 'text-primary')} onClick={(event) => {
                  // The line under the label would otherwise take the click and pick the first relationship.
                  event.stopPropagation();
                  data.onPick(row.id);
                }}>
                {row.text}
              </Button>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { person: PersonNodeView };
const edgeTypes = { relation: FloatingEdge };

/**
 * Characters as nodes, stored relationships as edges. People form a network rather than a
 * narrative, so ELK's stress layout is used instead of a layered (directional) one. People can be
 * dragged; where a person was put is remembered in this browser (`storageKey`) over the layout.
 */
export function RelationshipGraph({ storageKey, characters, relationships, selectedCharacterId, selectedRelationshipId, onSelectCharacter, onSelectRelationship, onClear }: {
  storageKey: string;
  characters: GraphCharacter[];
  relationships: GraphRelationship[];
  selectedCharacterId?: string;
  selectedRelationshipId?: string;
  onSelectCharacter: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onClear: () => void;
}) {
  const [positions, setPositions] = useState<{ key: string; byId: Record<string, { x: number; y: number }> } | null>(null);
  const known = useMemo(() => new Set(characters.map((character) => character.id)), [characters]);
  const drawable = useMemo(() => relationships.filter((relationship) => known.has(relationship.fromId) && known.has(relationship.toId)), [relationships, known]);
  const [placed, setPlaced] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, { x: number; y: number }>;
    } catch {
      return {};
    }
  });
  const place = (next: Record<string, { x: number; y: number }>) => {
    setPlaced(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Positions are a convenience; without storage they last until reload.
    }
  };
  const [hovered, setHovered] = useState<string | null>(null);
  const layoutKey = useMemo(() => JSON.stringify([characters.map((c) => c.id), drawable.map((r) => [r.fromId, r.toId])]), [characters, drawable]);

  useEffect(() => {
    let cancelled = false;
    void elk
      .layout({
        id: 'root',
        layoutOptions: { 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': '340', 'elk.spacing.nodeNode': '120' },
        children: characters.map((character) => ({ id: character.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
        edges: drawable.map((relationship) => ({ id: relationship.id, sources: [relationship.fromId], targets: [relationship.toId] })),
      })
      .then((result) => {
        if (cancelled) return;
        setPositions({ key: layoutKey, byId: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])) });
      });
    return () => {
      cancelled = true;
    };
    // layoutKey fully describes the inputs that change the layout.
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Emphasis: the selected character (or both ends of the selected relationship) stays full strength.
  const emphasis = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const selectedRelationship = drawable.find((relationship) => relationship.id === selectedRelationshipId);
    if (selectedRelationship) {
      nodeIds.add(selectedRelationship.fromId).add(selectedRelationship.toId);
      edgeIds.add(selectedRelationship.id);
    } else if (selectedCharacterId) {
      nodeIds.add(selectedCharacterId);
      for (const relationship of drawable) {
        if (relationship.fromId !== selectedCharacterId && relationship.toId !== selectedCharacterId) continue;
        edgeIds.add(relationship.id);
        nodeIds.add(relationship.fromId).add(relationship.toId);
      }
    }
    const labelled = new Set(edgeIds);
    if (hovered) for (const relationship of drawable) if (relationship.fromId === hovered || relationship.toId === hovered) labelled.add(relationship.id);
    return { active: nodeIds.size > 0, nodeIds, edgeIds, labelled };
  }, [drawable, selectedCharacterId, selectedRelationshipId, hovered]);

  const nodes = useMemo<PersonNode[]>(
    () =>
      characters.map((character) => ({
        id: character.id,
        type: 'person',
        position: placed[character.id] ?? positions?.byId[character.id] ?? { x: 0, y: 0 },
        data: { label: character.name, dim: emphasis.active && !emphasis.nodeIds.has(character.id) },
        selected: character.id === selectedCharacterId,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
    [characters, positions, placed, selectedCharacterId, emphasis],
  );
  // Where nodes are while being dragged, on top of the memoized nodes: emphasis or selection changing
  // mid-drag must not put a node back where it was. The drop is kept in `placed`.
  const [moving, setMoving] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState(false);
  const flowNodes = useMemo(() => nodes.map((node) => (moving[node.id] ? { ...node, position: moving[node.id] } : node)), [nodes, moving]);
  const edges = useMemo<RelationEdge[]>(() => {
    const marker = { type: MarkerType.ArrowClosed, color: '#71717a' };
    const result: RelationEdge[] = [];
    for (const list of Map.groupBy(drawable, (relationship) => [relationship.fromId, relationship.toId].sort().join('|')).values()) {
      // One relationship each way: one line, arrows at both ends, both names in its label.
      const [first, second] = list;
      const pairs = list.length === 2 && first.fromId === second.toId && first.toId === second.fromId ? [[first, second]] : list.map((relationship) => [relationship]);
      pairs.forEach((members, index) => {
        const [head] = members;
        const ids = members.map((relationship) => relationship.id);
        const offset = index === 0 ? 0 : (index % 2 ? 1 : -1) * Math.ceil(index / 2) * 40;
        result.push({
          id: ids.join('+'),
          type: 'relation',
          source: head.fromId,
          target: head.toId,
          data: {
            offset,
            rows: members.map((relationship, at) => ({ id: relationship.id, text: members.length > 1 ? `${at === 0 ? '→' : '←'} ${relationship.kind}` : relationship.kind, selected: relationship.id === selectedRelationshipId })),
            dashed: members.every((relationship) => relationship.dashed),
            dim: emphasis.active && !ids.some((id) => emphasis.edgeIds.has(id)),
            focus: ids.some((id) => emphasis.edgeIds.has(id)),
            showLabel: ids.some((id) => emphasis.labelled.has(id)),
            onPick: onSelectRelationship,
          },
          markerEnd: marker,
          markerStart: members.length > 1 || head.mutual ? marker : undefined,
          selected: ids.some((id) => id === selectedRelationshipId),
        });
      });
    }
    return result;
  }, [drawable, selectedRelationshipId, emphasis, onSelectRelationship]);

  if (!positions) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">배치 계산 중…</div>;
  return (
    <ReactFlow
      key={positions.key}
      nodes={flowNodes}
      edges={edges}
      onNodesChange={(changes: NodeChange<PersonNode>[]) => {
        const moved = changes.flatMap((change) => (change.type === 'position' && change.position ? [[change.id, change.position] as const] : []));
        if (moved.length) setMoving((current) => ({ ...current, ...Object.fromEntries(moved) }));
      }}
      onNodeDragStart={() => setDragging(true)}
      onNodeDragStop={(_event, _node, dragged) => {
        place({ ...placed, ...Object.fromEntries(dragged.map((node) => [node.id, node.position])) });
        setMoving({});
        setDragging(false);
      }}
      onNodeMouseEnter={(_event, node) => !dragging && setHovered(node.id)}
      onNodeMouseLeave={() => !dragging && setHovered(null)}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_event, node) => onSelectCharacter(node.id)}
      onEdgeClick={(_event, edge) => onSelectRelationship(edge.id.split('+')[0])}
      // A click on a relationship label also reaches the pane; it picks that relationship, not nothing.
      onPaneClick={(event) => !(event.target as HTMLElement).closest('[data-relation-label]') && onClear()}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
      {Object.keys(placed).length > 0 && (
        <Panel position="top-right">
          <Button variant="outline" className="bg-background" onClick={() => place({})}>
            배치 되돌리기
          </Button>
        </Panel>
      )}
    </ReactFlow>
  );
}
