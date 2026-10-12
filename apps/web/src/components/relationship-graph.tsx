import { useEffect, useMemo, useState } from 'react';
import { applyNodeChanges, BaseEdge, Background, Controls, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, ReactFlow, useInternalNode, type Edge, type EdgeProps, type InternalNode, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
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
type RelationEdge = Edge<{ offset: number; kind: string; dim: boolean; focus: boolean; dashed?: boolean; showLabel: boolean }, 'relation'>;

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
            className={cn('nodrag nopan pointer-events-none absolute rounded border bg-background px-1.5 py-0.5 text-[11px]', (selected || data?.focus) && 'border-primary text-primary', data?.dim && 'opacity-30')}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)` }}
          >
            {data?.kind}
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
  // React Flow moves a dragged node through these changes; the drop is kept in `placed`.
  const [flowNodes, setFlowNodes] = useState(nodes);
  useEffect(() => setFlowNodes(nodes), [nodes]);
  const edges = useMemo<RelationEdge[]>(() => {
    const seen = new Map<string, number>();
    return drawable.map((relationship) => {
      const pair = [relationship.fromId, relationship.toId].sort().join('|');
      const index = seen.get(pair) ?? 0;
      seen.set(pair, index + 1);
      // Alternate sides so reversed duplicates do not overlap: 0, +40, -40, +80…
      const offset = index === 0 ? 0 : (index % 2 ? 1 : -1) * Math.ceil(index / 2) * 40;
      const marker = { type: MarkerType.ArrowClosed, color: '#71717a' };
      return {
        id: relationship.id,
        type: 'relation',
        source: relationship.fromId,
        target: relationship.toId,
        data: { offset, kind: relationship.kind, dashed: relationship.dashed, dim: emphasis.active && !emphasis.edgeIds.has(relationship.id), focus: emphasis.edgeIds.has(relationship.id), showLabel: emphasis.labelled.has(relationship.id) },
        markerEnd: marker,
        markerStart: relationship.mutual ? marker : undefined,
        selected: relationship.id === selectedRelationshipId,
      };
    });
  }, [drawable, selectedRelationshipId, emphasis]);

  if (!positions) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">배치 계산 중…</div>;
  return (
    <ReactFlow
      key={positions.key}
      nodes={flowNodes}
      edges={edges}
      onNodesChange={(changes: NodeChange<PersonNode>[]) => setFlowNodes((current) => applyNodeChanges(changes, current))}
      onNodeDragStop={(_event, _node, dragged) => place({ ...placed, ...Object.fromEntries(dragged.map((node) => [node.id, node.position])) })}
      onNodeMouseEnter={(_event, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(null)}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_event, node) => onSelectCharacter(node.id)}
      onEdgeClick={(_event, edge) => onSelectRelationship(edge.id)}
      onPaneClick={onClear}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
      {Object.keys(placed).length > 0 && (
        <Panel position="top-right">
          <Button size="sm" variant="outline" className="bg-background" onClick={() => place({})}>
            배치 되돌리기
          </Button>
        </Panel>
      )}
    </ReactFlow>
  );
}
