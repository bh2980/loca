import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphShortcuts } from '@/lib/graph-shortcuts';
import { BaseEdge, Background, EdgeLabelRenderer, Handle, MarkerType, NodeToolbar, Panel, Position, ReactFlow, useInternalNode, type Edge, type EdgeProps, type InternalNode, type Node, type NodeChange, type NodeProps, type ReactFlowInstance, SelectionMode } from '@xyflow/react';
import { Box, Button, CanvasToolbar, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger, Inline, PersonNodeFrame, RelationLabelFrame, SelectionToolbox, Text } from '@loca/ui';
import { Copy, Trash2 } from 'lucide-react';
import type { RelationshipGraphActions } from '@/components/knowledge/graph-actions';
import { GRAPH_KEYS } from '@/lib/graph-shortcuts';
import { keyLabel } from '@/lib/keys';
import ELK from 'elkjs/lib/elk.bundled.js';
import '@xyflow/react/dist/style.css';
import type { CharacterRole } from '@tw/shared';
import { personStyle } from '@/lib/person-colors';
import { relationRow } from '@/lib/relation-label';
import { useIsDark } from '@/lib/theme';

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
  try {
    const stored = JSON.parse(localStorage.getItem(`${storageKey}.layout`) ?? 'null') as Layout | null;
    if (stored?.key === key) return keepLayout(storageKey, stored, false);
  } catch {
    // A convenience: without storage the graph is laid out again.
  }
  return null;
}
function keepLayout(storageKey: string, layout: Layout, store = true) {
  layouts.delete(layout.key);
  layouts.set(layout.key, layout);
  if (layouts.size > LAYOUTS_KEPT) layouts.delete(layouts.keys().next().value!);
  if (store)
    try {
      localStorage.setItem(`${storageKey}.layout`, JSON.stringify(layout));
    } catch {
      // As above.
    }
  return layout;
}

/** `target`: the person the open context menu acts on, ringed like a selection while the selection itself stays (as in the scene graph). */
type PersonNode = Node<{ label: string; role: GraphCharacter['role']; color?: string; dim: boolean; target: boolean }, 'person'>;
/** A line's label: one row per relationship it stands for (two when the pair goes both ways). */
type LabelRow = { id: string; text: string; selected: boolean };
type RelationEdge = Edge<{ offset: number; rows: LabelRow[]; dim: boolean; focus: boolean; dashed?: boolean; showLabel: boolean; onPick: (id: string) => void }, 'relation'>;

function PersonNodeView({ data, selected, isConnectable }: NodeProps<PersonNode>) {
  return (
    <PersonNodeFrame
      role={data.role}
      active={selected || data.target}
      dim={data.dim && !data.target}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Text truncate style={personStyle(data.color)}>{data.label}</Text>
      {/* Edges are floating (they attach to the node border). Dragging from the dot (always shown, as the
          workflow editor's ports, with a wider grab area) draws a new relationship; a drop anywhere on
          another person ends it there (connectionRadius). */}
      <Box asChild flowHandle="anchor"><Handle type="target" position={Position.Top} isConnectableStart={false} /></Box>
      {isConnectable && <Box asChild flowHandle="port"><Handle type="source" position={Position.Bottom} title="끌어서 관계 잇기" /></Box>}
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
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={20} style={{ stroke: selected || data?.focus ? 'var(--primary)' : 'var(--graph-edge)', strokeWidth: selected ? 2.5 : data?.focus ? 2 : 1.5, opacity: data?.dim ? 0.2 : 1, strokeDasharray: data?.dashed ? '5 4' : undefined }} />
      {/* Labels of every relationship at once pile up; they show for the selected or hovered person, or on the selected line. */}
      {(selected || data?.showLabel) && (
        <EdgeLabelRenderer>
          <RelationLabelFrame
            data-relation-label
            active={selected || data?.focus}
            dim={data?.dim}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: 'all' }}
          >
            {data?.rows.map((row) => (
              <Button key={row.id} variant="ghost" size="inline" justifyContent="start" radius="none" weight={row.selected ? 'medium' : 'normal'} nowrap tone={row.selected || selected || data.focus ? 'primary' : undefined} onClick={(event) => {
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
 * dragged; where a person was put is remembered in this browser (`storageKey`) over the layout.
 */
/** Copied people (⌘/Ctrl+C or X), pasted as copies with the relationships among them. */
let peopleClipboard: string[] = [];

export function RelationshipGraph({ storageKey, characters, relationships, selectedCharacterId, selectedRelationshipId, onSelectCharacter, onSelectRelationship, onClear, actions }: {
  storageKey: string;
  characters: GraphCharacter[];
  relationships: GraphRelationship[];
  selectedCharacterId?: string;
  selectedRelationshipId?: string;
  onSelectCharacter: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onClear: () => void;
  /** What it can change (the page's, each undoable); without it the graph only shows and selects. */
  actions?: RelationshipGraphActions;
}) {
  const dark = useIsDark();
  // Characters picked with a Shift+drag box or ⌘/Ctrl+click, as in the other graphs: ringed, even a
  // single one; only a plain click is the page's selection with its pane. The graph's own: tables keep theirs.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // What the right-click menu acts on: people (the picked ones when it opens on one of them), a line, or the empty canvas at a point.
  const [menu, setMenu] = useState<{ kind: 'people'; ids: string[] } | { kind: 'line'; id: string } | { kind: 'pane'; at: { x: number; y: number } } | null>(null);
  const menuFor = menu?.kind === 'people' ? menu.ids : null;
  const [flow, setFlow] = useState<ReactFlowInstance<PersonNode, RelationEdge>>();
  const [zoom, setZoom] = useState(1);
  // An edit changes who or which lines there are, which would lay the graph out anew: first everyone is
  // kept where they are shown (as if dragged there), and the view does not refit. 자동 정렬 lays it out again.
  const editedRef = useRef(0);
  const edit = <A extends unknown[], R>(run: (...args: A) => R) => (...args: A) => {
    editedRef.current = Date.now();
    place({ ...positionsRef.current?.byId, ...placedRef.current });
    return run(...args);
  };
  const edits = useMemo(
    () => actions && { ...actions, remove: edit(actions.remove), connect: edit(actions.connect), addPerson: edit(actions.addPerson), duplicate: edit(actions.duplicate), undo: edit(actions.undo), redo: edit(actions.redo) },
    [actions], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const selection = picked.size ? [...picked] : selectedCharacterId ? [selectedCharacterId] : [];
  const removeSelection = () => {
    if (!edits) return;
    setPicked(new Set());
    void edits.remove({ characterIds: selection, pairIds: !selection.length && selectedRelationshipId ? [selectedRelationshipId] : [] });
    onClear();
  };
  // Copies go beside their originals, picked.
  const paste = async (ids: string[]) => {
    if (!edits || !ids.length) return;
    const made = await edits.duplicate(ids);
    const at = (id: string) => placedRef.current[id] ?? positionsRef.current?.byId[id] ?? { x: 0, y: 0 };
    place({ ...placedRef.current, ...Object.fromEntries([...made].map(([from, to]) => [to, { x: at(from).x + 60, y: at(from).y + 60 }])) });
    setPicked(new Set(made.values()));
  };
  // The shared graph keys (lib/graph-shortcuts), the same as in the workflow editor.
  useGraphShortcuts(
    {
      undo: () => void edits?.undo(),
      redo: () => void edits?.redo(),
      copy: () => void (selection.length && (peopleClipboard = selection)),
      cut: () => {
        if (!selection.length) return;
        peopleClipboard = selection;
        removeSelection();
      },
      paste: () => void paste(peopleClipboard.filter((id) => characters.some((character) => character.id === id))),
      remove: () => (selection.length || selectedRelationshipId ? removeSelection() : undefined),
    },
    Boolean(actions),
  );
  const known = useMemo(() => new Set(characters.map((character) => character.id)), [characters]);
  const drawable = useMemo(() => relationships.filter((relationship) => known.has(relationship.fromId) && known.has(relationship.toId)), [relationships, known]);
  const layoutKey = useMemo(() => JSON.stringify([characters.map((c) => c.id), drawable.map((r) => [r.fromId, r.toId])]), [characters, drawable]);
  const [positions, setPositions] = useState<Layout | null>(() => knownLayout(storageKey, layoutKey));
  const [placed, setPlaced] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, { x: number; y: number }>;
    } catch {
      return {};
    }
  });
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const place = (next: Record<string, { x: number; y: number }>) => {
    setPlaced(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Positions are a convenience; without storage they last until reload.
    }
  };
  const [hovered, setHovered] = useState<string | null>(null);
  // A new layout (other people shown) refits the view by remounting it; one that follows an edit keeps the view.
  const viewKey = useRef(positions?.key);
  const seenKey = useRef(positions?.key);
  if (positions && positions.key !== seenKey.current) {
    seenKey.current = positions.key;
    // The data an edit changes can arrive in more than one refresh.
    if (Date.now() - editedRef.current > 5000 || !viewKey.current) viewKey.current = positions.key;
  }

  useEffect(() => {
    const kept = knownLayout(storageKey, layoutKey);
    if (kept) {
      // The one in use is the one a reload should find (a filter toggled back reuses its layout from memory).
      setPositions(keepLayout(storageKey, kept));
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
        setPositions(keepLayout(storageKey, { key: layoutKey, byId: Object.fromEntries((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])) }));
      });
    return () => {
      cancelled = true;
    };
    // layoutKey fully describes the inputs that change the layout.
  }, [storageKey, layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
        data: { label: character.name, role: character.role, color: character.color, dim: emphasis.active && !emphasis.nodeIds.has(character.id) && !picked.has(character.id), target: Boolean(menuFor?.includes(character.id)) },
        selected: picked.size ? picked.has(character.id) : character.id === selectedCharacterId,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
    [characters, positions, placed, selectedCharacterId, emphasis, menuFor, picked],
  );
  // Where nodes are while being dragged, on top of the memoized nodes: emphasis or selection changing
  // mid-drag must not put a node back where it was. The drop is kept in `placed`.
  const [moving, setMoving] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState(false);
  const flowNodes = useMemo(() => nodes.map((node) => (moving[node.id] ? { ...node, position: moving[node.id] } : node)), [nodes, moving]);
  const edges = useMemo<RelationEdge[]>(() => {
    const marker = { type: MarkerType.ArrowClosed, color: 'var(--subtle-foreground)' };
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
            rows: members.map((relationship, at) => ({ id: relationship.id, text: relationRow(members.length > 1 ? (at === 0 ? 'forward' : 'back') : relationship.mutual ? 'both' : 'forward', relationship.kind, relationship.changes), selected: relationship.id === selectedRelationshipId })),
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
  const menuCharacter = menuFor?.length === 1 ? characters.find((character) => character.id === menuFor[0]) : undefined;
  /** The picked set after React Flow's select changes (a box, a ⌘/Ctrl+click; a plain click is settled in onNodeClick). */
  const pick = (changes: NodeChange<PersonNode>[]) => {
    const select = changes.filter((change) => change.type === 'select');
    if (!select.length) return;
    const next = new Set(selection);
    for (const change of select) {
      if (change.selected) next.add(change.id);
      else next.delete(change.id);
    }
    setPicked(next);
    if (next.size && selectedCharacterId) onClear();
  };
  const one = selection.length === 1 && !picked.size ? characters.find((character) => character.id === selection[0]) : undefined;
  const linePair = menu?.kind === 'line' ? menu.id : undefined;
  return (
    <ContextMenu onOpenChange={(open) => !open && setMenu(null)}>
    <ContextMenuTrigger asChild>
    <Box height="full" width="full">
    <ReactFlow colorMode={dark ? 'dark' : 'light'}
      key={viewKey.current}
      nodes={flowNodes}
      edges={edges}
      onInit={(instance) => {
        setFlow(instance);
        setZoom(instance.getZoom());
      }}
      onMove={(_event, viewport) => setZoom(viewport.zoom)}
      onNodesChange={(changes: NodeChange<PersonNode>[]) => {
        const moved = changes.flatMap((change) => (change.type === 'position' && change.position ? [[change.id, change.position] as const] : []));
        if (moved.length) setMoving((current) => ({ ...current, ...Object.fromEntries(moved) }));
        pick(changes);
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
      // Drawing from a person's dot to another person makes a relationship (the page opens it to fill in).
      nodesConnectable={Boolean(actions)}
      connectionRadius={80}
      // Lines are drawn by dragging only: a click on one dot and then another would draw one unasked.
      connectOnClick={false}
      onConnect={(connection) => connection.source && connection.target && void edits?.connect(connection.source, connection.target)}
      elementsSelectable
      // Same as the other graphs: left or middle drag pans, Shift+drag draws a selection box, ⌘/Ctrl+click adds a person.
      panOnDrag={[0, 1]}
      selectionKeyCode="Shift"
      multiSelectionKeyCode={['Meta', 'Control']}
      selectionMode={SelectionMode.Partial}
      // Delete goes through the shared graph keys (lib/graph-shortcuts), undoable.
      deleteKeyCode={null}
      onNodeContextMenu={(_event, node) => setMenu({ kind: 'people', ids: picked.has(node.id) ? [...picked] : [node.id] })}
      onEdgeContextMenu={(_event, edge) => setMenu({ kind: 'line', id: edge.id.split('+')[0]! })}
      onPaneContextMenu={(event) => flow && setMenu({ kind: 'pane', at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) })}
      // A ⌘/Ctrl+click adds to the picked set (pick, above); a plain click is the ordinary selection.
      onNodeClick={(event, node) => {
        if (event.metaKey || event.ctrlKey) return;
        setPicked(new Set());
        onSelectCharacter(node.id);
      }}
      // A plain click on a line picks only the line (its pair opens to read and edit), as in the workflow editor.
      onEdgeClick={(_event, edge) => {
        setPicked(new Set());
        onSelectRelationship(edge.id.split('+')[0]!);
      }}
      // A click on a relationship label also reaches the pane; it picks that relationship, not nothing.
      onPaneClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-relation-label]')) return;
        setPicked(new Set());
        onClear();
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Panel position="bottom-right">
        <CanvasToolbar
          zoomPercent={zoom * 100}
          onZoomIn={() => void flow?.zoomIn()}
          onZoomOut={() => void flow?.zoomOut()}
          onFit={() => void flow?.fitView({ padding: 0.2, duration: 200 })}
          onResetZoom={() => void flow?.zoomTo(1, { duration: 180 })}
          // Positions people were dragged to are dropped: the computed layout again.
          onLayout={() => place({})}
          layoutLabel="자동 정렬"
        />
      </Panel>
      {edits && one && (
        <NodeToolbar nodeId={one.id} isVisible position={Position.Top} offset={12}>
          <SelectionToolbox actions={[
            { id: 'copy', label: '복제', icon: <Copy />, onSelect: () => void paste([one.id]) },
            { id: 'delete', label: '삭제', icon: <Trash2 />, onSelect: removeSelection },
          ]} />
        </NodeToolbar>
      )}
    </ReactFlow>
    </Box>
    </ContextMenuTrigger>
    {menu && (
      <ContextMenuContent>
        {menu.kind === 'people' && (
          <>
            {menuCharacter && <ContextMenuItem onClick={() => onSelectCharacter(menuCharacter.id)}>상세 열기</ContextMenuItem>}
            {edits && (
              <>
                <ContextMenuItem onClick={() => void paste(menu.ids)}>복제</ContextMenuItem>
                <ContextMenuItem onClick={() => (peopleClipboard = menu.ids)}>
                  복사
                  <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.copy)}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => {
                  setPicked(new Set());
                  void edits.remove({ characterIds: menu.ids, pairIds: [] });
                }}>
                  {menu.ids.length > 1 ? `삭제 (${menu.ids.length}명)` : '삭제'}
                  <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</ContextMenuShortcut>
                </ContextMenuItem>
              </>
            )}
          </>
        )}
        {menu.kind === 'line' && linePair && (
          <>
            <ContextMenuItem onClick={() => onSelectRelationship(linePair)}>상세 열기</ContextMenuItem>
            {edits && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => void edits.remove({ characterIds: [], pairIds: [linePair] })}>
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
                void edits.addPerson().then((id) => id && place({ ...placedRef.current, [id]: at }));
              }}>인물 추가</ContextMenuItem>
            )}
            {edits && peopleClipboard.some((id) => characters.some((character) => character.id === id)) && (
              <ContextMenuItem onClick={() => void paste(peopleClipboard.filter((id) => characters.some((character) => character.id === id)))}>
                붙여넣기
                <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.paste)}</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => place({})}>자동 정렬</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    )}
    </ContextMenu>
  );
}
