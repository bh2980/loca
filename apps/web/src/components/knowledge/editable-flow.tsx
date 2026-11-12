import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, NodeToolbar, Panel, ReactFlow, SelectionMode, type Edge, type EdgeTypes, type FinalConnectionState, type Node, type NodeChange, type NodeTypes, type Position, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Trash2 } from 'lucide-react';
import { Box, CanvasToolbar, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger, SelectionToolbox, useCanvasDismiss, type CanvasDirection } from '@loca/ui';
import { idClipboard, type ClipboardKind } from '@/lib/graph-clipboard';
import { useGraphSelection } from '@/lib/graph-selection';
import { GRAPH_KEYS, useGraphShortcuts } from '@/lib/graph-shortcuts';
import { keyLabel } from '@/lib/keys';
import { useIsDark } from '@/lib/theme';
import { shortKey, useStoredViewport, viewportScope, type Viewport, type ViewportGraph } from '@/lib/viewport';

export type Point = { x: number; y: number };

/**
 * What an editable knowledge graph does to its items (people, events) and the lines between them. Each action is the
 * page's and undoable (graph-history.ts); a line is named the way the graph names it (`Line`).
 */
export interface EditableFlowActions<Line> {
  /** Deletes items and lines at once. */
  remove: (target: { ids: string[]; lines: Line[] }) => unknown;
  /** A line drawn from one item to another. */
  connect: (fromId: string, toId: string) => unknown;
  /** A new item; its id, so the graph can put it where the menu opened. */
  add: () => Promise<string | undefined>;
  /** Copies of items; old id → new id. */
  duplicate: (ids: string[]) => Promise<Map<string, string>>;
  undo: () => unknown;
  redo: () => unknown;
}

/** What the right-click menu acts on: items (the picked ones when it opens on one of them), a line, or the empty canvas at a point. */
type Menu<Line> = { kind: 'items'; ids: string[] } | { kind: 'line'; line: Line } | { kind: 'pane'; at: Point };

interface EditableFlowProps<N extends Node, E extends Edge, Line> {
  projectId: string;
  /** Which graph this is: its viewport is remembered under it. */
  graph: Extract<ViewportGraph, 'relationships' | 'events'>;
  /** What else tells its views apart (the direction it is drawn in). */
  scope?: string;
  /** Which clipboard its copies go to. */
  clipboard: ClipboardKind;
  /**
   * The nodes where they are laid out or were dragged to. The graph adds what interaction decides to its items: the
   * position while dragged, `selected`, and `data.target` (the item the open menu acts on, ringed like a selection
   * while the selection itself stays).
   */
  nodes: N[];
  edges: E[];
  nodeTypes: NodeTypes;
  edgeTypes?: EdgeTypes;
  /** The nodes that are items (a section's title is a node too, and is not). */
  itemIds: ReadonlySet<string>;
  /** Says what is shown (the items and their lines): another one, not following an edit, opens as a new view. */
  layoutKey: string;
  /** Where the layout put each item, and where a person dragged some (kept in this browser by the graph). */
  computed: Record<string, Point>;
  placed: Record<string, Point>;
  place: (next: Record<string, Point>) => void;
  /** The page's open item: a node's id, or a line. */
  openId?: string;
  openLine?: Line;
  onOpen: (id: string) => void;
  onOpenLine: (line: Line) => void;
  onClear: () => void;
  lineOf: (edge: E) => Line;
  /** What it can change; without it the graph only shows and selects. */
  actions?: EditableFlowActions<Line>;
  labels: { add: string; count: (n: number) => string };
  /** Where the toolbox of one open item stands. */
  toolbox: { position: Position; align?: 'start' | 'center' | 'end'; offset: number };
  fitPadding: number;
  /** The first look at a view nothing is remembered for; absent: the whole graph fitted. */
  openView?: (flow: ReactFlowInstance<N, E>, frame: HTMLElement | null) => void;
  direction?: CanvasDirection;
  onDirectionChange?: (direction: CanvasDirection) => void;
  /** How near a node a dragged line has to end to land on it (React Flow's own snapping). */
  connectionRadius: number;
  /** A line let go anywhere: the graph decides what it lands on (`connect` is the undoable action). */
  onConnectEnd?: (event: MouseEvent | TouchEvent, state: FinalConnectionState, context: { flow: ReactFlowInstance<N, E> | undefined; nodes: N[]; connect: (fromId: string, toId: string) => void }) => void;
  /** The item under the pointer (never while one is dragged). */
  onHover?: (id: string | null) => void;
  /** A click that reaches the pane but is not on it (a label drawn over the canvas). */
  ignorePaneClick?: (target: HTMLElement) => boolean;
}

/**
 * The editing model the knowledge graphs share (the relationship graph, the 사건 흐름): React Flow graphs of items
 * a person picks (Shift+drag box, ⌘/Ctrl+click), drags, copies, deletes and joins with lines, with the keys every
 * graph has (lib/graph-shortcuts), right-click menus, a toolbox over the one open item and the canvas toolbar.
 * Dragged positions stay until 자동 정렬; an edit keeps everyone where they are; the view is remembered for the tab
 * (lib/viewport.ts). A graph built on this holds what differs: its nodes and lines, their layout, and its actions.
 */
export function EditableFlow<N extends Node, E extends Edge, Line>({ projectId, graph, scope, clipboard, nodes, edges, nodeTypes, edgeTypes, itemIds, layoutKey, computed, placed, place, openId, openLine, onOpen, onOpenLine, onClear, lineOf, actions, labels, toolbox, fitPadding, openView, direction, onDirectionChange, connectionRadius, onConnectEnd, onHover, ignorePaneClick }: EditableFlowProps<N, E, Line>) {
  const dismiss = useCanvasDismiss();
  const dark = useIsDark();
  const frame = useRef<HTMLDivElement>(null);
  const [flow, setFlow] = useState<ReactFlowInstance<N, E>>();
  const [zoom, setZoom] = useState(1);
  const anythingOpen = Boolean(openId) || openLine !== undefined;
  // The keys act on the picked set, else on the open item when it is one of the items shown.
  const selection = useGraphSelection(openId && itemIds.has(openId) ? openId : undefined);
  const { picked } = selection;
  const [menu, setMenu] = useState<Menu<Line> | null>(null);
  const menuIds = menu?.kind === 'items' ? menu.ids : null;
  const copied = useMemo(() => idClipboard(clipboard), [clipboard]);
  const pasteable = () => copied.read((id) => itemIds.has(id));

  // An edit changes which items or lines there are, which would lay the graph out anew: first everyone is kept where
  // they are shown (as if dragged there), and the view does not refit. 자동 정렬 lays it out again.
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const computedRef = useRef(computed);
  computedRef.current = computed;
  const editedAt = useRef(0);
  const edit = <A extends unknown[], R>(run: (...args: A) => R) => (...args: A) => {
    editedAt.current = Date.now();
    place({ ...computedRef.current, ...placedRef.current });
    return run(...args);
  };
  const edits = actions && { remove: edit(actions.remove), connect: edit(actions.connect), add: edit(actions.add), duplicate: edit(actions.duplicate), undo: edit(actions.undo), redo: edit(actions.redo) };

  const removeSelection = () => {
    if (!edits) return;
    const ids = selection.ids;
    selection.clear();
    void edits.remove({ ids, lines: !ids.length && openLine !== undefined ? [openLine] : [] });
    onClear();
  };
  // Copies go beside their originals, picked (the pane of what was open closes: the copies are the selection now).
  const paste = async (ids: string[]) => {
    if (!edits || !ids.length) return;
    const made = await edits.duplicate(ids);
    const at = (id: string) => placedRef.current[id] ?? computedRef.current[id] ?? { x: 0, y: 0 };
    place({ ...placedRef.current, ...Object.fromEntries([...made].map(([from, to]) => [to, { x: at(from).x + 60, y: at(from).y + 60 }])) });
    selection.set(made.values());
    if (anythingOpen) onClear();
  };
  useGraphShortcuts(
    {
      undo: () => void edits?.undo(),
      redo: () => void edits?.redo(),
      copy: () => copied.copy(selection.ids),
      cut: () => {
        if (!selection.ids.length) return;
        copied.copy(selection.ids);
        removeSelection();
      },
      paste: () => void paste(pasteable()),
      remove: () => (selection.ids.length || openLine !== undefined ? removeSelection() : undefined),
    },
    Boolean(actions),
  );

  // Another layout (other items shown) is a new view: React Flow is mounted again and opens where that view was left,
  // or at its start. One that follows an edit keeps the view (the data an edit changes can arrive in more than one refresh).
  const viewKey = useRef(layoutKey);
  const seenKey = useRef(layoutKey);
  if (layoutKey !== seenKey.current) {
    seenKey.current = layoutKey;
    if (Date.now() - editedAt.current > 5000) viewKey.current = layoutKey;
  }
  // The view is remembered per set of items shown: the same people or events open where they were left.
  const shownKey = useMemo(() => shortKey(layoutKey), [layoutKey]);
  const viewport = useStoredViewport(projectId, graph, viewportScope(scope, shownKey));
  // What the mounted view opened with: read when it mounts, so a later save does not move it.
  const opening = useRef<{ key: string; viewport?: Viewport }>(undefined);
  if (opening.current?.key !== viewKey.current) opening.current = { key: viewKey.current, viewport: viewport.initial };
  // A view kept through an edit is now the view of what the edit left: remembered under that.
  useEffect(() => {
    if (flow && viewKey.current !== layoutKey) viewport.save(flow.getViewport());
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where nodes are while being dragged, on top of the caller's nodes: emphasis or selection changing mid-drag must
  // not put a node back where it was. The drop is kept in `placed`.
  const [moving, setMoving] = useState<Record<string, Point>>({});
  const dragging = useRef(false);
  const marked = useMemo(
    () => nodes.map((node) => (itemIds.has(node.id) ? { ...node, selected: picked.size ? picked.has(node.id) : node.id === openId, data: { ...node.data, target: Boolean(menuIds?.includes(node.id)) } } : node)),
    [nodes, itemIds, picked, openId, menuIds],
  );
  // Only the nodes being dragged are new objects per move: the rest keep theirs, so React Flow does not draw them again.
  const drawn = useMemo(() => marked.map((node) => (moving[node.id] ? { ...node, position: moving[node.id]! } : node)), [marked, moving]);

  const one = edits && selection.ids.length === 1 && !picked.size ? selection.ids[0] : undefined;
  return (
    <ContextMenu onOpenChange={(open) => !open && setMenu(null)}>
      <ContextMenuTrigger asChild>
        <Box ref={frame} height="full" width="full">
          <ReactFlow<N, E>
            colorMode={dark ? 'dark' : 'light'}
            ref={dismiss}
            key={viewKey.current}
            nodes={drawn}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultViewport={opening.current.viewport}
            fitView={!opening.current.viewport && !openView}
            fitViewOptions={{ padding: fitPadding }}
            onInit={(instance) => {
              setFlow(instance);
              if (!opening.current?.viewport) openView?.(instance, frame.current);
              setZoom(instance.getZoom());
            }}
            onMove={(_event, at) => setZoom(at.zoom)}
            onMoveEnd={(_event, at) => viewport.save(at)}
            onNodesChange={(changes: NodeChange<N>[]) => {
              const moved = changes.flatMap((change) => (change.type === 'position' && change.position ? [[change.id, change.position] as const] : []));
              if (moved.length) setMoving((current) => ({ ...current, ...Object.fromEntries(moved) }));
              // A box or a ⌘/Ctrl+click picks (a plain click is settled in onNodeClick); the open item's pane gives way to the set.
              const next = selection.apply(changes.flatMap((change) => (change.type === 'select' ? [{ id: change.id, selected: change.selected }] : [])));
              if (next?.size && openId) onClear();
            }}
            onNodeDragStart={() => void (dragging.current = true)}
            onNodeDragStop={(_event, _node, dragged) => {
              place({ ...placed, ...Object.fromEntries(dragged.map((node) => [node.id, node.position])) });
              setMoving({});
              dragging.current = false;
            }}
            onNodeMouseEnter={onHover && ((_event, node) => void (!dragging.current && onHover(node.id)))}
            onNodeMouseLeave={onHover && (() => void (!dragging.current && onHover(null)))}
            minZoom={0.1}
            // Drawing from an item's dot to another item makes a line (the page opens it to fill in).
            nodesConnectable={Boolean(actions)}
            connectionRadius={connectionRadius}
            // Lines are drawn by dragging only: a click on one dot and then another would draw one unasked.
            connectOnClick={false}
            onConnect={(connection) => connection.source && connection.target && void edits?.connect(connection.source, connection.target)}
            onConnectEnd={onConnectEnd && ((event, state) => edits && onConnectEnd(event, state, { flow, nodes: drawn, connect: (fromId, toId) => void edits.connect(fromId, toId) }))}
            // Same as the other graphs: left or middle drag pans, Shift+drag draws a selection box, ⌘/Ctrl+click adds an item.
            panOnDrag={[0, 1]}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Meta', 'Control']}
            selectionMode={SelectionMode.Partial}
            // Delete goes through the shared graph keys (lib/graph-shortcuts), undoable.
            deleteKeyCode={null}
            onNodeContextMenu={(_event, node) => itemIds.has(node.id) && setMenu({ kind: 'items', ids: selection.targetsOf(node.id) })}
            onEdgeContextMenu={(_event, edge) => setMenu({ kind: 'line', line: lineOf(edge) })}
            onPaneContextMenu={(event) => flow && setMenu({ kind: 'pane', at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) })}
            // A ⌘/Ctrl+click adds to the picked set (above); a plain click opens the item in its pane.
            onNodeClick={(event, node) => {
              if (!itemIds.has(node.id) || event.metaKey || event.ctrlKey) return;
              selection.clear();
              onOpen(node.id);
            }}
            // A plain click on a line picks only the line (it opens to read and edit), as in the workflow editor.
            onEdgeClick={(_event, edge) => {
              selection.clear();
              onOpenLine(lineOf(edge));
            }}
            onPaneClick={(event) => {
              if (ignorePaneClick?.(event.target as HTMLElement)) return;
              selection.clear();
              if (anythingOpen) onClear();
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Panel position="bottom-right">
              <CanvasToolbar
                zoomPercent={zoom * 100}
                onZoomIn={() => void flow?.zoomIn()}
                onZoomOut={() => void flow?.zoomOut()}
                onFit={() => void flow?.fitView({ padding: fitPadding, duration: 200 })}
                onResetZoom={() => void flow?.zoomTo(1, { duration: 180 })}
                // Positions items were dragged to are dropped: the computed layout again.
                onLayout={() => place({})}
                layoutLabel="자동 정렬"
                direction={direction}
                onDirectionChange={onDirectionChange}
              />
            </Panel>
            {one && (
              <NodeToolbar nodeId={one} isVisible position={toolbox.position} align={toolbox.align} offset={toolbox.offset}>
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
          {menu.kind === 'items' && (
            <>
              {menu.ids.length === 1 && <ContextMenuItem onClick={() => onOpen(menu.ids[0]!)}>상세 열기</ContextMenuItem>}
              {edits && (
                <>
                  <ContextMenuItem onClick={() => void paste(menu.ids)}>복제</ContextMenuItem>
                  <ContextMenuItem onClick={() => copied.copy(menu.ids)}>
                    복사
                    <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.copy)}</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => {
                    selection.clear();
                    void edits.remove({ ids: menu.ids, lines: [] });
                  }}>
                    {menu.ids.length > 1 ? `삭제 (${labels.count(menu.ids.length)})` : '삭제'}
                    <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</ContextMenuShortcut>
                  </ContextMenuItem>
                </>
              )}
            </>
          )}
          {menu.kind === 'line' && (
            <>
              <ContextMenuItem onClick={() => onOpenLine(menu.line)}>상세 열기</ContextMenuItem>
              {edits && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => void edits.remove({ ids: [], lines: [menu.line] })}>
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
                  void edits.add().then((id) => id && place({ ...placedRef.current, [id]: at }));
                }}>{labels.add}</ContextMenuItem>
              )}
              {edits && pasteable().length > 0 && (
                <ContextMenuItem onClick={() => void paste(pasteable())}>
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
