import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  Panel,
  MiniMap,
  NodeToolbar,
  Position,
  SelectionMode,
  useViewport,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeftRight, ArrowUpDown, ChevronRight, Copy, Focus, Frame, Group, LayoutGrid, LogOut, Maximize, Pencil, Plus, SlidersHorizontal, Trash2, Ungroup, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { AI_PRESETS, APPLY_PALETTE_ORDER, INPUT_TYPES, NODE_TYPES, type BatchConfig, functionGroup, APPLY_TARGETS, FUNCTIONS, FUNCTION_NAMES, functionTakes, presetTakes, workflowInput, PALETTE_FUNCTION_NAMES, nodeName, nodePorts, syncEntryEdges, workflowNodeSchema, type FunctionName, type WorkflowDefinition, type WorkflowGroup, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { Page, StatusBarItem } from '@/components/page';
import { autoLayout } from '@/components/workflow/auto-layout';
import { WorkflowSettings } from '@/components/workflow/workflow-settings';
import { NodeConfig } from '@/components/workflow/node-config';
import { WorkflowNodeView, type FlowNode } from '@/components/workflow/node-view';
import { WorkflowEdgeView, type FlowEdge } from '@/components/workflow/workflow-edge';
import { entryStarts, flowEdges, nodeBadge, nodeSummary, openPorts, targetStatus } from '@/components/workflow/flow-graph';
import { allFoldsOpen, computeFolds, foldContaining, foldedDefinition, foldIssues, foldPlacements, foldText, isFoldOpen, lineMarks, openFoldContaining, setAllFolds, toggleFold, type Fold } from '@/components/workflow/fold';
import { useFoldState } from '@/components/workflow/use-fold-state';
import { WorkflowIssueBar } from '@/components/workflow/issue-bar';
import { FrameNodeView, FrameTintView, frameTints, addFrame, fitFrames, frameAt, frameId, frameNodes, groupIdOf, groupNodes, groupOf, isFrameId, moveFrame, moveIntoGroup, pruneGroups, renameGroup, resizeFrame, ungroup, type FrameNode } from '@/components/workflow/frames';
import { FramePanel } from '@/components/workflow/frame-panel';
import { retryBadge } from '@/lib/retry-info';
import { RunDialog } from '@/components/workflow/run-dialog';
import { SplitPane, PageHeading, HeaderActions, NodeLibrary, CanvasToolbar, EdgeLegend, CanvasSurface, CanvasDrawLayer, SelectionToolbox, type CanvasDirection, type NodeLibraryGroup, Box, Button, Icon, Inline, Stack, Text, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuLabel, Input, Skeleton, Popover, PopoverContent, PopoverTrigger } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { tagsIn } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { workflowEdits } from '@/lib/workflow-edits';
import { sameWorkflowDraft, reconcileSavedDraft, normalizeWorkflowDraft } from '@/lib/workflow-draft';
import { dateTime } from '@/lib/datetime';
import { useIsDark } from '@/lib/theme';
import { GRAPH_KEYS, useGraphShortcuts, type GraphShortcuts } from '@/lib/graph-shortcuts';
import { keyLabel } from '@/lib/keys';
import { useTaxonomy } from '@/lib/knowledge';
import { useRuns } from '@/lib/runs';
import { useWorkflow, useWorkflows } from '@/lib/workflows';
import { sent as sentToFeed } from '@/lib/collections';
import { useConnections } from '@/lib/app-data';

/** When the workflow was last saved: 10. 13. 오전 06:16. Runs keep their own copy of what they ran. */
const savedAt = (at: string) => dateTime(at);

/**
 * The workflow's name reads as a title; the pencil turns it into an ordinary field (Enter or
 * leaving keeps it, Esc puts it back). The rename is part of the unsaved edit like any other.
 */
function NameField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  // Esc closes the field, and the blur that follows must not keep what was typed.
  const cancelled = useRef(false);
  const done = (keep: boolean) => {
    if (!keep) cancelled.current = true;
    if (keep && !cancelled.current && editing?.trim() && editing.trim() !== name) onRename(editing.trim());
    setEditing(null);
  };
  if (editing !== null)
    return (
      <Box asChild height="control" width="menu-lg">
      <Input
        autoFocus
        value={editing}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(event) => (event.key === 'Enter' ? done(true) : event.key === 'Escape' && done(false))}
        aria-label="워크플로 이름"
      />
      </Box>
    );
  return (
    <Inline as="span" minWidth={0} gap="hair">
      <Text truncate weight="medium" tone="default">{name}</Text>
      <Button variant="ghost" size="icon-xs" aria-label="이름 바꾸기" onClick={() => ((cancelled.current = false), setEditing(name))}>
        <Pencil />
      </Button>
    </Inline>
  );
}

/** A preset as the palette reads it: label/description for the list, the rest is the AI node config it fills. */
type PresetEntry = { label: string; description?: string; output: string; inputs?: readonly ('lines' | 'terms')[] } & Record<string, unknown>;

/** Nodes copied with ⌘/Ctrl+C or X, with the lines among them: pasted into this or another workflow. */
interface GraphClipboard {
  nodes: WorkflowNode[];
  edges: WorkflowDefinition['edges'];
}
let graphClipboard: GraphClipboard | null = null;

export const Route = createFileRoute('/p/$projectId/workflows/$workflowId')({
  validateSearch: (raw: Record<string, unknown>): { node?: string; frame?: string; direction?: CanvasDirection } => ({
    node: typeof raw.node === 'string' ? raw.node : undefined,
    // A picked frame (its pane opens); a node and a frame are not picked at once.
    frame: typeof raw.frame === 'string' && typeof raw.node !== 'string' ? raw.frame : undefined,
    direction: raw.direction === 'horizontal' ? 'horizontal' : raw.direction === 'vertical' ? 'vertical' : undefined,
  }),
  component: WorkflowRoute,
});
function WorkflowRoute() {
  const { workflowId } = Route.useParams();
  return <ReactFlowProvider key={workflowId}><WorkflowEditor /></ReactFlowProvider>;
}

interface Draft {
  baseVersion: number;
  name: string;
  definition: WorkflowDefinition;
}

const draftKey = (id: string) => `tw.workflow.draft.${id}`;
const readDraft = (id: string): Draft | null => {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey(id)) ?? 'null');
  } catch {
    return null;
  }
};

const nodeTypes = { workflow: WorkflowNodeView, frame: FrameNodeView, frameTint: FrameTintView };
const edgeTypes = { workflow: WorkflowEdgeView };
const viewportKey = (id: string, direction: CanvasDirection) => `loca.workflow.viewport.${id}.${direction}`;
function readViewport(id: string, direction: CanvasDirection): { x: number; y: number; zoom: number } | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(viewportKey(id, direction)) ?? 'null');
    return value && [value.x, value.y, value.zoom].every(Number.isFinite) && value.zoom > 0 ? value : undefined;
  } catch { return undefined; }
}

function WorkflowEditor() {
  const dark = useIsDark();
  const { projectId, workflowId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const { zoom } = useViewport();
  const [minimap, setMinimap] = useState(false);
  const workflow = useWorkflow(projectId, workflowId);
  const taxonomy = useTaxonomy(projectId);
  const connections = useConnections({ kind: 'project', projectId });
  const runs = useRuns(projectId);
  const workflows = useWorkflows(projectId);
  const activeRun = runs.data?.find((run) => run.workflowId === workflowId && (run.status === 'running' || run.status === 'paused'));

  // The draft survives navigation and reloads; it is dropped only on save or explicit discard.
  const [draft, setDraftState] = useState<Draft | null>(() => readDraft(workflowId));
  const inFlight = useRef<Draft | null>(null);
  const setDraft = useCallback(
    (update: (current: Draft) => Draft) =>
      setDraftState((current) => {
        const base = current ?? (workflow.data ? { baseVersion: workflow.data.version, name: workflow.data.name, definition: workflow.data.definition } : null);
        if (!base) return current;
        const next = update(base);
        // React Flow reports no-op position changes while it renders; an edit equal to the saved
        // version (or to the current draft) is not a change and must not mark the workflow dirty.
        const saved = workflow.data && { baseVersion: workflow.data.version, name: workflow.data.name, definition: workflow.data.definition };
        if (!normalizeWorkflowDraft(next, saved, inFlight.current)) {
          sessionStorage.removeItem(draftKey(workflowId));
          return null;
        }
        if (sameWorkflowDraft(next, base)) return current;
        sessionStorage.setItem(draftKey(workflowId), JSON.stringify(next));
        return next;
      }),
    [workflow.data, workflowId],
  );
  const discard = () => {
    sessionStorage.removeItem(draftKey(workflowId));
    setDraftState(null);
  };

  const saved = workflow.data && { baseVersion: workflow.data.version, name: workflow.data.name, definition: workflow.data.definition };
  const current = draft ?? saved;
  const direction: CanvasDirection = search.direction ?? current?.definition.direction ?? 'vertical';
  const stale = Boolean(draft && workflow.data && draft.baseVersion !== workflow.data.version);

  // Validate the draft on the server (same rules as run start), debounced.
  const [issues, setIssues] = useState<WorkflowIssue[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // The selected line (for Delete/Backspace and the "선 삭제" button); edges are rebuilt from the
  // definition, so their selection is kept here.
  const [edgeId, setEdgeId] = useState<string>();
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>();
  // A box selection of 2+ nodes. One selected node lives in the URL (?node=) and opens its config pane;
  // a group has no pane, so it is kept here and only exists while two or more are selected.
  const [multi, setMulti] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'node'; node: WorkflowNode; x: number; y: number }
    | { kind: 'nodes'; ids: string[]; x: number; y: number }
    | { kind: 'edge'; edgeId: string; x: number; y: number }
    | { kind: 'pane'; x: number; y: number }
    | null
  >(null);
  useEffect(() => {
    if (!current) return;
    if (!draft) return setIssues(workflow.data?.issues ?? []);
    let cancelled = false;
    const timer = setTimeout(() => {
      void unwrap(client.workflows[':id'].validate.$post({ param: { id: workflowId }, json: { definition: current.definition } }))
        .then((result) => { if (!cancelled) setIssues(result); })
        .catch(() => undefined);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [current?.definition, draft, workflow.data, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (sent: Draft) => {
      inFlight.current = sent;
      // Done once the feed has brought the saved row, so its version is the one the draft now builds on.
      return sentToFeed(projectId, client.workflows[':id'].$put({ param: { id: workflowId }, json: { name: sent.name, description: workflow.data!.description, definition: sent.definition, version: sent.baseVersion } }));
    },
    onSettled: () => { inFlight.current = null; },
    onSuccess: (row, sent) => {
      setDraftState((latest) => {
        const next = reconcileSavedDraft(latest, sent, row.version);
        if (next) sessionStorage.setItem(draftKey(workflowId), JSON.stringify(next));
        else sessionStorage.removeItem(draftKey(workflowId));
        return next;
      });
      setIssues(row.issues);
    },
  });
  // While a run uses this workflow the server refuses changes: the draft waits here and saves once it ends.
  const running = Boolean(activeRun);
  useEffect(() => {
    if (!draft || stale || running || save.isPending || save.isError) return;
    const timer = setTimeout(() => save.mutate(draft), 800);
    return () => clearTimeout(timer);
  }, [draft, stale, running, save.isPending, save.isError, save.mutate]);

  // A new AI node starts with the model the workflow already uses, else none: validation asks for one.
  const newNodeModel = () => {
    const used = current?.definition.nodes.find((node) => node.type === 'ai' && node.config.model.model);
    return used?.type === 'ai' ? used.config.model : { connectionId: '', model: '' };
  };
  const summaryNames = { status: new Map(taxonomy.statuses?.map((status) => [status.id, status.name])), connection: new Map(connections.data?.map((connection) => [connection.id, connection.name])), connectionsLoaded: Boolean(connections.data), workflows: workflows.data };
  const summary = (node: WorkflowNode) => (current ? nodeSummary(node, current.definition, summaryNames) : '');

  // React Flow measures each node and reports it as a 'dimensions' change; nodes rebuilt without
  // those sizes stay hidden (and their edges undrawn) until measured again, which never happens
  // when the size did not change. So the sizes are kept here and put back on every rebuild.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  // Another workflow reuses node ids ("entry", "translate") with other sizes.
  useEffect(() => setMeasured({}), [workflowId]);
  const definitions = useMemo(
    () => (current?.definition.nodes ?? []).filter((node) => node.type !== 'entry' && node.type !== 'end'),
    [current?.definition.nodes],
  );
  // 접기: nodes that only hang off another node are chips until opened (display only; the definition is whole).
  const folds = useMemo(() => (current ? computeFolds(current.definition) : []), [current?.definition]); // eslint-disable-line react-hooks/exhaustive-deps
  const [foldState, setFoldState] = useFoldState(`loca.workflow.folds.${workflowId}`);
  const openFolds = useMemo(() => new Set(foldState.open), [foldState]);
  const view = useMemo(() => (current ? foldedDefinition(current.definition, folds, openFolds) : undefined), [current?.definition, folds, openFolds]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (view?.definition.nodes ?? []).filter((node) => node.type !== 'entry' && node.type !== 'end'), [view]);
  // A fold that just opened gets places that clear the visible nodes, written to the draft once: from
  // then on its nodes sit where they are stored, so dragging them (or their owner) never snaps back.
  // Folds already open when the editor loads were placed when they were opened: opening the editor is no edit.
  const placedOpen = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!current) return;
    const before = placedOpen.current;
    placedOpen.current = openFolds;
    if (!before) return;
    const opened = new Set([...openFolds].filter((id) => !before.has(id)));
    if (!opened.size) return;
    const placed = foldPlacements(current.definition, folds.filter((fold) => opened.has(fold.id)), opened, new Map(Object.entries(measured)), direction);
    if (!placed.size) return;
    setDraft((value) => ({
      ...value,
      definition: { ...value.definition, nodes: value.definition.nodes.map((node) => (placed.has(node.id) ? { ...node, position: placed.get(node.id)! } : node)) },
    }));
  }, [openFolds, folds]); // eslint-disable-line react-hooks/exhaustive-deps
  const foldNames = useMemo(() => ({ status: summaryNames.status }), [taxonomy.statuses]); // eslint-disable-line react-hooks/exhaustive-deps
  const markNames = useMemo(() => ({ tags: new Map(taxonomy.tags?.map((tag) => [tag.id, tag])), statuses: new Map(taxonomy.statuses?.map((status) => [status.id, status])) }), [taxonomy.tags, taxonomy.statuses]);
  const foldChip = (fold: Fold) => current && {
    text: foldText(current.definition, fold, foldNames),
    open: isFoldOpen(foldState, fold.id),
    ...foldIssues(fold, issues),
    onToggle: () => toggleFoldOf(fold),
  };
  /** Folding a fold that holds the open node or the picked ones puts the selection away with them. */
  const toggleFoldOf = (fold: Fold) => {
    setFoldState((state) => toggleFold(state, fold.id));
    if (isFoldOpen(foldState, fold.id)) {
      if (search.node && fold.nodeIds.includes(search.node)) select(undefined);
      setMulti((ids) => ids.filter((id) => !fold.nodeIds.includes(id)));
    }
  };
  // Selecting a folded node (?node=, search, an issue) shows it.
  useEffect(() => setFoldState((state) => openFoldContaining(state, folds, search.node)), [search.node, folds, setFoldState]);
  const nodes: FlowNode[] = useMemo(
    () => {
      if (!current) return [];
      const { entry, starts, label: startLabel } = entryStarts(current.definition, summaryNames);
      return shown.map((node) => ({
        id: node.id,
        type: 'workflow',
        position: node.position,
        measured: measured[node.id],
        selected: multi.length ? multi.includes(node.id) : node.id === search.node,
        deletable: true,
        data: {
          node,
          direction,
          summary: summary(node),
          badge: nodeBadge(node, summaryNames),
          retry: retryBadge(current.definition, node),
          errors: issues.filter((issue) => issue.nodeId === node.id && issue.level === 'error').map((issue) => issue.message),
          warnings: issues.filter((issue) => issue.nodeId === node.id && issue.level === 'warning').map((issue) => issue.message),
          start: starts.has(node.id) && entry ? { label: startLabel, onOpen: () => select(entry.id) } : undefined,
          open: openPorts(node, current.definition),
          status: targetStatus(node, taxonomy.statuses),
          folds: Object.fromEntries(folds.filter((fold) => fold.kind === 'branch' && fold.owner === node.id).flatMap((fold) => [[fold.port, foldChip(fold)!]])),
          foldClose: (() => { const fold = folds.find((item) => item.kind === 'edge' && item.nodeIds[0] === node.id && isFoldOpen(foldState, item.id)); return fold && (() => toggleFoldOf(fold)); })(),
        },
      }));
    },
    [shown, folds, foldState, current?.definition, search.node, multi, direction, issues, taxonomy.statuses, connections.data, measured], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // The steps the workflow stores, drawn as boxes behind the nodes. While nodes are dragged the boxes stand still
  // (frozen), and the frame they would join is marked; while one is resized it follows the handle (resizing).
  const [dropFrame, setDropFrame] = useState<string>();
  const [dropHint, setDropHint] = useState<string>();
  const [renamingFrame, setRenamingFrame] = useState<string>();
  const [frozen, setFrozen] = useState<Map<string, NonNullable<WorkflowGroup['box']>> | null>(null);
  const [resizing, setResizing] = useState<{ groupId: string; box: NonNullable<WorkflowGroup['box']> } | null>(null);
  const standing = useMemo(() => (resizing ? new Map([...(frozen ?? []), [resizing.groupId, resizing.box]]) : frozen ?? undefined), [frozen, resizing]);
  const frameBoxes = useMemo(() => frameNodes(shown, current?.definition.groups, measured, undefined, standing), [shown, current?.definition.groups, measured, standing]);
  const pickedGroup = current?.definition.groups?.find((group) => group.id === search.frame);
  // The nodes on the canvas: a folded one keeps a position it is not drawn at, so only these size a frame.
  const shownIds = useMemo(() => new Set(shown.map((node) => node.id)), [shown]);
  const frames: FrameNode[] = frameBoxes.map((frame) => {
    const groupId = groupIdOf(frame.id);
    return {
      ...frame,
      data: {
        ...frame.data,
        picked: search.frame === groupId,
        over: dropFrame === frame.id,
        renaming: renamingFrame === groupId,
        onRename: (label: string) => setDraft((value) => ({ ...value, definition: renameGroup(value.definition, groupId, label) })),
        onRenamed: () => setRenamingFrame(undefined),
        onUngroup: () => ungroupFrame(groupId),
        onDelete: () => deleteFrame(groupId),
        ungroupKey: keyLabel(GRAPH_KEYS.ungroup),
        onResize: (box: NonNullable<WorkflowGroup['box']>) => (setResizing(null), setDraft((value) => ({ ...value, definition: resizeFrame(value.definition, groupId, box, measured, shownIds) }))),
      },
    };
  });
  const selectFrame = (groupId: string | undefined) => void navigate({ search: (previous) => ({ ...previous, node: undefined, frame: groupId }) });
  /** 삭제: the frame and the nodes in it (and their lines), as Figma deletes a section with its contents. One edit (one undo). */
  const deleteFrame = (groupId: string) => {
    const group = current?.definition.groups?.find((item) => item.id === groupId);
    if (!group) return;
    const doomed = new Set(group.nodeIds.filter((id) => current?.definition.nodes.find((node) => node.id === id)?.type !== 'entry'));
    setDraft((value) => ({
      ...value,
      definition: syncEntryEdges({
        ...value.definition,
        nodes: value.definition.nodes.filter((node) => !doomed.has(node.id)),
        edges: value.definition.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
        groups: (value.definition.groups ?? []).filter((item) => item.id !== groupId).map((item) => ({ ...item, nodeIds: item.nodeIds.filter((id) => !doomed.has(id)) })),
      }),
    }));
    setMulti([]);
    if (search.frame === groupId || (search.node && doomed.has(search.node))) select(undefined);
    setContextMenu(null);
  };
  /** 프레임만 삭제: the frame goes, its nodes stay where they are. */
  const ungroupFrame = (groupId: string) => {
    setDraft((value) => ({ ...value, definition: ungroup(value.definition, groupId) }));
    if (search.frame === groupId) selectFrame(undefined);
    setContextMenu(null);
  };
  /** A new frame around the picked nodes: it is picked, with its name being typed. */
  const groupPicked = (ids: string[]) => {
    if (!ids.length) return;
    const groupId = `g-${crypto.randomUUID().slice(0, 8)}`;
    setDraft((value) => ({ ...value, definition: groupNodes(value.definition, ids, measured, '새 단계', groupId).definition }));
    setMulti([]);
    selectFrame(groupId);
    setRenamingFrame(groupId);
    setContextMenu(null);
  };
  // '＋ 프레임' with nodes picked frames them; with none it lets the canvas draw one (a press adds one at that point).
  const [drawingFrame, setDrawingFrame] = useState(false);
  const DEFAULT_FRAME = { width: 360, height: 240 };
  const createFrame = (box: NonNullable<WorkflowGroup['box']>) => {
    const groupId = `g-${crypto.randomUUID().slice(0, 8)}`;
    setDraft((value) => ({ ...value, definition: addFrame(value.definition, box, measured, shownIds, direction, '새 단계', groupId).definition }));
    setDrawingFrame(false);
    setMulti([]);
    selectFrame(groupId);
    setRenamingFrame(groupId);
    setContextMenu(null);
  };
  const frameAtScreen = (x: number, y: number) => {
    const at = flow.screenToFlowPosition({ x, y });
    return { x: Math.round(at.x), y: Math.round(at.y), ...DEFAULT_FRAME };
  };
  const drawFrame = (box: { x: number; y: number; width: number; height: number }) => {
    if (!box.width && !box.height) return createFrame(frameAtScreen(box.x, box.y));
    const from = flow.screenToFlowPosition({ x: box.x, y: box.y });
    const to = flow.screenToFlowPosition({ x: box.x + box.width, y: box.y + box.height });
    createFrame({ x: Math.round(from.x), y: Math.round(from.y), width: Math.max(200, Math.round(to.x - from.x)), height: Math.max(120, Math.round(to.y - from.y)) });
  };
  const addFramePressed = () => {
    const picked = multi.filter((id) => shown.some((node) => node.id === id));
    if (picked.length) return groupPicked(picked);
    setDrawingFrame((value) => !value);
  };
  /** The menu items that move nodes between frames: into another one, or out of theirs. */
  const frameMenu = (ids: string[]) => {
    const groups = current?.definition.groups ?? [];
    const own = new Set(ids.map((id) => groupOf(groups, id)));
    const others = groups.filter((group) => !(own.size === 1 && own.has(group.id)));
    return (
      <>
        {others.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon icon={Frame} size="sm" />
              <span>프레임으로 옮기기</span>
            </DropdownMenuSubTrigger>
            <Box asChild width="menu">
            <DropdownMenuSubContent>
              {others.map((group) => (
                <DropdownMenuItem key={group.id} onSelect={() => moveToFrame(ids, group.id)}>
                  <Text truncate>{group.label || '이름 없는 프레임'}</Text>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
            </Box>
          </DropdownMenuSub>
        )}
        {[...own].some(Boolean) && (
          <DropdownMenuItem onSelect={() => moveToFrame(ids, null)}>
            <Icon icon={LogOut} size="sm" />
            <span>프레임에서 빼기</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
      </>
    );
  };
  const moveToFrame = (ids: string[], groupId: string | null) => (setDraft((value) => ({ ...value, definition: fitFrames(moveIntoGroup(value.definition, ids, groupId), measured, shownIds) })), setContextMenu(null));
  // Where a dragged node is let go says where it belongs, by where its middle is, as drawn: in a frame other than its
  // own, in that one; outside every frame, in none; in its own, as it was. The boxes are those from when the drag began.
  const dragBoxes = useRef<FrameNode[]>([]);
  const dropInto = (node: { id: string; position: { x: number; y: number } }) => {
    const size = measured[node.id] ?? { width: 224, height: 66 };
    const over = frameAt(dragBoxes.current, { x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 });
    return over ? groupIdOf(over) : null;
  };
  const edges: FlowEdge[] = useMemo(
    () => {
      if (!current || !view) return [];
      // A closed tag fold is one line with a chip on it (it keeps the id of the line into the tag node).
      const chips = new Map(view.closed.filter((fold) => fold.kind === 'edge').map((fold) => [fold.edgeId, fold] as const));
      return flowEdges(view.definition, { selected: edgeId, hovered: hoveredEdgeId }).map((edge) => {
        const fold = chips.get(edge.id);
        return fold ? { ...edge, data: { ...edge.data, fold: foldChip(fold), marks: lineMarks(current.definition, fold, markNames), onMark: (id: string) => select(id) } } : edge;
      });
    },
    [view, edgeId, hoveredEdgeId, foldState, issues, taxonomy.statuses, taxonomy.tags], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const select = (id: string | undefined) => void navigate({ search: (previous) => ({ ...previous, node: id, frame: undefined }) });
  const selected = current?.definition.nodes.find((node) => node.id === search.node);
  useReportView('workflow', [
    workflow.data && { kind: '워크플로', id: workflow.data.id, label: workflow.data.name },
    selected && { kind: '워크플로 노드', id: selected.id, label: `${nodeName(selected)} (${selected.type})`, detail: `저장 전 설정: ${JSON.stringify(selected.config).slice(0, 5000)}` },
    pickedGroup && { kind: '워크플로 프레임', id: pickedGroup.id, label: pickedGroup.label || '이름 없는 프레임', detail: `노드: ${pickedGroup.nodeIds.join(', ')}` },
  ]);

  // Node edits proposed in the chat land in the draft; bumping the revision remounts the
  // config pane so its local text state (condition JSON, ports) shows the new values.
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      workflowEdits.register(workflowId, (edit) => {
        const node = current?.definition.nodes.find((candidate) => candidate.id === edit.nodeId);
        if (!node) return `노드 "${edit.nodeId}"를 찾을 수 없습니다.`;
        let next: WorkflowNode;
        if (edit.field === 'instructions' && node.type === 'ai') next = { ...node, config: { ...node.config, instructions: String(edit.value ?? '') } } as WorkflowNode;
        else if (edit.field === 'expression' && node.type === 'condition') next = { ...node, config: { expression: edit.value, description: edit.description || node.config.description } };
        else if (edit.field === 'code' && node.type === 'function' && node.config.fn === 'script') next = { ...node, config: { ...node.config, params: { ...node.config.params, code: String(edit.value ?? '') } } };
        else return '이 노드에는 해당 항목이 없습니다.';
        setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: value.definition.nodes.map((candidate) => (candidate.id === node.id ? next : candidate)), edges: value.definition.edges.map((edge) => ({ ...edge, layout: undefined })) } }));
        setRevision((value) => value + 1);
        select(node.id);
        return null;
      }),
    [workflowId, current, setDraft], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
    const resized = new Map<string, Partial<NonNullable<WorkflowGroup['box']>>>();
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
    const sized = changes.filter((change) => change.type === 'dimensions' && change.dimensions);
    if (sized.length)
      setMeasured((previous) => {
        const next = { ...previous };
        for (const change of sized) if (change.type === 'dimensions' && change.dimensions) next[change.id] = change.dimensions;
        return next;
      });
    // React Flow re-reports a node's position while it renders even when it did not move; only a
    // real move should reach the draft (otherwise opening the editor looks like an unsaved edit).
    const moved = changes.filter((change) => {
      if (change.type !== 'position' || !change.position) return false;
      const node = nodes.find((item) => item.id === change.id);
      return !node || node.position.x !== change.position.x || node.position.y !== change.position.y;
    });
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    const picks = changes.filter((change) => change.type === 'select');
    if (picks.length) {
      const picked = new Set(multi.length ? multi : search.node ? [search.node] : []);
      for (const change of picks) if (change.type === 'select') (change.selected ? picked.add(change.id) : picked.delete(change.id));
      // A box or ⌘/Ctrl+click picks (ringed), even a single node; only a plain click (onNodeClick) opens its pane.
      const ids = [...picked];
      setMulti(ids);
      if (ids.length && search.node) select(undefined);
    }
    if (!moved.length && !removed.length) return;
    if (removed.length) setMulti([]);
    const next = applyNodeChanges(moved, nodes);
    setDraft((draftValue) => ({
      ...draftValue,
      definition: syncEntryEdges({
        ...draftValue.definition,
        nodes: draftValue.definition.nodes.filter((node) => !removed.includes(node.id)).map((node) => ({ ...node, position: next.find((item) => item.id === node.id)?.position ?? node.position })),
        groups: pruneGroups(draftValue.definition.groups, draftValue.definition.nodes.filter((node) => !removed.includes(node.id))),
        // Every route is global ELK geometry. Any manual node move can stale feedback loops or
        // labels elsewhere, so clear the route snapshot and let React Flow route until re-layout.
        edges: draftValue.definition.edges.filter((edge) => !removed.includes(edge.source) && !removed.includes(edge.target)).map((edge) => ({ ...edge, layout: undefined })),
      }),
    }));
    if (removed.includes(search.node ?? '')) select(undefined);
  };
  const removeEdges = (ids: string[]) => {
    // A folded tag node's line is two lines in the definition: cutting it cuts both.
    const tagged = view?.closed.filter((fold) => fold.kind === 'edge' && ids.includes(fold.edgeId ?? ''));
    const gone = new Set([...ids, ...(current?.definition.edges.filter((edge) => tagged?.some((fold) => edge.source === fold.nodeIds[0] && edge.sourceHandle === 'out')).map((edge) => edge.id) ?? [])]);
    setDraft((value) => ({
      ...value,
      definition: syncEntryEdges({
        ...value.definition,
        edges: value.definition.edges.filter((edge) => !gone.has(edge.id)),
      }),
    }));
    setEdgeId(undefined);
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    for (const change of changes) if (change.type === 'select') setEdgeId(change.selected ? change.id : (current) => (current === change.id ? undefined : current));
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length) removeEdges(removed);
  };
  const onConnect = (connection: Connection) => {
    if (!connection.sourceHandle || connection.source === connection.target && false) return;
    setDraft((value) => {
      // An exit may have several edges (every line goes down all of them); only an exact duplicate is refused.
      if (value.definition.edges.some((edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle && edge.target === connection.target)) return value;
      const kept = value.definition.edges;
      const added = addEdge({ ...connection, id: `e-${crypto.randomUUID().slice(0, 8)}` }, kept.map((edge) => ({ ...edge }))) as typeof kept;
      return {
        ...value,
        definition: syncEntryEdges({
          ...value.definition,
          edges: added.map(({ id, source, sourceHandle, target }) => ({ id, source, sourceHandle: sourceHandle!, target })),
        }),
      };
    });
  };

  /** New nodes appear at the centre of the view; AI presets and functions are just pre-filled configs. */
  const addNode = (seed: Pick<WorkflowNode, 'type'> & { label?: string; config?: unknown }, prefix: string, drop?: { x: number; y: number }) => {
    const position = drop ?? flow.screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 });
    const taken = new Set(current?.definition.nodes.map((node) => node.id));
    let id = prefix;
    for (let n = 2; taken.has(id); n++) id = `${prefix}${n}`;
    const node = workflowNodeSchema.parse({ id, position, config: {}, ...seed });
    // Dropped on a frame, it joins that step.
    const into = drop && frameAt(frameBoxes, { x: position.x + 20, y: position.y + 20 });
    setDraft((value) => {
      const definition = syncEntryEdges({ ...value.definition, nodes: [...value.definition.nodes, node] });
      return { ...value, definition: into ? fitFrames(moveIntoGroup(definition, [id], groupIdOf(into)), measured, new Set([...shownIds, id])) : definition };
    });
    select(id);
  };

  const arrange = async (layoutDirection: CanvasDirection = direction, keepReadable = true) => {
    if (!current || !view) return;
    const sizes = new Map(flow.getNodes().map((node) => [node.id, { width: node.measured?.width ?? 224, height: node.measured?.height ?? 66 }]));
    try {
      // Laid out as drawn: closed folds are not in the graph, their nodes and lines keep what they had.
      const next = await autoLayout(view.definition, sizes, layoutDirection);
      const positions = new Map(next.nodes.map((node) => [node.id, node.position]));
      const routes = new Map(next.edges.map((edge) => [edge.id, edge.layout]));
      const boxes = new Map((next.groups ?? []).map((group) => [group.id, group.box]));
      setDraft((value) => ({ ...value, definition: { ...value.definition, direction: layoutDirection, nodes: value.definition.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })), edges: value.definition.edges.map((edge) => ({ ...edge, layout: routes.get(edge.id) })), groups: value.definition.groups?.map((group) => ({ ...group, box: boxes.get(group.id) ?? group.box })) } }));
      const focusId = search.node ?? definitions[0]?.id;
      const focusNode = next.nodes.find((node) => node.id === focusId);
      const focusSize = focusId ? sizes.get(focusId) : undefined;
      requestAnimationFrame(() => keepReadable
        ? focusWorkflowNode(flow, focusId, layoutDirection, canvasRef.current, focusNode?.position, focusSize)
        : fitWholeWorkflow(flow, 300));
    } catch (error) { toast.error(error instanceof Error ? error.message : '자동 정렬하지 못했습니다.'); }
  };

  const changeDirection = (next: CanvasDirection) => {
    if (next === direction) return;
    void navigate({ search: (previous) => ({ ...previous, direction: next }) });
  };

  const previousDirection = useRef<CanvasDirection | undefined>(undefined);
  const previousWorkflowId = useRef<string | undefined>(undefined);
  const previousSavedVersion = useRef<number | undefined>(undefined);
  const adoptedDirection = useRef<CanvasDirection | undefined>(undefined);
  const arrangeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!current || !workflow.data) return;
    if (!search.direction) void navigate({ search: (previous) => ({ ...previous, direction }), replace: true });
    const initialWorkflowLoad = previousWorkflowId.current !== workflowId;
    const savedVersionChanged = !initialWorkflowLoad && previousSavedVersion.current !== workflow.data.version;
    const urlDirectionChanged = !initialWorkflowLoad && previousDirection.current !== direction;
    const serverDirection = workflow.data.definition.direction;
    const localEditInProgress = Boolean(draft || save.isPending || inFlight.current);
    if (initialWorkflowLoad) adoptedDirection.current = undefined;
    previousWorkflowId.current = workflowId;
    previousDirection.current = direction;
    previousSavedVersion.current = workflow.data.version;

    let shouldArrange = urlDirectionChanged
      || (initialWorkflowLoad && search.direction !== undefined && serverDirection !== direction);
    if (savedVersionChanged && !localEditInProgress && serverDirection) {
      // A clean tab adopts another tab's saved orientation and positions together; never repair
      // an SSE update by writing a competing layout back to the server.
      if (serverDirection !== direction) {
        adoptedDirection.current = serverDirection;
        shouldArrange = false;
        void navigate({ search: (value) => ({ ...value, direction: serverDirection }), replace: true });
      } else if (!urlDirectionChanged) {
        shouldArrange = false;
      }
    }
    if (adoptedDirection.current === direction) {
      adoptedDirection.current = undefined;
      shouldArrange = false;
      const focusId = search.node ?? definitions[0]?.id;
      const focusNode = current.definition.nodes.find((node) => node.id === focusId);
      const focusSize = focusId ? measured[focusId] : undefined;
      requestAnimationFrame(() => focusWorkflowNode(flow, focusId, direction, canvasRef.current, focusNode?.position, focusSize));
    }
    if (shouldArrange) {
      // Let React Flow measure the newly oriented cards before asking ELK to place them.
      if (arrangeTimer.current !== undefined) window.clearTimeout(arrangeTimer.current);
      arrangeTimer.current = window.setTimeout(() => {
        arrangeTimer.current = undefined;
        void arrange(direction, true);
      }, 100);
    }
    return () => {
      if (arrangeTimer.current !== undefined) window.clearTimeout(arrangeTimer.current);
      arrangeTimer.current = undefined;
    };
  }, [direction, current?.definition.direction, draft, save.isPending, search.direction, workflow.data?.version, workflow.data?.definition.direction, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Undo history of the editor: every change to the workflow (a drag or typing in a field counts as one
  // step until it pauses), across autosaves; ⌘/Ctrl+Z goes back, ⌘/Ctrl+Shift+Z forward.
  const history = useRef<{ past: string[]; future: string[]; last?: string; replaying: boolean; at: number }>({ past: [], future: [], replaying: false, at: 0 });
  useEffect(() => {
    history.current = { past: [], future: [], replaying: false, at: 0 };
  }, [workflowId]);
  const snapshot = current ? JSON.stringify({ name: current.name, definition: current.definition }) : undefined;
  useEffect(() => {
    const h = history.current;
    if (!snapshot || snapshot === h.last) return;
    if (h.last === undefined || h.replaying) {
      h.replaying = false;
      h.last = snapshot;
      return;
    }
    const now = Date.now();
    if (now - h.at > 400) {
      h.past.push(h.last);
      if (h.past.length > 100) h.past.shift();
    }
    h.at = now;
    h.future = [];
    h.last = snapshot;
  }, [snapshot]);
  const restore = (from: 'past' | 'future') => {
    const h = history.current;
    const target = h[from].pop();
    if (!target || h.last === undefined) return;
    (from === 'past' ? h.future : h.past).push(h.last);
    h.replaying = true;
    h.at = 0;
    const { name, definition } = JSON.parse(target) as { name: string; definition: WorkflowDefinition };
    setDraft((value) => ({ ...value, name, definition }));
    // A selection of a node the restored workflow does not have goes with it.
    const kept = new Set(definition.nodes.map((node) => node.id));
    setMulti((ids) => ids.filter((id) => kept.has(id)));
    setEdgeId((id) => (id && definition.edges.some((edge) => edge.id === id) ? id : undefined));
    if (search.node && !kept.has(search.node)) void navigate({ search: (previous) => ({ ...previous, node: undefined }) });
  };
  // The keys every graph shares (lib/graph-shortcuts); the actions are set below, once the workflow is loaded.
  const actions = useRef<GraphShortcuts>({});
  useGraphShortcuts({
    undo: () => actions.current.undo?.(),
    redo: () => actions.current.redo?.(),
    copy: () => actions.current.copy?.(),
    cut: () => actions.current.cut?.(),
    paste: () => actions.current.paste?.(),
    remove: () => actions.current.remove?.(),
    ungroup: () => actions.current.ungroup?.(),
  }, Boolean(current));

  if (!workflow.data || !current)
    return (
      <Page title="워크플로">
        <Skeleton height="placeholder-page" />
      </Page>
    );

  const calledBy = workflow.data.calledBy ?? [];
  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  // The palette offers the core nodes and those of the workflow's input (INPUT_TYPES via functionTakes / presetTakes).
  const input = workflowInput(current.definition);
  const palette: NodeLibraryGroup[] = [
    {
      id: 'ai',
      label: 'AI',
      items: [
        ...Object.entries(AI_PRESETS as unknown as Record<string, PresetEntry>).filter(([, preset]) => presetTakes(preset, input)).map(([id, preset]) => ({
          id,
          label: preset.label,
          kind: 'ai' as const,
          icon: null,
        })),
        { id: 'ai', label: 'AI 자유 형식', kind: 'ai' as const, icon: null },
      ],
    },
    {
      id: 'apply',
      label: '반영',
      items: APPLY_PALETTE_ORDER.filter((fn) => functionTakes(fn, input)).map((fn) => ({ id: fn, label: FUNCTIONS[fn].label, kind: fn === 'setStatus' ? ('status' as const) : ('apply' as const), icon: null })),
    },
    {
      id: 'function',
      label: '함수',
      items: PALETTE_FUNCTION_NAMES.filter((fn) => functionGroup(fn) === 'function' && functionTakes(fn, input)).map((fn) => ({ id: fn, label: FUNCTIONS[fn].label, kind: 'function' as const, icon: null })),
    },
    {
      id: 'flow',
      label: '흐름',
      items: [
        { id: 'condition', label: '조건', kind: 'condition' as const, icon: null },
        { id: 'gather', label: '모으기', kind: 'gather' as const, icon: null },
        { id: 'call', label: '워크플로 호출', kind: 'call' as const, icon: null, description: '다른 워크플로를 여기서 돌립니다.' },
      ],
    },
  ];
  // A new AI node packs requests in a way the workflow's input has (용어 has no scenes: it starts 개수별).
  const batchFor = (batch?: { mode?: BatchConfig['mode'] }) => {
    const modes: readonly BatchConfig['mode'][] = INPUT_TYPES[input].batchModes;
    return { ...batch, mode: modes.includes(batch?.mode ?? 'group') ? (batch?.mode ?? 'group') : modes[0]! };
  };
  const addFromLibrary = (id: string, position?: { x: number; y: number }) => {
    const preset = (AI_PRESETS as unknown as Record<string, PresetEntry>)[id];
    if (preset) {
      const { label, description: _description, ...config } = preset;
      addNode({ type: 'ai', label, config: { ...config, batch: batchFor(config.batch as { mode?: BatchConfig['mode'] } | undefined), model: newNodeModel(), preset: id } } as never, id, position);
    }
    else if (FUNCTION_NAMES.includes(id as FunctionName)) addNode({ type: 'function', config: { fn: id, params: {}, concurrency: 2 } }, id, position);
    else if (id === 'ai') addNode({ type: 'ai', config: { model: newNodeModel(), output: 'json', scope: 'line', batch: batchFor(), fields: [{ name: 'note', type: 'string', description: '' }] } } as never, id, position);
    else if (id === 'gather') addNode({ type: 'gather', config: { from: '', fields: [] } }, id, position);
    else if (id === 'call') addNode({ type: 'call', config: { workflowId: '' } }, id, position);
    else if (id === 'condition') addNode({ type: 'condition', config: { expression: true, description: '' } }, id, position);
  };
  const deleteNode = (nodeId: string) => {
    setDraft((value) => ({
      ...value,
      definition: syncEntryEdges({
        ...value.definition,
        nodes: value.definition.nodes.filter((node) => node.id !== nodeId),
        edges: value.definition.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        groups: pruneGroups(value.definition.groups, value.definition.nodes.filter((node) => node.id !== nodeId)),
      }),
    }));
    if (search.node === nodeId) select(undefined);
  };
  /** Deletes several nodes at once (same as deleting each: no confirmation, the edit is an undoable draft). */
  const deleteNodes = (ids: string[]) => {
    const doomed = new Set(ids.filter((id) => current?.definition.nodes.find((node) => node.id === id)?.type !== 'entry'));
    if (!doomed.size) return;
    setDraft((value) => ({
      ...value,
      definition: syncEntryEdges({
        ...value.definition,
        nodes: value.definition.nodes.filter((node) => !doomed.has(node.id)),
        edges: value.definition.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
        groups: pruneGroups(value.definition.groups, value.definition.nodes.filter((node) => !doomed.has(node.id))),
      }),
    }));
    setMulti([]);
    if (search.node && doomed.has(search.node)) select(undefined);
  };
  /** Copies several nodes, keeping the lines that run between the copied nodes. */
  const duplicateNodes = (ids: string[]) => {
    if (!current) return;
    const originals = current.definition.nodes.filter((node) => ids.includes(node.id) && node.type !== 'entry');
    pasteNodes({ nodes: originals, edges: current.definition.edges });
  };
  /** Puts copies of `nodes` beside them (new ids), with the lines among them, and picks the copies. */
  const pasteNodes = ({ nodes: originals, edges }: GraphClipboard) => {
    if (!current || !originals.length) return;
    const taken = new Set(current.definition.nodes.map((node) => node.id));
    const renamed = new Map<string, string>();
    for (const node of originals) {
      let id = `${node.id}-copy`;
      for (let n = 2; taken.has(id); n++) id = `${node.id}-copy${n}`;
      taken.add(id);
      renamed.set(node.id, id);
    }
    const copies = originals.map((node) => workflowNodeSchema.parse({ ...structuredClone(node), id: renamed.get(node.id), position: { x: node.position.x + 240, y: node.position.y } }));
    const lines = edges
      .filter((edge) => renamed.has(edge.source) && renamed.has(edge.target))
      .map((edge) => ({ id: `e-${crypto.randomUUID().slice(0, 8)}`, source: renamed.get(edge.source)!, sourceHandle: edge.sourceHandle, target: renamed.get(edge.target)! }));
    setDraft((value) => ({ ...value, definition: syncEntryEdges({ ...value.definition, nodes: [...value.definition.nodes, ...copies], edges: [...value.definition.edges, ...lines] }) }));
    setMulti(copies.length >= 2 ? copies.map((node) => node.id) : []);
    select(copies.length === 1 ? copies[0]!.id : undefined);
  };
  const deleteSelected = () => {
    if (!selected || selected.type === 'entry') return;
    deleteNode(selected.id);
  };
  /** The nodes the keys act on: the picked group, else the open node. */
  const pickedIds = multi.length ? multi : search.node ? [search.node] : [];
  const copyPicked = () => {
    const nodes = current.definition.nodes.filter((node) => pickedIds.includes(node.id) && node.type !== 'entry');
    if (!nodes.length) return false;
    const ids = new Set(nodes.map((node) => node.id));
    graphClipboard = { nodes: structuredClone(nodes), edges: current.definition.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
    return true;
  };
  actions.current = {
    undo: () => restore('past'),
    redo: () => restore('future'),
    copy: () => void (copyPicked() && toast.success(`노드 ${pickedIds.length}개를 복사했습니다.`)),
    cut: () => void (copyPicked() && deleteNodes(pickedIds)),
    paste: () => graphClipboard && pasteNodes(graphClipboard),
    remove: () => (edgeId ? removeEdges([edgeId]) : pickedGroup && !pickedIds.length ? deleteFrame(pickedGroup.id) : deleteNodes(pickedIds)),
    ungroup: () => (pickedGroup && !pickedIds.length ? ungroupFrame(pickedGroup.id) : undefined),
  };

  return (
    <Page title={current.name || '워크플로'} flush>
      <PageHeading>
        <Text asChild variant="caption" tone="muted"><Link to="/p/$projectId/workflows" params={{ projectId }}>워크플로</Link></Text><Icon icon={ChevronRight} size="xs" tone="muted" />
        <NameField name={current.name} onRename={(name) => setDraft((value) => ({ ...value, name }))} />
        {calledBy.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" tone="muted">워크플로 {calledBy.length}개가 이 워크플로를 부릅니다</Button>
            </PopoverTrigger>
            <Box asChild width="menu-lg" padding="condensed">
            <PopoverContent align="start">
              <Box as="ul" spaceY="hair">
                {calledBy.map((caller) => (
                  <li key={caller.id}>
                    <Button variant="ghost" width="full" justifyContent="start" weight="normal" asChild>
                      <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: caller.id }}><Text truncate>{caller.name}</Text></Link>
                    </Button>
                  </li>
                ))}
              </Box>
            </PopoverContent>
            </Box>
          </Popover>
        )}
        <Text truncate variant="caption" tone="muted" role="status">{save.isPending ? '저장 중…' : save.isError ? '저장 실패 · 편집 보관됨' : draft ? '저장 대기' : `자동 저장됨 ${savedAt(workflow.data.updatedAt)}`}</Text>
      </PageHeading>
      <HeaderActions>
        {/* The palette, out of the canvas's way: search it, click a node to add it, or drag one onto the canvas. */}
        <Popover open={libraryOpen} onOpenChange={setLibraryOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline"><Plus /> 노드</Button>
          </PopoverTrigger>
          <PopoverContent align="end" padding="none" width="menu-lg">
            <NodeLibrary variant="menu" groups={palette} onSelect={(item) => { addFromLibrary(item.id); setLibraryOpen(false); }} onDragStart={() => window.setTimeout(() => setLibraryOpen(false))} />
          </PopoverContent>
        </Popover>
        <Button variant={drawingFrame ? 'secondary' : 'outline'} aria-pressed={drawingFrame} title={multi.length ? '고른 노드를 새 프레임으로 묶습니다' : '캔버스에 끌어서 프레임을 그립니다 (한 번 누르면 그 자리에 추가)'} onClick={addFramePressed}><Frame /> 프레임</Button>
        <RunDialog projectId={projectId} workflowId={workflowId} disabledReason={save.isPending ? '저장하는 중입니다.' : errorCount > 0 && `오류 ${errorCount}개를 고친 뒤 실행할 수 있습니다. 위의 고치기를 누르세요.`} dirty={Boolean(draft)} />
        {draft && <Button variant="ghost" disabled={save.isPending} onClick={discard}>되돌리기</Button>}
      </HeaderActions>
      {save.isError && <Inline role="alert" gap="condensed" border="bottom" background="dangerSoft" paddingX="comfortable" paddingY="condensed" variant="caption" tone="danger">저장하지 못했습니다. 편집은 이 브라우저에 보관됩니다. {save.error.message}<Button variant="outline" disabled={stale || !draft} onClick={() => draft && save.mutate(draft)}>다시 저장</Button></Inline>}
      {stale && !save.isPending && (
        <Inline gap="normal" border="bottom" background="warningSoft" paddingX="spacious" paddingY="condensed" variant="body" tone="warning">
          편집하는 동안 다른 곳에서 이 워크플로를 저장했습니다({savedAt(workflow.data.updatedAt)}). 이 편집은 그 전 내용을 바탕으로 합니다.
          <Button variant="outline" onClick={discard}>
            최신 불러오기
          </Button>
        </Inline>
      )}
      <WorkflowIssueBar issues={issues} nodes={current.definition.nodes} onFix={select} />
      {/* The editor only edits: how a run is going is on its own page (실행 기록 › 그래프). */}
      {activeRun && (
        <Inline role="status" gap="normal" border="bottom" background="sunken" paddingX="comfortable" paddingY="condensed" variant="caption" tone="muted">
          이 워크플로가 {activeRun.status === 'paused' ? '멈춘 채 실행 중' : '실행 중'}입니다. 실행이 끝날 때까지 바뀐 내용은 저장되지 않고 이 브라우저에 보관됩니다.
          <Button variant="outline" asChild>
            <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: activeRun.id }} search={{ tab: 'graph' }}>진행 보기</Link>
          </Button>
        </Inline>
      )}
      <SplitPane fill="height"
        id="workflow"
        selectionKey={selected?.id ?? (pickedGroup && frameId(pickedGroup.id))}
        defaultWidth="360px"
        pane={
          current && pickedGroup && !selected ? (
            <Box height="full" minWidth={0} overflow="hiddenX" background="page">
              <FramePanel
                group={pickedGroup}
                nodes={current.definition.nodes}
                onRename={(label) => setDraft((value) => ({ ...value, definition: renameGroup(value.definition, pickedGroup.id, label) }))}
                onUngroup={() => ungroupFrame(pickedGroup.id)}
                onDelete={() => deleteFrame(pickedGroup.id)}
                onOpenNode={select}
                onClose={() => selectFrame(undefined)}
              />
            </Box>
          ) : current && !selected && !multi.length ? (
            <Box height="full" minWidth={0} overflow="hiddenX" background="page">
              <WorkflowSettings settings={current.definition.settings} onChange={(settings) => setDraft((value) => ({ ...value, definition: { ...value.definition, settings } }))} />
            </Box>
          ) : selected && (
            <Box height="full" minWidth={0} overflow="hiddenX" background="page">
              <NodeConfig
                key={`${selected.id}:${revision}`}
                node={selected}
                issues={issues.filter((issue) => issue.nodeId === selected.id)}
                refs={{
                  statuses: taxonomy.statuses ?? [],
                  // The tags of the workflow's input: line tags, or term tags.
                  tags: tagsIn(taxonomy.tags, input),
                  projectId,
                  workflowId,
                  connections: connections.data ?? [],
                  nodes: current.definition.nodes,
                  edges: current.definition.edges,
                  workflows: workflows.data,
                  onOpenNode: select,
                  retries: current.definition.settings.retries,
                  onOpenWorkflowSettings: () => select(undefined),
                }}
                onChange={(next) => setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: value.definition.nodes.map((node) => (node.id === next.id ? next : node)), edges: value.definition.edges.map((edge) => ({ ...edge, layout: undefined })) } }))}
                onDelete={deleteSelected}
                onClose={() => select(undefined)}
              />
            </Box>
          )
        }
      >
        <Stack direction="row" minHeight={0} grow paddingBottom="statusBar">
        <CanvasSurface ref={canvasRef} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData('application/x-loca-workflow-node');
          if (palette.some((group) => group.items.some((item) => item.id === id))) addFromLibrary(id, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}>
          <ReactFlow colorMode={dark ? 'dark' : 'light'}
            nodes={[...frameTints(frames), ...frames, ...nodes] as FlowNode[]}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={(_event, node) => {
              if (isFrameId(node.id) || !current.definition.groups?.length) return void (dragBoxes.current = []);
              dragBoxes.current = frameBoxes;
              setFrozen(new Map(frameBoxes.map((frame) => [groupIdOf(frame.id), { x: frame.position.x, y: frame.position.y, width: frame.width!, height: frame.height! }])));
            }}
            onNodeDrag={(_event, node) => {
              if (!dragBoxes.current.length) return;
              const into = dropInto(node);
              const own = groupOf(current.definition.groups, node.id);
              const name = (groupId: string) => current.definition.groups?.find((group) => group.id === groupId)?.label || '이름 없는 프레임';
              setDropFrame(into && into !== own ? frameId(into) : undefined);
              setDropHint(into && into !== own ? `'${name(into)}'에 넣기` : !into && own ? `'${name(own)}'에서 빼기` : undefined);
            }}
            onNodeDragStop={(_event, node, dragged) => {
              setDropFrame(undefined);
              setDropHint(undefined);
              if (!dragBoxes.current.length) return;
              const into = dropInto(node);
              const ids = dragged.map((item) => item.id).filter((id) => !isFrameId(id));
              dragBoxes.current = [];
              setFrozen(null);
              const moves = ids.some((id) => groupOf(current.definition.groups, id) !== (into ?? undefined));
              setDraft((value) => ({ ...value, definition: fitFrames(moves ? moveIntoGroup(value.definition, ids, into) : value.definition, measured, shownIds) }));
            }}
            onNodeClick={(event, node) => {
              if (isFrameId(node.id)) return (setMulti([]), setEdgeId(undefined), setContextMenu(null), selectFrame(groupIdOf(node.id)));
              if (event.metaKey || event.ctrlKey) return;
              setMulti([]);
              select(node.id);
              setEdgeId(undefined);
              setContextMenu(null);
            }}
            // A plain click picks only the line: the node's selection (and its pane) goes, as anywhere else a plain click picks one thing.
            onEdgeClick={(event, edge) => {
              if (!(event.metaKey || event.ctrlKey)) {
                select(undefined);
                setMulti([]);
              }
              setEdgeId(edge.id);
              setContextMenu(null);
            }}
            onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdgeId(undefined)}
            // The room inside a frame is the canvas (it pans), but a click there picks the frame.
            onPaneClick={(event) => {
              setMulti([]);
              setEdgeId(undefined);
              setContextMenu(null);
              const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
              const under = frameAt(frameBoxes, at);
              if (under) selectFrame(groupIdOf(under));
              else select(undefined);
            }}
            onNodeContextMenu={(event, flowNode) => {
              event.preventDefault();
              if (isFrameId(flowNode.id)) return;
              setEdgeId(undefined);
              if (multi.length >= 2 && multi.includes(flowNode.id)) return setContextMenu({ kind: 'nodes', ids: multi, x: event.clientX, y: event.clientY });
              // The menu acts on this node; the selection (and its config pane) stays as it was.
              const node = current.definition.nodes.find((n) => n.id === flowNode.id);
              if (node) {
                setContextMenu({
                  kind: 'node',
                  node,
                  x: event.clientX,
                  y: event.clientY,
                });
              }
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault();
              select(undefined);
              setEdgeId(edge.id);
              setContextMenu({
                kind: 'edge',
                edgeId: edge.id,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                kind: 'pane',
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onInit={(instance) => { const held = readViewport(workflowId, direction); if (held) void instance.setViewport(held); else focusWorkflowNode(instance, search.node ?? definitions[0]?.id, direction, canvasRef.current); }}
            onMoveEnd={(_event, viewport) => sessionStorage.setItem(viewportKey(workflowId, direction), JSON.stringify(viewport))}
            // Same as the dialogue graph: left or middle drag pans, Shift+drag draws a selection box, ⌘/Ctrl+click adds a node.
            panOnDrag={[0, 1]}
            // Dragging a node moves it; it does not pick it (picking is a click, ⌘/Ctrl+click or Shift+drag).
            selectNodesOnDrag={false}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Meta', 'Control']}
            selectionMode={SelectionMode.Partial}
            minZoom={0.05}
            // Delete goes through the shared graph keys (the entry node stays; undo brings anything back).
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background size={1.5} gap={20} color="var(--fill-graph-grid)" />
            <Panel position="top-right"><EdgeLegend /></Panel>
            <Panel position="bottom-left"><CanvasToolbar zoomPercent={zoom * 100} onZoomIn={() => void flow.zoomIn()} onZoomOut={() => void flow.zoomOut()} onFit={() => fitWholeWorkflow(flow, 200)} onResetZoom={() => void flow.zoomTo(1, { duration: 180 })} onLayout={() => void arrange(direction, true)} layoutLabel="자동 정렬" direction={direction} onDirectionChange={changeDirection} foldsOpen={folds.length ? allFoldsOpen(folds, foldState) : undefined} onToggleFolds={() => setFoldState(setAllFolds(folds, !allFoldsOpen(folds, foldState)))} minimapVisible={minimap} onToggleMinimap={() => setMinimap((value) => !value)} /></Panel>
            {minimap && <MiniMap position="bottom-right" pannable zoomable />}
            {selected && shown.some((node) => node.id === selected.id) && <NodeToolbar nodeId={selected.id} isVisible position={Position.Top} offset={16}><SelectionToolbox actions={[
              ...(selected.type !== 'entry' ? [{ id: 'copy', label: '복제', icon: <Copy />, onSelect: () => addNode({ type: selected.type, label: selected.label, config: structuredClone(selected.config) }, selected.id + '-copy', { x: selected.position.x + 240, y: selected.position.y }) },
              { id: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: deleteSelected }] : []),
            ]} /></NodeToolbar>}
            {/* A frame sits under the nodes; its toolbar must not (it would take that layer and miss the pointer). */}
            {pickedGroup && frames.some((frame) => frame.id === frameId(pickedGroup.id)) && <NodeToolbar nodeId={frameId(pickedGroup.id)} isVisible position={Position.Top} offset={8} style={{ zIndex: 1000 }}><SelectionToolbox actions={[
              { id: 'rename', label: '이름 바꾸기', icon: <Pencil />, onSelect: () => setRenamingFrame(pickedGroup.id) },
              { id: 'ungroup', label: '프레임만 삭제', icon: <Ungroup />, onSelect: () => ungroupFrame(pickedGroup.id) },
              { id: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => deleteFrame(pickedGroup.id) },
            ]} /></NodeToolbar>}
            {drawingFrame && <Panel position="top-center"><Inline role="status" gap="condensed" background="overlay" border="all" radius="md" shadow="sm" paddingX="comfortable" paddingY="condensed" variant="caption"><Icon icon={Frame} size="sm" tone="accent" />끌어서 프레임을 그리세요. 한 번 누르면 그 자리에 추가합니다 · Esc 취소</Inline></Panel>}
            {/* What letting go will do, while nodes are dragged across frames. */}
            {dropHint && <Panel position="top-center"><Inline role="status" gap="condensed" background="overlay" border="all" radius="md" shadow="sm" paddingX="comfortable" paddingY="condensed" variant="caption"><Icon icon={Frame} size="sm" tone="accent" />{dropHint}</Inline></Panel>}
            {multi.length > 1 && <NodeToolbar nodeId={multi} isVisible position={Position.Top} offset={16}><SelectionToolbox actions={[
              { id: 'frame', label: '프레임으로 묶기', icon: <Group />, onSelect: () => groupPicked(multi.filter((id) => shown.some((node) => node.id === id))) },
              { id: 'copy', label: `${multi.length}개 복제`, icon: <Copy />, onSelect: () => duplicateNodes(multi) },
              { id: 'delete', label: `${multi.length}개 삭제`, icon: <Trash2 />, destructive: true, onSelect: () => deleteNodes(multi) },
            ]} /></NodeToolbar>}
            {/* A box selection also picks the edges between its nodes; those go with the nodes, not as one edge to delete. */}
            {edgeId && multi.length < 2 && <Panel position="top-center"><SelectionToolbox actions={[{ id: 'delete-edge', label: '연결 삭제', icon: <Trash2 />, destructive: true, onSelect: () => removeEdges([edgeId]) }]} /></Panel>}
          </ReactFlow>
          {drawingFrame && <CanvasDrawLayer label="끌어서 프레임 그리기" onDraw={drawFrame} onCancel={() => setDrawingFrame(false)} />}
          {contextMenu && (
            <DropdownMenu open={Boolean(contextMenu)} onOpenChange={(open) => !open && setContextMenu(null)} modal={false}>
              <DropdownMenuTrigger asChild>
                <span
                  aria-hidden
                  style={{
                    position: 'fixed',
                    left: contextMenu.x,
                    top: contextMenu.y,
                    width: 1,
                    height: 1,
                    pointerEvents: 'none',
                  }}
                />
              </DropdownMenuTrigger>
              {contextMenu.kind === 'node' && (
                <Box asChild width="menu">
                <DropdownMenuContent align="start" side="bottom" sideOffset={2}>
                  <DropdownMenuItem onSelect={() => select(contextMenu.node.id)}>
                    <Icon icon={SlidersHorizontal} size="sm" />
                    <span>설정 열기</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => groupPicked([contextMenu.node.id])}>
                    <Icon icon={Group} size="sm" />
                    <span>새 프레임으로 묶기</span>
                  </DropdownMenuItem>
                  {frameMenu([contextMenu.node.id])}
                  <DropdownMenuItem
                    onSelect={() => {
                      addNode(
                        { type: contextMenu.node.type, label: contextMenu.node.label, config: structuredClone(contextMenu.node.config) },
                        `${contextMenu.node.id}-copy`,
                        { x: contextMenu.node.position.x + 240, y: contextMenu.node.position.y },
                      );
                    }}
                  >
                    <Icon icon={Copy} size="sm" />
                    <span>복제</span>
                  </DropdownMenuItem>
                  {(() => {
                    const incidentEdges = current.definition.edges.filter(
                      (e) => e.source === contextMenu.node.id || e.target === contextMenu.node.id,
                    );
                    return (
                      <DropdownMenuItem
                        disabled={incidentEdges.length === 0}
                        onSelect={() => {
                          removeEdges(incidentEdges.map((e) => e.id));
                        }}
                      >
                        <Icon icon={Unlink} size="sm" />
                        <span>연결 끊기</span>
                      </DropdownMenuItem>
                    );
                  })()}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      deleteNode(contextMenu.node.id);
                    }}
                  >
                    <Icon icon={Trash2} size="sm" />
                    <span>삭제</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
                </Box>
              )}
              {contextMenu.kind === 'nodes' && (
                <Box asChild width="menu">
                <DropdownMenuContent align="start" side="bottom" sideOffset={2}>
                  <DropdownMenuItem onSelect={() => groupPicked(contextMenu.ids.filter((id) => shown.some((node) => node.id === id)))}>
                    <Icon icon={Group} size="sm" />
                    <span>프레임으로 묶기</span>
                  </DropdownMenuItem>
                  {frameMenu(contextMenu.ids)}
                  <DropdownMenuItem onSelect={() => duplicateNodes(contextMenu.ids)}>
                    <Icon icon={Copy} size="sm" />
                    <span>{contextMenu.ids.length}개 복제</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => deleteNodes(contextMenu.ids)}>
                    <Icon icon={Trash2} size="sm" />
                    <span>{contextMenu.ids.length}개 삭제</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
                </Box>
              )}
              {contextMenu.kind === 'edge' && (
                <Box asChild width="field-lg">
                <DropdownMenuContent align="start" side="bottom" sideOffset={2}>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      removeEdges([contextMenu.edgeId]);
                    }}
                  >
                    <Icon icon={Trash2} size="sm" />
                    <span>연결 삭제</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
                </Box>
              )}
              {contextMenu.kind === 'pane' && (
                <Box asChild width="menu">
                <DropdownMenuContent align="start" side="bottom" sideOffset={2}>
                  <DropdownMenuItem onSelect={() => createFrame(frameAtScreen(contextMenu.x, contextMenu.y))}>
                    <Icon icon={Frame} size="sm" />
                    <span>여기에 프레임 추가</span>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Icon icon={Plus} size="sm" />
                      <span>노드 추가</span>
                    </DropdownMenuSubTrigger>
                    <Box asChild width="field-lg">
                    <DropdownMenuSubContent>
                      {palette.map((group, groupIndex) => (
                        <Fragment key={group.id}>
                          {groupIndex > 0 && <DropdownMenuSeparator />}
                          <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                          {group.items.map((item) => (
                            <DropdownMenuItem
                              key={item.id}
                              onSelect={() => {
                                const flowPos = flow.screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y });
                                addFromLibrary(item.id, flowPos);
                              }}
                            >
                              <span>{item.label}</span>
                            </DropdownMenuItem>
                          ))}
                        </Fragment>
                      ))}
                    </DropdownMenuSubContent>
                    </Box>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void arrange(direction, true)}>
                    <Icon icon={LayoutGrid} size="sm" />
                    <span>자동 정렬</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => fitWholeWorkflow(flow, 200)}>
                    <Icon icon={Maximize} size="sm" />
                    <span>화면에 맞춤</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void flow.zoomTo(1, { duration: 180 })}>
                    <Icon icon={Focus} size="sm" />
                    <span>100% 배율</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => changeDirection(direction === 'vertical' ? 'horizontal' : 'vertical')}>
                    {direction === 'vertical' ? <Icon icon={ArrowLeftRight} size="sm" /> : <Icon icon={ArrowUpDown} size="sm" />}
                    <span>{direction === 'vertical' ? '가로 배치' : '세로 배치'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
                </Box>
              )}
            </DropdownMenu>
          )}
        </CanvasSurface>
        </Stack>
      </SplitPane>
      <StatusBarItem>
        <Text marginRight="normal" nowrap tabular>노드 {definitions.length}</Text>
        {issues.length > 0 && <Text tone={errorCount ? 'danger' : 'warning'}>{errorCount ? `오류 ${errorCount}` : `경고 ${issues.length}`} · {issues[0]?.message}</Text>}
      </StatusBarItem>
    </Page>
  );
}

/** Fit every workflow node with room around the canvas controls. */
function fitWholeWorkflow<N extends Node, E extends Edge>(flow: ReactFlowInstance<N, E>, duration = 0) {
  if (!flow.getNodes().length) return;
  void flow.fitView({ padding: 0.2, maxZoom: 1, minZoom: 0.05, duration });
}

/** Show one readable starting/editing node at 100% until the person asks to fit everything. */
function focusWorkflowNode<N extends Node, E extends Edge>(flow: ReactFlowInstance<N, E>, preferredId: string | undefined, direction: CanvasDirection, canvas: HTMLElement | null, positionOverride?: { x: number; y: number }, sizeOverride?: { width: number; height: number }) {
  const nodes = flow.getNodes();
  const node = (preferredId && nodes.find((item) => item.id === preferredId)) ?? nodes[0];
  if (!node) return;
  const position = positionOverride ?? node.position;
  const { width, height } = canvas?.getBoundingClientRect() ?? { width: 0, height: 0 };
  if (!width || !height) {
    void flow.setCenter(position.x + (sizeOverride?.width ?? node.measured?.width ?? 224) / 2, position.y + (sizeOverride?.height ?? node.measured?.height ?? 66) / 2, { zoom: 1, duration: 180 });
    return;
  }
  const nodeWidth = sizeOverride?.width ?? node.measured?.width ?? 224;
  const nodeHeight = sizeOverride?.height ?? node.measured?.height ?? 66;
  const x = direction === 'vertical' ? width / 2 - position.x - nodeWidth / 2 : 32 - position.x;
  const y = direction === 'vertical' ? 32 - position.y : height / 2 - position.y - nodeHeight / 2;
  void flow.setViewport({ x, y, zoom: 1 }, { duration: 180 });
}
