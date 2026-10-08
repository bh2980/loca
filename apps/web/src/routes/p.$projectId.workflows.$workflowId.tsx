import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type NodeChange,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronLeft, LayoutGrid, Plus, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { AI_OUTPUTS, AI_PRESETS, FUNCTIONS, FUNCTION_NAMES, nodeName, workflowNodeSchema, type FunctionName, type WorkflowDefinition, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
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
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

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
  const profiles = useQuery(q.profiles());
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
      toast.success(`v${row.version} 저장했습니다.`);
    },
  });

  const statusName = new Map(statuses.data?.statuses.map((status) => [status.id, status.name]));
  const profileName = new Map(profiles.data?.map((profile) => [profile.id, profile.name]));
  const connectionName = new Map(connections.data?.map((connection) => [connection.id, connection.name]));
  const summary = (node: WorkflowNode): string => {
    switch (node.type) {
      case 'entry':
        return node.config.statusIds.length ? node.config.statusIds.map((id) => statusName.get(id) ?? '삭제된 상태').join(', ') : '범위 안의 모든 대사';
      case 'ai': {
        const batch = node.config.batch.mode === 'unit' ? '하나씩' : node.config.batch.mode === 'group' ? `장면별 ≤${node.config.batch.size}` : `${node.config.batch.size}개씩`;
        return `${AI_OUTPUTS[node.config.output].label} · ${profileName.get(node.config.profileId) ?? '프로필 없음'} · ${batch}`;
      }
      case 'function': {
        const params = node.config.params as Record<string, unknown>;
        if (node.config.fn === 'setStatus')
          return [params.statusId && `→ ${statusName.get(params.statusId as string) ?? '삭제된 상태'}`, params.applyCandidate && '대표 번역 적용'].filter(Boolean).join(' · ') || '변경 없음';
        if (node.config.fn === 'http') return `${(params.method as string) ?? 'POST'} ${connectionName.get(params.connectionId as string) ?? '연결 없음'}/${(params.path as string) ?? ''}`;
        if (node.config.fn === 'script') return `출구: ${((params.ports as string[]) ?? ['out']).join(', ')}`;
        return FUNCTIONS[node.config.fn as FunctionName]?.description ?? node.config.fn;
      }
      case 'condition':
        return node.config.description || '조건식';
      case 'human':
        return node.config.instructions || '검토함에서 승인/반려';
      default:
        return '';
    }
  };

  const liveCounts = useMemo(() => {
    const counts = new Map<string, { queued: number; running: number; waiting: number; failed: number }>();
    for (const row of live.data?.nodes ?? []) {
      const entry = counts.get(row.nodeId) ?? { queued: 0, running: 0, waiting: 0, failed: 0 };
      if (row.state in entry) entry[row.state as keyof typeof entry] += row.count;
      counts.set(row.nodeId, entry);
    }
    return counts;
  }, [live.data]);

  const nodes: FlowNode[] = useMemo(
    () =>
      (current?.definition.nodes ?? []).map((node) => ({
        id: node.id,
        type: 'workflow',
        position: node.position,
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
    [current?.definition, search.node, issues, liveCounts, statuses.data, profiles.data, connections.data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const edges: Edge[] = useMemo(
    () =>
      (current?.definition.edges ?? []).map((edge) => {
        const negative = ['error', 'fail', 'false', 'rejected'].includes(edge.sourceHandle);
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: 'in',
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: negative ? { stroke: '#fb7185', strokeDasharray: '5 4' } : { stroke: '#a1a1aa' },
        };
      }),
    [current?.definition.edges],
  );

  const select = (id: string | undefined) => void navigate({ search: { node: id }, replace: true });
  const selected = current?.definition.nodes.find((node) => node.id === search.node);
  useReportView('workflow', [
    workflow.data && { kind: '워크플로', id: workflow.data.id, label: `${workflow.data.name} v${workflow.data.version}` },
    selected && { kind: '워크플로 노드', id: selected.id, label: nodeName(selected) },
  ]);

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const moved = changes.filter((change) => change.type === 'position' && change.position);
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
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length) setDraft((value) => ({ ...value, definition: { ...value.definition, edges: value.definition.edges.filter((edge) => !removed.includes(edge.id)) } }));
  };
  const onConnect = (connection: Connection) => {
    if (!connection.sourceHandle || connection.source === connection.target && false) return;
    setDraft((value) => {
      // One edge per exit: connecting an exit again replaces its previous edge.
      const kept = value.definition.edges.filter((edge) => !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle));
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
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 300 }));
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
      title={
        <span className="flex items-center gap-2">
          <Input
            value={current.name}
            onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
            className="h-8 w-72 border-transparent px-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-input"
            aria-label="워크플로 이름"
          />
          <Badge variant="outline">v{workflow.data.version}</Badge>
          {draft && <Badge variant="secondary">저장 안 됨</Badge>}
        </span>
      }
      description={errorCount ? `오류 ${errorCount}개를 고쳐야 저장한 버전을 실행할 수 있습니다.` : '대사가 진입 노드에서 출발해 연결을 따라 이동합니다. 출구를 드래그해 연결하세요.'}
      actions={
        <>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/p/$projectId/workflows" params={{ projectId }}>
              <ChevronLeft /> 목록
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
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
                  onSelect={() => addNode({ type: 'ai', label: preset.label, config: { profileId: profiles.data?.[0]?.id ?? '', output: preset.output, instructions: preset.instructions, include: preset.include } }, key)}
                />
              ))}
              <PaletteItem
                icon={nodeIcon({ type: 'ai', config: { output: 'json' } } as WorkflowNode)}
                title="AI 자유 형식"
                description="필드를 직접 정해 대사마다 채우게 합니다."
                onSelect={() => addNode({ type: 'ai', config: { profileId: profiles.data?.[0]?.id ?? '', output: 'json', fields: [{ name: 'note', type: 'string', description: '' }] } }, 'ai')}
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
              <PaletteItem icon={nodeIcon({ type: 'human' } as WorkflowNode)} title="사람 확인" description="검토함에서 승인/반려를 기다립니다." onSelect={() => addNode({ type: 'human', config: {} }, 'human')} />
              <PaletteItem icon={nodeIcon({ type: 'end' } as WorkflowNode)} title="종료" description="대사의 흐름을 마칩니다." onSelect={() => addNode({ type: 'end', config: {} }, 'end')} />
              {!hasEntry && <PaletteItem icon={nodeIcon({ type: 'entry' } as WorkflowNode)} title="진입" description="대사가 흐름에 들어오는 곳" onSelect={() => addNode({ type: 'entry', config: {} }, 'entry')} />}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => void arrange()}>
            <LayoutGrid /> 자동 정렬
          </Button>
          {draft && (
            <Button variant="ghost" size="sm" onClick={discard}>
              <RotateCcw /> 되돌리기
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={!draft || stale || save.isPending} onClick={() => save.mutate()}>
            <Save /> 저장
          </Button>
          <RunDialog projectId={projectId} workflowId={workflowId} disabled={(workflow.data.issues ?? []).some((issue) => issue.level === 'error')} dirty={Boolean(draft)} />
        </>
      }
      flush
    >
      {stale && (
        <div className="flex items-center gap-3 border-b bg-amber-50 px-6 py-2 text-sm text-amber-900">
          다른 곳에서 v{workflow.data.version}을 저장했습니다. 이 편집은 v{draft!.baseVersion} 기준입니다.
          <Button size="sm" variant="outline" onClick={discard}>
            편집 버리고 최신 불러오기
          </Button>
        </div>
      )}
      <div className="absolute inset-0 flex" style={stale ? { top: 41 } : undefined}>
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => select(node.id)}
            onPaneClick={() => select(undefined)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="var(--graph-grid)" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
        {selected && (
          <div className="w-[360px] shrink-0 border-l bg-background">
            <NodeConfig
              node={selected}
              issues={issues.filter((issue) => issue.nodeId === selected.id)}
              refs={{
                statuses: statuses.data?.statuses ?? [],
                tags: statuses.data?.tags ?? [],
                projectId,
                profiles: profiles.data ?? [],
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
        )}
      </div>
    </Page>
  );
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
