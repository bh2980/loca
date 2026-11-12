import { useEffect, useMemo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Position, useInternalNode, type Edge, type EdgeProps, type InternalNode, type Node, type NodeProps } from '@xyflow/react';
import { Button, Inline, PersonNodeFrame, RelationLabelFrame, Text, FlowHandle } from '@loca/ui';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { CharacterRole } from '@tw/shared';
import { EditableFlow, type EditableFlowActions } from '@/components/knowledge/editable-flow';
import { personStyle } from '@/lib/person-colors';
import { relationLabel, relationRow } from '@/lib/relation-label';
import { stored, STORED, useStored } from '@/lib/storage';

export interface GraphCharacter {
  id: string;
  name: string;
  role: CharacterRole;
  /** The color a person gave the character (palette hex, '' = none): the name is shown in it. */
  color?: string;
}
export interface GraphRelationship {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  /** The kinds it changes to, in script order (shown after the kind). */
  changes?: { kind: string }[];
  mutual: boolean;
  /** Drawn dashed: a candidate not yet used as context. */
  dashed?: boolean;
}

const NODE_WIDTH = 150;
const NODE_HEIGHT = 44;
const elk = new ELK();

type Layout = { key: string; byId: Record<string, { x: number; y: number }> };
/**
 * Layouts already made, by what they were made from (people and relationship ends): opening the
 * graph again, or the same filter again, reuses one instead of running ELK. The latest one per
 * graph is also kept in this browser, so a reload does not lay it out again either.
 */
const layouts = new Map<string, Layout>();
const LAYOUTS_KEPT = 20;
function knownLayout(storageKey: string, key: string): Layout | null {
  const hit = layouts.get(key);
  if (hit) return hit;
  // A convenience: without what was kept the graph is laid out again.
  const kept = stored(STORED.relationshipLayout, storageKey).read();
  return kept?.key === key ? keepLayout(storageKey, kept, false) : null;
}
function keepLayout(storageKey: string, layout: Layout, store = true) {
  layouts.delete(layout.key);
  layouts.set(layout.key, layout);
  if (layouts.size > LAYOUTS_KEPT) layouts.delete(layouts.keys().next().value!);
  if (store) stored(STORED.relationshipLayout, storageKey).write(layout);
  return layout;
}

/** `target`: the person the open context menu acts on (set by EditableFlow), ringed like a selection while the selection itself stays. */
type PersonNode = Node<{ label: string; role: GraphCharacter['role']; color?: string; dim: boolean; target: boolean }, 'person'>;
/** A line's label: one row per relationship it stands for (two when the pair goes both ways). */
type LabelRow = { id: string; text: string; selected: boolean };
type RelationEdge = Edge<{ offset: number; rows: LabelRow[]; dim: boolean; focus: boolean; dashed?: boolean; showLabel: boolean; onPick: (id: string) => void }, 'relation'>;

function PersonNodeView({ data, selected, isConnectable }: NodeProps<PersonNode>) {
  return (
    <PersonNodeFrame
      role={data.role}
      active={selected || data.target}
      // A picked person, or the one a menu is open on, stays full strength whatever is emphasised.
      dim={data.dim && !selected && !data.target}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Text truncate style={personStyle(data.color)}>{data.label}</Text>
      {/* Edges are floating (they attach to the node border). Dragging from the dot (always shown, as the
          workflow editor's ports, with a wider grab area) draws a new relationship; a drop anywhere on
          another person ends it there (connectionRadius). */}
      <FlowHandle look="anchor"><Handle type="target" position={Position.Top} isConnectableStart={false} /></FlowHandle>
      {isConnectable && <FlowHandle look="person"><Handle type="source" position={Position.Bottom} title="끌어서 관계 잇기" /></FlowHandle>}
    </PersonNodeFrame>
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
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={20} style={{ stroke: selected || data?.focus ? 'var(--stroke-accent)' : 'var(--stroke-graph-edge)', strokeWidth: selected ? 2.5 : data?.focus ? 2 : 1.5, opacity: data?.dim ? 0.2 : 1, strokeDasharray: data?.dashed ? '5 4' : undefined }} />
      {/* Labels of every relationship at once pile up; they show for the selected or hovered person, or on the selected line. */}
      {(selected || data?.showLabel) && !!data?.rows.length && (
        <EdgeLabelRenderer>
          <RelationLabelFrame
            data-relation-label
            active={selected || data?.focus}
            dim={data?.dim}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: 'all' }}
          >
            {data?.rows.map((row) => (
              <Button key={row.id} variant="ghost" size="inline" justifyContent="start" radius="none" weight={row.selected ? 'medium' : 'normal'} nowrap tone={row.selected || selected || data.focus ? 'accent' : undefined} onClick={(event) => {
                  // The line under the label would otherwise take the click and pick the first relationship.
                  event.stopPropagation();
                  data.onPick(row.id);
                }}>
                {row.text}
              </Button>
            ))}
          </RelationLabelFrame>
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
 * dragged; where a person was put is remembered in this browser (per project) over the layout.
 * Picking, the keys, menus, copy and paste and the remembered view are EditableFlow's, shared with the 사건 흐름;
 * this file holds the people and lines as drawn, their layout and what is emphasised.
 */
export function RelationshipGraph({ projectId, characters, relationships, selectedCharacterId, selectedRelationshipId, onSelectCharacter, onSelectRelationship, onClear, actions }: {
  projectId: string;
  characters: GraphCharacter[];
  relationships: GraphRelationship[];
  selectedCharacterId?: string;
  /** The open line: its pair's key. */
  selectedRelationshipId?: string;
  onSelectCharacter: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onClear: () => void;
  /** What it can change (the page's, each undoable); without it the graph only shows and selects. */
  actions?: EditableFlowActions<string>;
}) {
  const known = useMemo(() => new Set(characters.map((character) => character.id)), [characters]);
  const drawable = useMemo(() => relationships.filter((relationship) => known.has(relationship.fromId) && known.has(relationship.toId)), [relationships, known]);
  const layoutKey = useMemo(() => JSON.stringify([characters.map((c) => c.id), drawable.map((r) => [r.fromId, r.toId])]), [characters, drawable]);
  const [positions, setPositions] = useState<Layout | null>(() => knownLayout(projectId, layoutKey));
  const [placed, place] = useStored(STORED.relationshipPositions, projectId);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const kept = knownLayout(projectId, layoutKey);
    if (kept) {
      // The one in use is the one a reload should find (a filter toggled back reuses its layout from memory).
      setPositions(keepLayout(projectId, kept));
      return;
    }
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
        setPositions(keepLayout(projectId, { key: layoutKey, byId: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])) }));
      });
    return () => {
      cancelled = true;
    };
    // layoutKey fully describes the inputs that change the layout.
  }, [projectId, layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
        data: { label: character.name, role: character.role, color: character.color, dim: emphasis.active && !emphasis.nodeIds.has(character.id), target: false },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
    [characters, positions, placed, emphasis],
  );
  const edges = useMemo<RelationEdge[]>(() => {
    const marker = { type: MarkerType.ArrowClosed, color: 'var(--stroke-subtle)' };
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
            // A direction with no relationship (only a speech rule) gets no row; its arrowhead still says the direction.
            rows: members.flatMap((relationship, at) => relationLabel(relationship.kind, relationship.changes) ? [{ id: relationship.id, text: relationRow(members.length > 1 ? (at === 0 ? 'forward' : 'back') : relationship.mutual ? 'both' : 'forward', relationship.kind, relationship.changes), selected: relationship.id === selectedRelationshipId }] : []),
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

  if (!positions) return <Inline height="full" justify="center" variant="body" tone="muted">배치 계산 중…</Inline>;
  return (
    <EditableFlow<PersonNode, RelationEdge, string>
      projectId={projectId}
      graph="relationships"
      clipboard="people"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      itemIds={known}
      layoutKey={positions.key}
      computed={positions.byId}
      placed={placed}
      place={place}
      openId={selectedCharacterId}
      openLine={selectedRelationshipId}
      onOpen={onSelectCharacter}
      onOpenLine={onSelectRelationship}
      onClear={onClear}
      // A line stands for its pair (one line for a relationship each way): the first relationship's id names it.
      lineOf={(edge) => edge.id.split('+')[0]!}
      actions={actions}
      labels={{ add: '인물 추가', count: (n) => `${n}명` }}
      toolbox={{ position: Position.Top, offset: 12 }}
      fitPadding={0.2}
      // A drop anywhere near another person ends the line there.
      connectionRadius={80}
      onHover={setHovered}
      // A click on a relationship label also reaches the pane; it picks that relationship, not nothing.
      ignorePaneClick={(target) => Boolean(target.closest('[data-relation-label]'))}
    />
  );
}
