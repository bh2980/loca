import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  Controls,
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
import { ChevronLeft, LayoutGrid, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AI_OUTPUTS, AI_PRESETS, FUNCTIONS, FUNCTION_NAMES, nodeModels, nodeName, workflowNodeSchema, type FunctionName, type WorkflowDefinition, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { Page } from '@/components/page';
import { autoLayout } from '@/components/workflow/auto-layout';
import { NodeConfig } from '@/components/workflow/node-config';
import { nodeIcon, WorkflowNodeView, type FlowNode } from '@/components/workflow/node-view';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { client, unwrap } from '@/lib/api';
import { lineTags, q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { workflowEdits } from '@/lib/workflow-edits';
import { sameWorkflowDraft } from '@/lib/workflow-draft';
import { SplitPane } from '@/components/split-pane';
import { dateTime } from '@/lib/datetime';

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
  validateSearch: (raw: Record<string, unknown>): { node?: string } => ({ node: typeof raw.node === 'string' ? raw.node : undefined }),
  component: () => (
    <ReactFlowProvider>
      <WorkflowEditor />
    </ReactFlowProvider>
  ),
});

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

function WorkflowEditor() {
  const { projectId, workflowId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const flow = useReactFlow();
  const workflow = useQuery(q.workflow(workflowId));
  const statuses = useQuery(q.statuses(projectId));
  const connections = useQuery(q.connections());
  const runs = useQuery(q.runs(projectId));
  const activeRun = runs.data?.find((run) => run.workflowId === workflowId && (run.status === 'running' || run.status === 'paused'));
  const live = useQuery({ ...q.run(activeRun?.id ?? ''), enabled: Boolean(activeRun) });

  // The draft survives navigation and reloads; it is dropped only on save or explicit discard.
  const [draft, setDraftState] = useState<Draft | null>(() => readDraft(workflowId));
  const setDraft = useCallback(
    (update: (current: Draft) => Draft) =>
      setDraftState((current) => {
        const base = current ?? (workflow.data ? { baseVersion: workflow.data.version, name: workflow.data.name, definition: workflow.data.definition } : null);
        if (!base) return current;
        const next = update(base);
        // React Flow reports no-op position changes while it renders; an edit equal to the saved
        // version (or to the current draft) is not a change and must not mark the workflow dirty.
        const saved = workflow.data && { baseVersion: workflow.data.version, name: workflow.data.name, definition: workflow.data.definition };
        if (saved && sameWorkflowDraft(next, saved)) {
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
  const stale = Boolean(draft && workflow.data && draft.baseVersion !== workflow.data.version);

  // Validate the draft on the server (same rules as run start), debounced.
  const [issues, setIssues] = useState<WorkflowIssue[]>([]);
  // The selected line (for Delete/Backspace and the "선 삭제" button); edges are rebuilt from the
  // definition, so their selection is kept here.
  const [edgeId, setEdgeId] = useState<string>();
  useEffect(() => {
    if (!current) return;
    if (!draft) return setIssues(workflow.data?.issues ?? []);
    const timer = setTimeout(() => {
      void unwrap(client.workflows[':id'].validate.$post({ param: { id: workflowId }, json: { definition: current.definition } }))
        .then(setIssues)
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [current?.definition, draft, workflow.data, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => unwrap(client.workflows[':id'].$put({ param: { id: workflowId }, json: { name: current!.name, description: workflow.data!.description, definition: current!.definition, version: workflow.data!.version } })),
    onSuccess: (row) => {
      discard();
      setIssues(row.issues);
      toast.success('저장했습니다.');
    },
  });

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
        const batch = node.config.batch.mode === 'unit' ? '하나씩' : node.config.batch.mode === 'group' ? `장면별 ≤${node.config.batch.size}` : node.config.batch.mode === 'whole' ? '대본 전체' : `${node.config.batch.size}개씩`;
        const model = node.config.model.model ? [connectionName.get(node.config.model.connectionId) ?? (connections.data ? '삭제된 연결' : undefined), node.config.model.model].filter(Boolean).join(' · ') : '모델 없음';
        return `${AI_OUTPUTS[node.config.output].label} · ${model}${nodeModels(node).length > 1 ? ` 외 ${nodeModels(node).length - 1}개` : ''} · ${batch}`;
      }
      case 'function': {
        const params = node.config.params as Record<string, unknown>;
        if (node.config.fn === 'setStatus')
          return [params.statusId && `→ ${statusName.get(params.statusId as string) ?? '삭제된 상태'}`].filter(Boolean).join(' · ') || '변경 없음';
        if (node.config.fn === 'http') return `${(params.method as string) ?? 'POST'} ${connectionName.get(params.connectionId as string) ?? '연결 없음'}/${(params.path as string) ?? ''}`;
        if (node.config.fn === 'script') return `출구: ${((params.ports as string[]) ?? ['out']).join(', ')}`;
        if (node.config.fn === 'formatCheck') {
          const checks = [params.placeholders !== false && '자리표시자', params.tags !== false && '서식 태그', params.newlines !== false && '줄바꿈', params.emptyText !== false && '빈 번역'].filter(Boolean);
          return checks.length ? `검사: ${checks.join('·')}` : '켠 검사 항목 없음 (항상 통과)';
        }
        return FUNCTIONS[node.config.fn as FunctionName]?.description ?? node.config.fn;
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
    () =>
      (current?.definition.nodes ?? []).map((node) => ({
        id: node.id,
        type: 'workflow',
        position: node.position,
        measured: measured[node.id],
        selected: node.id === search.node,
        deletable: node.type !== 'entry',
        data: {
          node,
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
      })),
    [current?.definition, search.node, issues, liveCounts, statuses.data, connections.data, measured], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const edges: Edge[] = useMemo(
    () => {
      const all = current?.definition.edges ?? [];
      return all.map((edge) => {
        const branches = all.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length;
        const negative = ['error', 'fail', 'false', 'rejected'].includes(edge.sourceHandle);
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: 'in',
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          selected: edge.id === edgeId,
          ...(branches > 1 ? { label: '모두 보냄', labelStyle: { fontSize: 11, fill: '#71717a' }, labelBgStyle: { fill: '#ffffff' } } : {}),
          style: { ...(negative ? { stroke: '#fb7185', strokeDasharray: '5 4' } : { stroke: '#a1a1aa' }), ...(edge.id === edgeId && { strokeWidth: 2.5 }) },
        };
      });
    },
    [current?.definition.edges, edgeId],
  );

  const select = (id: string | undefined) => void navigate({ search: { node: id }, replace: true });
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
        setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: value.definition.nodes.map((candidate) => (candidate.id === node.id ? next : candidate)) } }));
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
        edges: draftValue.definition.edges.filter((edge) => !removed.includes(edge.source) && !removed.includes(edge.target)),
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
  const addNode = (seed: Pick<WorkflowNode, 'type'> & { label?: string; config?: unknown }, prefix: string) => {
    const position = flow.screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 });
    const taken = new Set(current?.definition.nodes.map((node) => node.id));
    let id = prefix;
    for (let n = 2; taken.has(id); n++) id = `${prefix}${n}`;
    const node = workflowNodeSchema.parse({ id, position, config: {}, ...seed });
    setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: [...value.definition.nodes, node] } }));
    select(id);
  };

  const arrange = async () => {
    if (!current) return;
    const sizes = new Map(flow.getNodes().map((node) => [node.id, { width: node.measured?.width ?? 224, height: node.measured?.height ?? 120 }]));
    const next = await autoLayout(current.definition, sizes);
    setDraft((value) => ({ ...value, definition: next }));
    requestAnimationFrame(() => fitReadable(flow, 300));
  };

  if (!workflow.data || !current)
    return (
      <Page title="워크플로">
        <Skeleton className="h-96" />
      </Page>
    );

  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const hasEntry = current.definition.nodes.some((node) => node.type === 'entry');

  return (
    <Page
      title={current.name || '워크플로'}
      back={
        <Button variant="ghost" asChild>
          <Link to="/p/$projectId/workflows" params={{ projectId }}>
            <ChevronLeft /> 워크플로 목록
          </Link>
        </Button>
      }
      meta={
        <span className="flex items-center gap-2">
          <NameField name={current.name} onRename={(name) => setDraft((value) => ({ ...value, name }))} />
          {draft ? <Badge variant="secondary">저장 안 됨</Badge> : <span className="text-xs text-muted-foreground">{savedAt(workflow.data.updatedAt)} 저장</span>}
          {errorCount > 0 && <span className="truncate text-destructive">오류 {errorCount}개 — 저장한 버전에 오류가 없어야 실행할 수 있습니다.</span>}
        </span>
      }
      actions={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Plus /> 노드 추가
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">AI</DropdownMenuLabel>
              {Object.entries(AI_PRESETS).map(([key, preset]) => (
                <PaletteItem
                  key={key}
                  icon={nodeIcon({ type: 'ai', config: { output: preset.output } } as WorkflowNode)}
                  title={preset.label}
                  description={AI_OUTPUTS[preset.output].description}
                  onSelect={() => addNode({ type: 'ai', label: preset.label, config: { model: newNodeModel(), output: preset.output, instructions: preset.instructions, include: preset.include } }, key)}
                />
              ))}
              <PaletteItem
                icon={nodeIcon({ type: 'ai', config: { output: 'json' } } as WorkflowNode)}
                title="AI 자유 형식"
                description="필드를 직접 정해 대사마다 채우게 합니다."
                onSelect={() => addNode({ type: 'ai', config: { model: newNodeModel(), output: 'json', fields: [{ name: 'note', type: 'string', description: '' }] } }, 'ai')}
              />
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">함수</DropdownMenuLabel>
              {FUNCTION_NAMES.map((fn) => (
                <PaletteItem
                  key={fn}
                  icon={nodeIcon({ type: 'function', config: { fn, params: {} } } as WorkflowNode)}
                  title={FUNCTIONS[fn].label}
                  description={FUNCTIONS[fn].description}
                  onSelect={() => addNode({ type: 'function', config: { fn, params: {} } }, fn)}
                />
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">흐름</DropdownMenuLabel>
              <PaletteItem icon={nodeIcon({ type: 'condition' } as WorkflowNode)} title="조건" description="방문 횟수·앞 노드 출력으로 분기합니다." onSelect={() => addNode({ type: 'condition', config: { expression: true, description: '' } }, 'condition')} />
              <PaletteItem icon={nodeIcon({ type: 'end' } as WorkflowNode)} title="종료" description="대사의 흐름을 마칩니다." onSelect={() => addNode({ type: 'end', config: {} }, 'end')} />
              {!hasEntry && <PaletteItem icon={nodeIcon({ type: 'entry' } as WorkflowNode)} title="진입" description="대사가 흐름에 들어오는 곳" onSelect={() => addNode({ type: 'entry', config: {} }, 'entry')} />}
            </DropdownMenuContent>
          </DropdownMenu>
          {edgeId && current?.definition.edges.some((edge) => edge.id === edgeId) && (
            <Button variant="ghost" className="text-destructive" onClick={() => removeEdges([edgeId])}>
              <Trash2 /> 선 삭제
            </Button>
          )}
          <Button variant="outline" onClick={() => void arrange()}>
            <LayoutGrid /> 자동 정렬
          </Button>
          {draft && (
            <Button variant="ghost" onClick={discard}>
              <RotateCcw /> 되돌리기
            </Button>
          )}
          <Button variant="outline" disabled={!draft || stale || save.isPending} onClick={() => save.mutate()}>
            <Save /> 저장
          </Button>
          <RunDialog projectId={projectId} workflowId={workflowId} disabled={(workflow.data.issues ?? []).some((issue) => issue.level === 'error')} dirty={Boolean(draft)} />
        </>
      }
      flush
    >
      {stale && (
        <div className="flex items-center gap-3 border-b bg-warning/10 px-6 py-2 text-sm text-warning">
          편집하는 동안 다른 곳에서 이 워크플로를 저장했습니다({savedAt(workflow.data.updatedAt)}). 이 편집은 그 전 내용을 바탕으로 합니다.
          <Button variant="outline" onClick={discard}>
            편집 버리고 최신 불러오기
          </Button>
        </div>
      )}
      <SplitPane
        id="workflow"
        defaultWidth="360px"
        className="absolute inset-0"
        style={stale ? { top: 41 } : undefined}
        pane={
          selected && (
            <div className="h-full min-w-0 overflow-x-hidden bg-background">
              <NodeConfig
                key={`${selected.id}:${revision}`}
                node={selected}
                issues={issues.filter((issue) => issue.nodeId === selected.id)}
                refs={{
                  statuses: statuses.data?.statuses ?? [],
                  tags: lineTags(statuses.data?.tags),
                  projectId,
                  connections: connections.data ?? [],
                  nodes: current.definition.nodes,
                }}
                onChange={(next) => setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: value.definition.nodes.map((node) => (node.id === next.id ? next : node)) } }))}
                onDelete={() => {
                  setDraft((value) => ({
                    ...value,
                    definition: {
                      ...value.definition,
                      nodes: value.definition.nodes.filter((node) => node.id !== selected.id),
                      edges: value.definition.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id),
                    },
                  }));
                  select(undefined);
                }}
                onClose={() => select(undefined)}
              />
            </div>
          )
        }
      >
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => (select(node.id), setEdgeId(undefined))}
            onEdgeClick={(_event, edge) => setEdgeId(edge.id)}
            onPaneClick={() => (select(undefined), setEdgeId(undefined))}
            onInit={(instance) => fitReadable(instance)}
            minZoom={0.2}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="var(--graph-grid)" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      </SplitPane>
    </Page>
  );
}

const READABLE_ZOOM = 0.7;

/**
 * Fit the whole workflow, but never zoom out so far that node names stop being readable. When it
 * does not fit at that zoom, show it from the left edge (where the entry is) and let the user pan.
 */
function fitReadable<N extends Node>(flow: ReactFlowInstance<N, Edge>, duration = 0) {
  const nodes = flow.getNodes();
  if (!nodes.length) return;
  void flow.fitView({ padding: 0.1, maxZoom: 1, minZoom: READABLE_ZOOM, duration }).then(() => {
    const { zoom, y } = flow.getViewport();
    if (zoom > READABLE_ZOOM + 0.001) return;
    const bounds = flow.getNodesBounds(nodes);
    void flow.setViewport({ x: 32 - bounds.x * zoom, y, zoom }, { duration });
  });
}

function PaletteItem({ icon: Icon, title, description, onSelect }: { icon: typeof Plus; title: string; description: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start">
      <Icon className="mt-0.5" />
      <div>
        <p className="text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </DropdownMenuItem>
  );
}
