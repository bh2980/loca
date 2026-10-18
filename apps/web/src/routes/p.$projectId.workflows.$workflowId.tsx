import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  Panel,
  MiniMap,
  NodeToolbar,
  Position,
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
import { ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AI_OUTPUTS, AI_PRESETS, FUNCTIONS, FUNCTION_NAMES, nodeModels, nodeName, nodePorts, workflowNodeSchema, type FunctionName, type WorkflowDefinition, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { Page, StatusBarItem } from '@/components/page';
import { autoLayout } from '@/components/workflow/auto-layout';
import { NodeConfig } from '@/components/workflow/node-config';
import { WorkflowNodeView, type FlowNode } from '@/components/workflow/node-view';
import { WorkflowEdgeView, type FlowEdge } from '@/components/workflow/workflow-edge';
import { RunDialog } from '@/components/workflow/run-dialog';
import { SplitPane, PageHeading, HeaderActions, NodeLibrary, CanvasToolbar, CanvasLegend, CanvasSurface, SelectionToolbox, type CanvasDirection, type NodeLibraryGroup, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Skeleton } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { lineTags, q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { workflowEdits } from '@/lib/workflow-edits';
import { sameWorkflowDraft, reconcileSavedDraft, normalizeWorkflowDraft } from '@/lib/workflow-draft';
import { dateTime } from '@/lib/datetime';
import { useIsDark } from '@/lib/theme';

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
      <Input
        autoFocus
        value={editing}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(event) => (event.key === 'Enter' ? done(true) : event.key === 'Escape' && done(false))}
        className="h-8 w-60"
        aria-label="워크플로 이름"
      />
    );
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <span className="truncate font-medium text-foreground">{name}</span>
      <Button variant="ghost" size="icon-xs" aria-label="이름 바꾸기" onClick={() => ((cancelled.current = false), setEditing(name))}>
        <Pencil />
      </Button>
    </span>
  );
}

export const Route = createFileRoute('/p/$projectId/workflows/$workflowId')({
  validateSearch: (raw: Record<string, unknown>): { node?: string; nodeTab?: 'io' | 'errors'; direction?: CanvasDirection } => ({
    node: typeof raw.node === 'string' ? raw.node : undefined,
    nodeTab: raw.nodeTab === 'io' || raw.nodeTab === 'errors' ? raw.nodeTab : undefined,
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

const nodeTypes = { workflow: WorkflowNodeView };
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
  const cache = useQueryClient();
  const { zoom } = useViewport();
  const [minimap, setMinimap] = useState(false);
  const workflow = useQuery(q.workflow(workflowId));
  const statuses = useQuery(q.statuses(projectId));
  const connections = useQuery(q.connections());
  const runs = useQuery(q.runs(projectId));
  const activeRun = runs.data?.find((run) => run.workflowId === workflowId && (run.status === 'running' || run.status === 'paused'));
  const live = useQuery({ ...q.run(activeRun?.id ?? ''), enabled: Boolean(activeRun) });

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
  // The selected line (for Delete/Backspace and the "선 삭제" button); edges are rebuilt from the
  // definition, so their selection is kept here.
  const [edgeId, setEdgeId] = useState<string>();
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>();
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
      return unwrap(client.workflows[':id'].$put({ param: { id: workflowId }, json: { name: sent.name, description: workflow.data!.description, definition: sent.definition, version: sent.baseVersion } }));
    },
    onSettled: () => { inFlight.current = null; },
    onSuccess: (row, sent) => {
      cache.setQueryData(q.workflow(workflowId).queryKey, (old) => old && old.version > row.version ? old : row);
      setDraftState((latest) => {
        const next = reconcileSavedDraft(latest, sent, row.version);
        if (next) sessionStorage.setItem(draftKey(workflowId), JSON.stringify(next));
        else sessionStorage.removeItem(draftKey(workflowId));
        return next;
      });
      setIssues(row.issues);
    },
  });
  useEffect(() => {
    if (!draft || stale || save.isPending || save.isError) return;
    const timer = setTimeout(() => save.mutate(draft), 800);
    return () => clearTimeout(timer);
  }, [draft, stale, save.isPending, save.isError, save.mutate]);

  const statusName = new Map(statuses.data?.statuses.map((status) => [status.id, status.name]));
  const connectionName = new Map(connections.data?.map((connection) => [connection.id, connection.name]));
  // A new AI node starts with the model the workflow already uses, else the first connection's default.
  const newNodeModel = () => {
    const used = current?.definition.nodes.find((node) => node.type === 'ai' && node.config.model.model);
    if (used?.type === 'ai') return used.config.model;
    const connection = connections.data?.find((item) => item.defaultModel && item.kind !== 'http' && item.kind !== 'systemone');
    return connection ? { connectionId: connection.id, model: connection.defaultModel!, ...(connection.defaultEffort && { effort: connection.defaultEffort }) } : { connectionId: '', model: '' };
  };
  const summary = (node: WorkflowNode): string => {
    switch (node.type) {
      case 'entry':
        return node.config.statusIds.length ? node.config.statusIds.map((id) => statusName.get(id) ?? '삭제된 상태').join(', ') : '범위 안의 모든 대사';
      case 'ai': {
        const model = node.config.model.model ? [connectionName.get(node.config.model.connectionId) ?? (connections.data ? '삭제된 연결' : undefined), node.config.model.model].filter(Boolean).join(' · ') : '모델 없음';
        return `${model}${nodeModels(node).length > 1 ? ` 외 ${nodeModels(node).length - 1}개` : ''}`;
      }
      case 'function': {
        const params = node.config.params as Record<string, unknown>;
        if (node.config.fn === 'setStatus')
          return [params.statusId && `→ ${statusName.get(params.statusId as string) ?? '삭제된 상태'}`].filter(Boolean).join(' · ') || '변경 없음';
        if (node.config.fn === 'http') return `${(params.method as string) ?? 'POST'} ${connectionName.get(params.connectionId as string) ?? '연결 없음'}/${(params.path as string) ?? ''}`;
        if (node.config.fn === 'script') return `출구: ${((params.ports as string[]) ?? ['out']).join(', ')}`;
        if (node.config.fn === 'saveAnalysis') return 'AI 분석 결과 저장';
        if (node.config.fn === 'formatCheck') {
          const checks = [params.placeholders !== false && '자리표시자', params.tags !== false && '서식 태그', params.newlines !== false && '줄바꿈', params.emptyText !== false && '빈 번역'].filter(Boolean);
          return checks.length ? `검사: ${checks.join('·')}` : '켠 검사 항목 없음 (항상 통과)';
        }
        return FUNCTIONS[node.config.fn as FunctionName]?.label ?? node.config.fn;
      }
      case 'condition':
        return node.config.description || '조건식';
      default:
        return '';
    }
  };

  const liveCounts = useMemo(() => {
    const counts = new Map<string, { queued: number; running: number; failed: number }>();
    for (const row of live.data?.nodes ?? []) {
      const entry = counts.get(row.nodeId) ?? { queued: 0, running: 0, failed: 0 };
      if (row.state in entry) entry[row.state as keyof typeof entry] += row.count;
      counts.set(row.nodeId, entry);
    }
    return counts;
  }, [live.data]);

  // React Flow measures each node and reports it as a 'dimensions' change; nodes rebuilt without
  // those sizes stay hidden (and their edges undrawn) until measured again, which never happens
  // when the size did not change. So the sizes are kept here and put back on every rebuild.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  // Another workflow reuses node ids ("entry", "translate") with other sizes.
  useEffect(() => setMeasured({}), [workflowId]);
  const nodes: FlowNode[] = useMemo(
    () => {
      const definitions = current?.definition.nodes ?? [];
      return definitions.map((node) => ({
        id: node.id,
        type: 'workflow',
        position: node.position,
        measured: measured[node.id],
        selected: node.id === search.node,
        deletable: node.type !== 'entry',
        data: {
          node,
          direction,
          summary: summary(node),
          errors: issues.filter((issue) => issue.nodeId === node.id && issue.level === 'error').map((issue) => issue.message),
          warnings: issues.filter((issue) => issue.nodeId === node.id && issue.level === 'warning').map((issue) => issue.message),
          live: liveCounts.get(node.id),
          status: (() => {
            const statusId = node.type === 'function' && node.config.fn === 'setStatus' ? (node.config.params as { statusId?: string }).statusId : undefined;
            const status = statusId ? statuses.data?.statuses.find((item) => item.id === statusId) : undefined;
            return status && { name: status.name, color: status.color };
          })(),
        },
      }));
    },
    [current?.definition, search.node, direction, issues, liveCounts, statuses.data, connections.data, measured], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const edges: FlowEdge[] = useMemo(
    () => {
      const all = current?.definition.edges ?? [];
      return all.map((edge) => {
        const branches = all.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length;
        const source = current?.definition.nodes.find((node) => node.id === edge.source);
        const port = source && nodePorts(source).find((item) => item.id === edge.sourceHandle);
        const tone = edge.sourceHandle === 'error' ? 'var(--destructive)' : ['fail', 'false', 'rejected'].includes(edge.sourceHandle) ? 'var(--warning)' : 'var(--graph-edge)';
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: 'in',
          type: 'workflow',
          interactionWidth: 24,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          selected: edge.id === edgeId,
          data: { points: edge.layout?.points, label: port && (branches > 1 ? `${port.label} · 모두 보냄` : port.label), labelPosition: edge.layout?.labelPosition },
          style: { stroke: edge.id === edgeId ? 'var(--primary)' : tone, strokeWidth: edge.id === edgeId || edge.id === hoveredEdgeId ? 3 : 2 },
        };
      });
    },
    [current?.definition, edgeId, hoveredEdgeId],
  );

  const select = (id: string | undefined) => void navigate({ search: (previous) => ({ ...previous, node: id }) });
  const selected = current?.definition.nodes.find((node) => node.id === search.node);
  useReportView('workflow', [
    workflow.data && { kind: '워크플로', id: workflow.data.id, label: workflow.data.name },
    selected && { kind: '워크플로 노드', id: selected.id, label: `${nodeName(selected)} (${selected.type})`, detail: `저장 전 설정: ${JSON.stringify(selected.config).slice(0, 5000)}` },
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

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
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
    if (!moved.length && !removed.length) return;
    const next = applyNodeChanges(moved, nodes);
    setDraft((draftValue) => ({
      ...draftValue,
      definition: {
        ...draftValue.definition,
        nodes: draftValue.definition.nodes.filter((node) => !removed.includes(node.id)).map((node) => ({ ...node, position: next.find((item) => item.id === node.id)?.position ?? node.position })),
        // Every route is global ELK geometry. Any manual node move can stale feedback loops or
        // labels elsewhere, so clear the route snapshot and let React Flow route until re-layout.
        edges: draftValue.definition.edges.filter((edge) => !removed.includes(edge.source) && !removed.includes(edge.target)).map((edge) => ({ ...edge, layout: undefined })),
      },
    }));
    if (removed.includes(search.node ?? '')) select(undefined);
  };
  const removeEdges = (ids: string[]) => {
    setDraft((value) => ({ ...value, definition: { ...value.definition, edges: value.definition.edges.filter((edge) => !ids.includes(edge.id)) } }));
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
      return { ...value, definition: { ...value.definition, edges: added.map(({ id, source, sourceHandle, target }) => ({ id, source, sourceHandle: sourceHandle!, target })) } };
    });
  };

  /** New nodes appear at the centre of the view; AI presets and functions are just pre-filled configs. */
  const addNode = (seed: Pick<WorkflowNode, 'type'> & { label?: string; config?: unknown }, prefix: string, drop?: { x: number; y: number }) => {
    const position = drop ?? flow.screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 });
    const taken = new Set(current?.definition.nodes.map((node) => node.id));
    let id = prefix;
    for (let n = 2; taken.has(id); n++) id = `${prefix}${n}`;
    const node = workflowNodeSchema.parse({ id, position, config: {}, ...seed });
    setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: [...value.definition.nodes, node] } }));
    select(id);
  };

  const arrange = async (layoutDirection: CanvasDirection = direction, keepReadable = true) => {
    if (!current) return;
    const sizes = new Map(flow.getNodes().map((node) => [node.id, { width: node.measured?.width ?? 224, height: node.measured?.height ?? 66 }]));
    try {
      const next = await autoLayout(current.definition, sizes, layoutDirection);
      const positions = new Map(next.nodes.map((node) => [node.id, node.position]));
      setDraft((value) => ({ ...value, definition: { ...value.definition, direction: layoutDirection, nodes: value.definition.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })), edges: next.edges } }));
      const focusId = search.node ?? current.definition.nodes.find((node) => node.type === 'entry')?.id;
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
      const focusId = search.node ?? current.definition.nodes.find((node) => node.type === 'entry')?.id;
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

  if (!workflow.data || !current)
    return (
      <Page title="워크플로">
        <Skeleton className="h-96" />
      </Page>
    );

  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const hasEntry = current.definition.nodes.some((node) => node.type === 'entry');

  const palette: NodeLibraryGroup[] = [
    { id: 'ai', label: 'AI', items: Object.entries(AI_PRESETS).map(([id, preset]) => ({ id, label: preset.label, kind: 'ai', icon: null, description: AI_OUTPUTS[preset.output].description })) },
    { id: 'checks', label: '검사', items: FUNCTION_NAMES.filter((fn) => fn.endsWith('Check')).map((fn) => ({ id: fn, label: FUNCTIONS[fn].label, kind: 'function', icon: null })) },
    { id: 'flow', label: '흐름', items: [
      { id: 'condition', label: '조건 분기', kind: 'condition', icon: null },
      ...FUNCTION_NAMES.filter((fn) => !fn.endsWith('Check') && fn !== 'http').map((fn) => ({ id: fn, label: FUNCTIONS[fn].label, kind: (fn === 'setStatus' ? 'status' : 'function') as 'status' | 'function', icon: null })),
      { id: 'end', label: '종료', kind: 'end', icon: null },
      ...(!hasEntry ? [{ id: 'entry', label: '진입', kind: 'entry' as const, icon: null }] : []),
      { id: 'ai', label: 'AI 자유 형식', kind: 'ai', icon: null },
    ] },
    { id: 'connect', label: '연결', items: [{ id: 'http', label: 'HTTP 호출', kind: 'function', icon: null }] },
  ];
  const addFromLibrary = (id: string, position?: { x: number; y: number }) => {
    const preset = AI_PRESETS[id as keyof typeof AI_PRESETS];
    if (preset) addNode({ type: 'ai', label: preset.label, config: { model: newNodeModel(), output: preset.output, instructions: preset.instructions, include: preset.include, ...(preset.sections && { sections: preset.sections }), ...(preset.batch && { batch: preset.batch }) } }, id, position);
    else if (FUNCTION_NAMES.includes(id as FunctionName)) addNode({ type: 'function', config: { fn: id, params: {} } }, id, position);
    else if (id === 'ai') addNode({ type: 'ai', config: { model: newNodeModel(), output: 'json', fields: [{ name: 'note', type: 'string', description: '' }] } }, id, position);
    else if (id === 'condition') addNode({ type: 'condition', config: { expression: true, description: '' } }, id, position);
    else if (id === 'entry' || id === 'end') addNode({ type: id, config: {} }, id, position);
  };
  const deleteSelected = () => {
    if (!selected || selected.type === 'entry') return;
    setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: value.definition.nodes.filter((node) => node.id !== selected.id), edges: value.definition.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id) } }));
    select(undefined);
  };
  return (
    <Page title={current.name || '워크플로'} flush>
      <PageHeading>
        <Link to="/p/$projectId/workflows" params={{ projectId }} className="text-xs text-muted-foreground">워크플로</Link><ChevronRight className="size-3 text-muted-foreground" />
        <NameField name={current.name} onRename={(name) => setDraft((value) => ({ ...value, name }))} />
        <span className="text-xs text-muted-foreground">v{workflow.data.version}</span>
        <span className="truncate text-xs text-muted-foreground" role="status">{save.isPending ? '저장 중…' : save.isError ? '저장 실패 · 편집 보관됨' : draft ? '저장 대기' : `자동 저장됨 ${savedAt(workflow.data.updatedAt)}`}</span>
      </PageHeading>
      <HeaderActions>
        <RunDialog projectId={projectId} workflowId={workflowId} disabled={errorCount > 0 || save.isPending} dirty={Boolean(draft)} />
        {draft && <Button variant="ghost" disabled={save.isPending} onClick={discard}>저장 전 편집 되돌리기</Button>}
      </HeaderActions>
      {save.isError && <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">저장하지 못했습니다. 편집은 이 브라우저에 보관됩니다. {save.error.message}<Button variant="outline" disabled={stale || !draft} onClick={() => draft && save.mutate(draft)}>다시 저장</Button></div>}
      {stale && !save.isPending && (
        <div className="flex items-center gap-3 border-b bg-warning/10 px-6 py-2 text-sm text-warning">
          편집하는 동안 다른 곳에서 이 워크플로를 저장했습니다({savedAt(workflow.data.updatedAt)}). 이 편집은 그 전 내용을 바탕으로 합니다.
          <Button variant="outline" onClick={discard}>
            편집 버리고 최신 불러오기
          </Button>
        </div>
      )}
      <SplitPane
        id="workflow"
        selectionKey={selected?.id}
        defaultWidth="360px"
        className="h-full"
        pane={
          selected && (
            <div className="h-full min-w-0 overflow-x-hidden bg-background">
              <NodeConfig
                key={`${selected.id}:${revision}`}
                node={selected}
                tab={search.nodeTab ?? 'settings'}
                onTab={(nodeTab) => void navigate({ search: (previous) => ({ ...previous, nodeTab: nodeTab === 'settings' ? undefined : nodeTab }) })}
                issues={issues.filter((issue) => issue.nodeId === selected.id)}
                refs={{
                  statuses: statuses.data?.statuses ?? [],
                  tags: lineTags(statuses.data?.tags),
                  projectId,
                  connections: connections.data ?? [],
                  nodes: current.definition.nodes,
                  edges: current.definition.edges,
                }}
                onChange={(next) => setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: value.definition.nodes.map((node) => (node.id === next.id ? next : node)), edges: value.definition.edges.map((edge) => ({ ...edge, layout: undefined })) } }))}
                onDelete={deleteSelected}
                onClose={() => select(undefined)}
              />
            </div>
          )
        }
      >
        <div className="flex min-h-0 flex-1 pb-7">
        <NodeLibrary groups={palette} onSelect={(item) => addFromLibrary(item.id)} className="w-[200px] shrink-0 border-r border-border" />
        <CanvasSurface ref={canvasRef} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData('application/x-loca-workflow-node');
          if (palette.some((group) => group.items.some((item) => item.id === id))) addFromLibrary(id, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}>
          <ReactFlow colorMode={dark ? 'dark' : 'light'}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => (select(node.id), setEdgeId(undefined))}
            onEdgeClick={(_event, edge) => setEdgeId(edge.id)}
            onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdgeId(undefined)}
            onPaneClick={() => (select(undefined), setEdgeId(undefined))}
            onInit={(instance) => { const held = readViewport(workflowId, direction); if (held) void instance.setViewport(held); else focusWorkflowNode(instance, search.node ?? current.definition.nodes.find((node) => node.type === 'entry')?.id, direction, canvasRef.current); }}
            onMoveEnd={(_event, viewport) => sessionStorage.setItem(viewportKey(workflowId, direction), JSON.stringify(viewport))}
            minZoom={0.05}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background size={1.5} gap={20} color="var(--graph-grid)" />
            <Panel position="bottom-left"><CanvasLegend /></Panel>
            <Panel position="bottom-right"><CanvasToolbar zoomPercent={zoom * 100} onZoomIn={() => void flow.zoomIn()} onZoomOut={() => void flow.zoomOut()} onFit={() => fitWholeWorkflow(flow, 200)} onResetZoom={() => void flow.zoomTo(1, { duration: 180 })} onLayout={() => void arrange(direction, true)} layoutLabel="자동 정렬" direction={direction} onDirectionChange={changeDirection} minimapVisible={minimap} onToggleMinimap={() => setMinimap((value) => !value)} /></Panel>
            {minimap && <MiniMap position="top-right" pannable zoomable />}
            {selected && <NodeToolbar nodeId={selected.id} isVisible position={Position.Top} offset={16}><SelectionToolbox actions={[
              ...(selected.type !== 'entry' ? [{ id: 'copy', label: '복제', icon: <Copy />, onSelect: () => addNode({ type: selected.type, label: selected.label, config: structuredClone(selected.config) }, selected.id + '-copy', { x: selected.position.x + 240, y: selected.position.y }) },
              { id: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: deleteSelected }] : []),
            ]} /></NodeToolbar>}
            {edgeId && <Panel position="top-center"><SelectionToolbox actions={[{ id: 'delete-edge', label: '연결 삭제', icon: <Trash2 />, destructive: true, onSelect: () => removeEdges([edgeId]) }]} /></Panel>}
          </ReactFlow>
        </CanvasSurface>
        </div>
      </SplitPane>
      <StatusBarItem>
        <span className="mr-3 whitespace-nowrap tabular-nums">워크플로 노드 {current.definition.nodes.length}</span>
        {issues.length > 0 && <span className={errorCount ? 'text-destructive' : 'text-warning'}>{errorCount ? `오류 ${errorCount}` : `경고 ${issues.length}`} · {issues[0]?.message}</span>}
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
