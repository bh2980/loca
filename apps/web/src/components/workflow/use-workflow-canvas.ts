import { useMemo, useRef, useState } from 'react';
import { applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react';
import { type WorkflowGroup, type WorkflowIssue } from '@loca/shared';
import type { CanvasDirection } from '@loca/ui';
import { GRAPH_KEYS } from '@/lib/graph-shortcuts';
import { keyLabel } from '@/lib/keys';
import { retryBadge } from '@/lib/retry-info';
import { withConnection, withNodesMoved } from './definition-edits';
import { exitKey, parseExitKey } from './exit-marks';
import { NODE_SIZE } from './flow-canvas';
import { entryStarts, exitEdges, flowNodeCard, type FlowNames } from './flow-graph';
import { foldIssues, foldText, isFoldOpen, type Fold } from './fold';
import { fitFrames, frameAt, frameId, groupIdOf, groupOf, isFrameId, moveFrame, moveIntoGroup, type FrameNode } from './frames';
import type { FlowNode } from './node-view';
import type { WorkflowDraftState } from './use-workflow-draft';
import type { WorkflowEditing } from './use-workflow-editing';
import type { WorkflowSelection } from './use-workflow-selection';
import type { WorkflowView } from './use-workflow-view';
import type { FlowEdge } from './workflow-edge';

type Box = NonNullable<WorkflowGroup['box']>;

/**
 * The workflow as React Flow draws it in the editor, and what React Flow reports back: the node cards, the lines
 * and the frames built from the draft (with its issues and the selection on them), and its changes (a move, a
 * resize, a pick, a new line) turned into edits of the draft or of the selection.
 */
export function useWorkflowCanvas({ draft, selection, view, editing, direction, names }: {
  draft: WorkflowDraftState;
  selection: WorkflowSelection;
  view: WorkflowView;
  editing: WorkflowEditing;
  direction: CanvasDirection;
  names: FlowNames;
}) {
  const { current, issues, setDraft } = draft;
  const { search, select, selectExit, nodes: picked, edgeId, setEdgeId, hoveredEdgeId } = selection;
  const { measured, shown, shownIds, folds, foldState, drawn, frameBoxes, setFrozen, setResizing } = view;
  const issuesOf = (list: WorkflowIssue[], nodeId: string, level: WorkflowIssue['level']) => list.filter((issue) => issue.nodeId === nodeId && issue.level === level).map((issue) => issue.message);

  const nodes: FlowNode[] = useMemo(() => {
    if (!current) return [];
    const { entry, starts, label: startLabel } = entryStarts(current.definition, names.summary);
    const foldChip = (fold: Fold) => ({ text: foldText(current.definition, fold), open: isFoldOpen(foldState, fold.id), ...foldIssues(fold, issues), onToggle: () => view.toggleFoldOf(fold) });
    const pickedExit = parseExitKey(search.exit);
    return shown.map((node) => ({
      id: node.id,
      type: 'workflow',
      position: node.position,
      measured: measured[node.id],
      selected: picked.picked.size ? picked.picked.has(node.id) : node.id === search.node,
      deletable: true,
      data: {
        ...flowNodeCard(node, current.definition, direction, names),
        retry: retryBadge(current.definition, node),
        errors: issuesOf(issues, node.id, 'error'),
        warnings: issuesOf(issues, node.id, 'warning'),
        start: starts.has(node.id) && entry ? { label: startLabel, onOpen: () => select(entry.id) } : undefined,
        folds: Object.fromEntries(folds.filter((fold) => fold.owner === node.id).map((fold) => [fold.port, foldChip(fold)])),
        onOpenExit: (port: string) => selectExit(exitKey(node.id, port)),
        pickedExit: pickedExit?.nodeId === node.id ? pickedExit.port : undefined,
      },
    }));
  }, [shown, folds, foldState, current?.definition, search.node, search.exit, picked.picked, direction, issues, names, measured]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges: FlowEdge[] = useMemo(() => {
    if (!current || !drawn) return [];
    return exitEdges(drawn.definition, current.definition, names.marks, { selected: edgeId, hovered: hoveredEdgeId }).map(({ edge, key, exit, items }) => {
      const open = search.exit === key;
      // The picked exit's lines in the accent, all of them: the canvas says which exit the pane is about.
      const style = open ? { ...edge.style, stroke: 'var(--stroke-accent)', strokeWidth: 3 } : edge.style;
      const markerEnd = open && typeof edge.markerEnd === 'object' ? { ...edge.markerEnd, color: 'var(--stroke-accent)' } : edge.markerEnd;
      const data = { ...edge.data, hovered: edge.id === hoveredEdgeId, ...(items.length ? { tag: { items, exit, selected: open, onOpen: () => selectExit(key) } } : { onAdd: () => selectExit(key) }) };
      return { ...edge, style, markerEnd, data };
    });
  }, [drawn, edgeId, hoveredEdgeId, foldState, issues, search.exit, names]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frame nodes would join while they are dragged is marked, with what letting go will do.
  const [dropFrame, setDropFrame] = useState<string>();
  const [dropHint, setDropHint] = useState<string>();
  const frames: FrameNode[] = frameBoxes.map((frame) => {
    const groupId = groupIdOf(frame.id);
    return {
      ...frame,
      data: {
        ...frame.data,
        picked: search.frame === groupId,
        over: dropFrame === frame.id,
        renaming: editing.renamingFrame === groupId,
        onRename: (label: string) => editing.renameFrame(groupId, label),
        onRenamed: () => editing.setRenamingFrame(undefined),
        onUngroup: () => editing.ungroupFrame(groupId),
        onDelete: () => editing.deleteFrame(groupId),
        ungroupKey: keyLabel(GRAPH_KEYS.ungroup),
        onResize: (box: Box) => (setResizing(null), editing.resizeFrame(groupId, box)),
      },
    };
  });

  const onNodesChange = (allChanges: NodeChange<FlowNode | FrameNode>[]) => {
    // Dragging a frame's header moves it and its nodes by as much. Resizing it (no `dragging` on its moves) follows the
    // handle until let go (onResize stores the box).
    const frameMoves = allChanges.flatMap((change) => {
      if (change.type !== 'position' || !change.position || !isFrameId(change.id) || !('dragging' in change) || change.dragging === undefined) return [];
      const frame = frames.find((item) => item.id === change.id);
      return frame && (frame.position.x !== change.position.x || frame.position.y !== change.position.y) ? [{ groupId: groupIdOf(change.id), dx: change.position.x - frame.position.x, dy: change.position.y - frame.position.y }] : [];
    });
    if (frameMoves.length) setDraft((value) => ({ ...value, definition: frameMoves.reduce((definition, move) => moveFrame(definition, move.groupId, move.dx, move.dy, measured, shown), value.definition) }));
    // A resize reports the new corner (a move) and the new size together; both go into one box, or a move from the top or
    // left edge would be undone by the size that follows it.
    const resized = new Map<string, Partial<Box>>();
    for (const change of allChanges) {
      if (!('id' in change) || !isFrameId(change.id) || ('dragging' in change && change.dragging !== undefined)) continue;
      const part = resized.get(change.id) ?? {};
      if (change.type === 'dimensions' && change.resizing && change.dimensions) resized.set(change.id, { ...part, ...change.dimensions });
      else if (change.type === 'position' && change.position) resized.set(change.id, { ...part, ...change.position });
    }
    for (const [id, part] of resized) {
      const frame = frames.find((item) => item.id === id);
      if (!frame) continue;
      const base = { x: frame.position.x, y: frame.position.y, width: frame.width!, height: frame.height! };
      setResizing((before) => ({ groupId: groupIdOf(id), box: { ...(before?.groupId === groupIdOf(id) ? before.box : base), ...part } }));
    }
    const changes = allChanges.filter((change) => !('id' in change) || !isFrameId(change.id)) as NodeChange<FlowNode>[];
    view.recordSizes(changes);
    // React Flow re-reports a node's position while it renders even when it did not move; only a
    // real move should reach the draft (otherwise opening the editor looks like an unsaved edit).
    const moved = changes.filter((change) => {
      if (change.type !== 'position' || !change.position) return false;
      const node = nodes.find((item) => item.id === change.id);
      return !node || node.position.x !== change.position.x || node.position.y !== change.position.y;
    });
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    // A box or ⌘/Ctrl+click picks (ringed), even a single node; only a plain click (onNodeClick) opens its pane.
    const next = picked.apply(changes.flatMap((change) => (change.type === 'select' ? [{ id: change.id, selected: change.selected }] : [])));
    if (next?.size && search.node) select(undefined);
    if (!moved.length && !removed.length) return;
    if (removed.length) picked.clear();
    const placed = new Map(applyNodeChanges(moved, nodes).map((node) => [node.id, node.position]));
    // How far each dragged node went: its lines keep their shape and follow it (shiftRoute).
    const deltas = new Map(moved.flatMap((change) => {
      if (change.type !== 'position' || !change.position) return [];
      const before = nodes.find((item) => item.id === change.id)?.position;
      return before ? [[change.id, { dx: change.position.x - before.x, dy: change.position.y - before.y }] as const] : [];
    }));
    setDraft((value) => ({ ...value, definition: withNodesMoved(value.definition, placed, deltas, removed) }));
    if (removed.includes(search.node ?? '')) select(undefined);
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    for (const change of changes) if (change.type === 'select') setEdgeId(change.selected ? change.id : (now) => (now === change.id ? undefined : now));
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length) editing.removeEdges(removed);
  };
  const onConnect = (connection: Connection) => setDraft((value) => ({ ...value, definition: withConnection(value.definition, connection, `e-${crypto.randomUUID().slice(0, 8)}`) }));

  // Where a dragged node is let go says where it belongs, by where its middle is, as drawn: in a frame other than its
  // own, in that one; outside every frame, in none; in its own, as it was. The boxes are those from when the drag began.
  const dragBoxes = useRef<FrameNode[]>([]);
  const dropInto = (node: { id: string; position: { x: number; y: number } }) => {
    const size = measured[node.id] ?? NODE_SIZE;
    const over = frameAt(dragBoxes.current, { x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 });
    return over ? groupIdOf(over) : null;
  };
  const groups = current?.definition.groups;
  const frameName = (groupId: string) => groups?.find((group) => group.id === groupId)?.label || '이름 없는 프레임';
  const drag = {
    onNodeDragStart: (_event: unknown, node: { id: string }) => {
      if (isFrameId(node.id) || !groups?.length) return void (dragBoxes.current = []);
      dragBoxes.current = frameBoxes;
      setFrozen(new Map(frameBoxes.map((frame) => [groupIdOf(frame.id), { x: frame.position.x, y: frame.position.y, width: frame.width!, height: frame.height! }])));
    },
    onNodeDrag: (_event: unknown, node: { id: string; position: { x: number; y: number } }) => {
      if (!dragBoxes.current.length) return;
      const into = dropInto(node);
      const own = groupOf(groups, node.id);
      setDropFrame(into && into !== own ? frameId(into) : undefined);
      setDropHint(into && into !== own ? `'${frameName(into)}'에 넣기` : !into && own ? `'${frameName(own)}'에서 빼기` : undefined);
    },
    onNodeDragStop: (_event: unknown, node: { id: string; position: { x: number; y: number } }, dragged: { id: string }[]) => {
      setDropFrame(undefined);
      setDropHint(undefined);
      if (!dragBoxes.current.length) return;
      const into = dropInto(node);
      const ids = dragged.map((item) => item.id).filter((id) => !isFrameId(id));
      dragBoxes.current = [];
      setFrozen(null);
      const moves = ids.some((id) => groupOf(groups, id) !== (into ?? undefined));
      setDraft((value) => ({ ...value, definition: fitFrames(moves ? moveIntoGroup(value.definition, ids, into) : value.definition, measured, shownIds) }));
    },
  };

  return { nodes, edges, frames, onNodesChange, onEdgesChange, onConnect, drag, dropHint };
}

export type WorkflowCanvas = ReturnType<typeof useWorkflowCanvas>;
