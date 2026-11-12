import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { toast } from 'sonner';
import { exitActions, syncEntryEdges, withExitActions, workflowNodeSchema, type WorkflowDefinition, type WorkflowGroup, type WorkflowNode } from '@tw/shared';
import type { CanvasDirection } from '@loca/ui';
import { graphClipboard } from '@/lib/graph-clipboard';
import { useGraphShortcuts } from '@/lib/graph-shortcuts';
import { snapshotHistory } from '@/lib/undo-history';
import { workflowEdits } from '@/lib/workflow-edits';
import { COPY_OFFSET, copyNodes, editableIds, freeNodeId, withCopies, withoutEdges, withoutFrame, withoutNodes, type CopiedNodes } from './definition-edits';
import { exitKey } from './exit-marks';
import { addFrame, fitFrames, frameAt, groupIdOf, groupNodes, moveIntoGroup, renameGroup, resizeFrame, ungroup } from './frames';
import { exitActionItem, librarySeed, type NodeSeed } from './node-palette';
import type { WorkflowDraftState } from './use-workflow-draft';
import type { WorkflowSelection } from './use-workflow-selection';
import type { WorkflowView } from './use-workflow-view';

type Box = NonNullable<WorkflowGroup['box']>;
const DEFAULT_FRAME = { width: 360, height: 240 };
const shortId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Every change a person makes to the workflow from the canvas, its menus and its keys: nodes added from the library,
 * copied, pasted and deleted, lines deleted, frames made, moved into, taken apart and deleted, exit actions put on
 * an exit. Each is an edit of the draft (definition-edits.ts, frames.tsx say what it does to the definition) followed
 * by what the selection should be afterwards. Undo goes through lib/undo-history (every change is a step, a drag or
 * typing in a field one step until it pauses, across autosaves), with the keys every graph shares.
 */
export function useWorkflowEditing({ workflowId, draft, selection, view, direction }: { workflowId: string; draft: WorkflowDraftState; selection: WorkflowSelection; view: WorkflowView; direction: CanvasDirection }) {
  const flow = useReactFlow();
  const { current, setDraft } = draft;
  const { search, select, selectFrame, selectExit, nodes: picked, edgeId, setEdgeId, group } = selection;
  const { measured, shown, shownIds, frameBoxes } = view;
  const edit = (change: (definition: WorkflowDefinition) => WorkflowDefinition) => setDraft((value) => ({ ...value, definition: change(value.definition) }));
  const changeNode = (next: WorkflowNode) => edit((definition) => ({ ...definition, nodes: definition.nodes.map((node) => (node.id === next.id ? next : node)) }));

  // ── lines and nodes ────────────────────────────────────────────────────────────
  const removeEdges = (ids: string[]) => {
    edit((definition) => withoutEdges(definition, ids));
    setEdgeId(undefined);
  };
  /** Deletes nodes (no confirmation: the edit is an undoable draft); what is left of the picked set stays picked. */
  const deleteNodes = (ids: readonly string[]) => {
    if (!current) return;
    const doomed = editableIds(current.definition, ids);
    if (!doomed.size) return;
    edit((definition) => withoutNodes(definition, doomed));
    if (picked.picked.size) picked.set([...picked.picked].filter((id) => !doomed.has(id)));
    if (search.node && doomed.has(search.node)) select(undefined);
  };
  /** New nodes appear at the centre of the view, or where they were dropped (on a frame, they join that step). */
  const addNode = (seed: NodeSeed, prefix: string, drop?: { x: number; y: number }) => {
    const position = drop ?? flow.screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 });
    const id = freeNodeId(new Set(current?.definition.nodes.map((node) => node.id)), prefix);
    const node = workflowNodeSchema.parse({ id, position, config: {}, ...seed });
    const into = drop && frameAt(frameBoxes, { x: position.x + 20, y: position.y + 20 });
    edit((definition) => {
      // The first node added is where the workflow starts: the entry's lines follow in the same edit.
      const added = syncEntryEdges({ ...definition, nodes: [...definition.nodes, node] });
      return into ? fitFrames(moveIntoGroup(added, [id], groupIdOf(into)), measured, new Set([...shownIds, id])) : added;
    });
    select(id);
  };
  /** 복제 of one node: a copy beside it, opened. */
  const duplicateNode = (node: WorkflowNode) => addNode({ type: node.type, label: node.label, config: structuredClone(node.config) }, `${node.id}-copy`, { x: node.position.x + COPY_OFFSET, y: node.position.y });

  const clipboard = useMemo(() => graphClipboard<CopiedNodes>('workflow-nodes'), []);
  /** Puts copies beside their originals (new ids), with the lines among them, and picks the copies. */
  const pasteNodes = (copied: CopiedNodes) => {
    if (!current) return;
    const { copies } = withCopies(current.definition, copied, () => shortId('e'));
    if (!copies.length) return;
    edit((definition) => withCopies(definition, copied, () => shortId('e')).definition);
    picked.set(copies.length >= 2 ? copies : []);
    select(copies.length === 1 ? copies[0] : undefined);
  };
  /** Copies several nodes, keeping the lines that run between the copied nodes. */
  const duplicateNodes = (ids: readonly string[]) => current && pasteNodes(copyNodes(current.definition, ids));
  const copyPicked = () => {
    const copied = current && copyNodes(current.definition, picked.ids);
    if (!copied?.nodes.length) return false;
    clipboard.copy(copied);
    return true;
  };

  // ── frames ─────────────────────────────────────────────────────────────────────
  const [renamingFrame, setRenamingFrame] = useState<string>();
  /** 삭제: the frame and the nodes in it (and their lines), as Figma deletes a section with its contents. One edit (one undo). */
  const deleteFrame = (groupId: string) => {
    if (!current?.definition.groups?.some((item) => item.id === groupId)) return;
    const { removed } = withoutFrame(current.definition, groupId);
    edit((definition) => withoutFrame(definition, groupId).definition);
    picked.clear();
    if (search.frame === groupId || (search.node && removed.has(search.node))) select(undefined);
  };
  /** 프레임만 삭제: the frame goes, its nodes stay where they are. */
  const ungroupFrame = (groupId: string) => {
    edit((definition) => ungroup(definition, groupId));
    if (search.frame === groupId) selectFrame(undefined);
  };
  /** A frame just made is picked, with its name being typed. */
  const openNewFrame = (groupId: string) => {
    picked.clear();
    selectFrame(groupId);
    setRenamingFrame(groupId);
  };
  /** A new frame around nodes. */
  const groupPicked = (ids: string[]) => {
    if (!ids.length) return;
    const groupId = shortId('g');
    edit((definition) => groupNodes(definition, ids, measured, '새 단계', groupId).definition);
    openNewFrame(groupId);
  };
  // '＋ 프레임' with nodes picked frames them; with none it lets the canvas draw one (a press adds one at that point).
  const [drawingFrame, setDrawingFrame] = useState(false);
  const createFrame = (box: Box) => {
    const groupId = shortId('g');
    edit((definition) => addFrame(definition, box, measured, shownIds, direction, '새 단계', groupId).definition);
    setDrawingFrame(false);
    openNewFrame(groupId);
  };
  const frameAtScreen = (x: number, y: number) => {
    const at = flow.screenToFlowPosition({ x, y });
    return { x: Math.round(at.x), y: Math.round(at.y), ...DEFAULT_FRAME };
  };

  // ── exit actions ───────────────────────────────────────────────────────────────
  // An exit action picked from '＋ 노드', waiting for the line to go on (Esc lets it go).
  const [pickingExit, setPickingExit] = useState<string>();
  useEffect(() => {
    if (!pickingExit) return;
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setPickingExit(undefined);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [pickingExit]);
  /** Puts a new action of the kind `itemId` on the exit and opens it, its fields first. */
  const addExitAction = (nodeId: string, port: string, itemId: string) => {
    const item = exitActionItem(itemId);
    setPickingExit(undefined);
    if (!item) return;
    edit((definition) => ({ ...definition, nodes: definition.nodes.map((node) => (node.id === nodeId ? withExitActions(node, port, [...exitActions(node, port), item.make()]) : node)) }));
    selectExit(exitKey(nodeId, port));
  };

  // ── undo, and the keys every graph shares ──────────────────────────────────────
  const restore = useRef<(snapshot: string) => void>(() => undefined);
  restore.current = (snapshot) => {
    const { name, definition } = JSON.parse(snapshot) as { name: string; definition: WorkflowDefinition };
    setDraft((value) => ({ ...value, name, definition }));
    // A selection of a node the restored workflow does not have goes with it.
    selection.keepOnly(definition);
  };
  const [history] = useState(() => snapshotHistory<string>({ apply: (snapshot) => restore.current(snapshot) }));
  const snapshot = current ? JSON.stringify({ name: current.name, definition: current.definition }) : undefined;
  useEffect(() => {
    if (snapshot !== undefined) history.seen(snapshot);
  }, [snapshot, history]);
  useGraphShortcuts(
    {
      undo: () => void history.undo(),
      redo: () => void history.redo(),
      copy: () => void (copyPicked() && toast.success(`노드 ${picked.ids.length}개를 복사했습니다.`)),
      cut: () => void (copyPicked() && deleteNodes(picked.ids)),
      paste: () => {
        const copied = clipboard.read();
        if (copied) pasteNodes(copied);
      },
      // Delete: the selected line, else the picked frame (with nothing else picked), else the picked nodes.
      remove: () => (edgeId ? removeEdges([edgeId]) : group && !picked.ids.length ? deleteFrame(group.id) : deleteNodes(picked.ids)),
      ungroup: () => (group && !picked.ids.length ? ungroupFrame(group.id) : undefined),
    },
    Boolean(current),
  );

  // Node edits proposed in the chat land in the draft; bumping the revision remounts the
  // config pane so its local text state (condition JSON, ports) shows the new values.
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      workflowEdits.register(workflowId, (proposed) => {
        const node = current?.definition.nodes.find((candidate) => candidate.id === proposed.nodeId);
        if (!node) return `노드 "${proposed.nodeId}"를 찾을 수 없습니다.`;
        let next: WorkflowNode;
        if (proposed.field === 'instructions' && node.type === 'ai') next = { ...node, config: { ...node.config, instructions: String(proposed.value ?? '') } } as WorkflowNode;
        else if (proposed.field === 'expression' && node.type === 'condition') next = { ...node, config: { expression: proposed.value, description: proposed.description || node.config.description } };
        else if (proposed.field === 'code' && node.type === 'function' && node.config.fn === 'script') next = { ...node, config: { ...node.config, params: { ...node.config.params, code: String(proposed.value ?? '') } } };
        else return '이 노드에는 해당 항목이 없습니다.';
        // The lines keep their routes: one that no longer meets its node's ports is drawn plainly (routeMatchesPorts).
        changeNode(next);
        setRevision((value) => value + 1);
        select(node.id);
        return null;
      }),
    [workflowId, current, setDraft], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    edit,
    changeNode,
    rename: (name: string) => setDraft((value) => ({ ...value, name })),
    changeSettings: (settings: WorkflowDefinition['settings']) => edit((definition) => ({ ...definition, settings })),
    removeEdges,
    deleteNodes,
    addNode,
    /** Adds what a library entry stands for: an exit action waits for its line, anything else is a node. */
    addFromLibrary: (id: string, position?: { x: number; y: number }) => {
      if (exitActionItem(id)) return setPickingExit(id);
      const seed = current && librarySeed(id, current.definition);
      if (seed) addNode(seed, id, position);
    },
    duplicateNode,
    duplicateNodes,
    // frames
    renamingFrame,
    setRenamingFrame,
    renameFrame: (groupId: string, label: string) => edit((definition) => renameGroup(definition, groupId, label)),
    resizeFrame: (groupId: string, box: Box) => edit((definition) => resizeFrame(definition, groupId, box, measured, shownIds)),
    deleteFrame,
    ungroupFrame,
    groupPicked,
    /** The menu items that move nodes between frames: into one (null: out of theirs), each frame fitted again. */
    moveToFrame: (ids: string[], groupId: string | null) => edit((definition) => fitFrames(moveIntoGroup(definition, ids, groupId), measured, shownIds)),
    drawingFrame,
    stopDrawingFrame: () => setDrawingFrame(false),
    createFrame,
    frameAtScreen,
    /** A box drawn on the canvas (screen pixels); a press without a drag adds a frame of the usual size there. */
    drawFrame: (box: { x: number; y: number; width: number; height: number }) => {
      if (!box.width && !box.height) return createFrame(frameAtScreen(box.x, box.y));
      const from = flow.screenToFlowPosition({ x: box.x, y: box.y });
      const to = flow.screenToFlowPosition({ x: box.x + box.width, y: box.y + box.height });
      createFrame({ x: Math.round(from.x), y: Math.round(from.y), width: Math.max(200, Math.round(to.x - from.x)), height: Math.max(120, Math.round(to.y - from.y)) });
    },
    addFramePressed: () => {
      const ids = [...picked.picked].filter((id) => shown.some((node) => node.id === id));
      if (ids.length) return groupPicked(ids);
      setDrawingFrame((value) => !value);
    },
    // exit actions
    pickingExit,
    setPickingExit,
    addExitAction,
    /** Bumped when the chat changed a node: the config pane is mounted again to show it. */
    revision,
  };
}

export type WorkflowEditing = ReturnType<typeof useWorkflowEditing>;
