/**
 * A run's workflow as a graph (실행 기록 › 그래프): the definition the run froze, read-only, each node
 * with what it is doing now (requests in flight against its 동시 처리 수, lines being worked on,
 * waiting, failed) and how many lines went through it. Clicking a node opens the lines at it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Panel, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, useViewport, type NodeChange, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import type { WorkflowDefinition } from '@tw/shared';
import { Button, CanvasToolbar, type CanvasDirection } from '@loca/ui';
import { X } from 'lucide-react';
import { ITEM_STATE } from '@/lib/labels';
import { callMembers, callOf, collapseCalls, liveCounts, topCallIds } from '@/components/workflow/run-calls';
import { allFoldsOpen, computeFolds, foldedDefinition, foldLiveText, foldPlacements, foldText, isFoldOpen, openFoldContaining, setAllFolds, toggleFold, type Fold } from '@/components/workflow/fold';
import { useFoldState } from '@/components/workflow/use-fold-state';
import { WorkflowNodeView, type FlowNode } from '@/components/workflow/node-view';
import { WorkflowEdgeView } from '@/components/workflow/workflow-edge';
import { entryStarts, flowEdges, nodeSummary, openPorts, targetStatus } from '@/components/workflow/flow-graph';
import { q } from '@/lib/queries';
import { retryLiveText } from '@/lib/retry-info';
import { useIsDark } from '@/lib/theme';

const nodeTypes = { workflow: WorkflowNodeView };
/** The whole graph, never larger than 100%. */
const FIT = { padding: 0.2, maxZoom: 1, minZoom: 0.05 };
const edgeTypes = { workflow: WorkflowEdgeView };

export interface RunGraphData {
  id: string;
  definition: WorkflowDefinition;
  nodes: { nodeId: string; state: string; count: number }[];
  calls: Record<string, number>;
  callLimits: Record<string, number>;
  passed: Record<string, number>;
  retrying?: Record<string, { count: number; kinds: Record<string, number> }>;
}

const viewportKey = (runId: string) => `loca.run.viewport.${runId}`;
function readViewport(runId: string): Viewport | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(viewportKey(runId)) ?? 'null');
    return value && [value.x, value.y, value.zoom].every(Number.isFinite) && value.zoom > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function RunGraph(props: { projectId: string; run: RunGraphData; selected?: string; onOpenNode: (nodeId: string) => void }) {
  return (
    <ReactFlowProvider key={props.run.id}>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

function Graph({ projectId, run, selected, onOpenNode }: { projectId: string; run: RunGraphData; selected?: string; onOpenNode: (nodeId: string) => void }) {
  const dark = useIsDark();
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const statuses = useQuery(q.statuses(projectId));
  const connections = useQuery(q.connections());
  // Each call is one card (its nodes are listed when it is opened); the run's own definition has them expanded.
  const definition = useMemo(() => collapseCalls(run.definition), [run.definition]);
  const [openCall, setOpenCall] = useState<string>();
  const direction: CanvasDirection = definition.direction ?? 'vertical';
  const saved = useMemo(() => readViewport(run.id), [run.id]);

  const live = useMemo(() => liveCounts(run.definition, run), [run]);

  // Nodes are rebuilt on every refresh; the sizes React Flow measured go back on them (as in the editor),
  // or a rebuilt node is unmeasured again and the view cannot fit it.
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const sized = changes.flatMap((change) => (change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : []));
    if (sized.length) setSizes((previous) => ({ ...previous, ...Object.fromEntries(sized) }));
  };
  // 접기, as in the editor: side nodes are chips (with their lines' counts) until opened.
  const folds = useMemo(() => computeFolds(definition), [definition]);
  const [foldState, setFoldState] = useFoldState(`loca.run.folds.${run.id}`);
  const openFolds = useMemo(() => new Set(foldState.open), [foldState]);
  const view = useMemo(() => foldedDefinition(definition, folds, openFolds), [definition, folds, openFolds]);
  const placements = useMemo(() => foldPlacements(definition, folds, openFolds, new Map(Object.entries(sizes)), direction), [definition, folds, openFolds, sizes, direction]);
  useEffect(() => setFoldState((state) => openFoldContaining(state, folds, selected)), [selected, folds, setFoldState]);
  const nodes: FlowNode[] = useMemo(() => {
    const names = { status: new Map(statuses.data?.statuses.map((status) => [status.id, status.name])), connection: new Map(connections.data?.map((connection) => [connection.id, connection.name])), connectionsLoaded: Boolean(connections.data) };
    const { entry, starts, label } = entryStarts(definition, names);
    const foldNames = { status: names.status };
    const chip = (fold: Fold) => ({ text: foldText(definition, fold, foldNames), open: isFoldOpen(foldState, fold.id), live: foldLiveText(fold, live), onToggle: () => setFoldState((state) => toggleFold(state, fold.id)) });
    return view.definition.nodes
      .filter((node) => node.type !== 'entry' && node.type !== 'end')
      .map((node) => ({
        id: node.id,
        type: 'workflow',
        position: placements.get(node.id) ?? node.position,
        measured: sizes[node.id],
        selected: node.id === selected || callOf(run.definition, selected ?? '') === node.id,
        draggable: false,
        connectable: false,
        deletable: false,
        data: {
          node,
          direction,
          summary: node.type === 'call' ? `노드 ${run.definition.nodes.filter((inner) => inner.id.startsWith(`${node.id}/`)).length}개` : nodeSummary(node, definition, names),
          errors: [],
          warnings: [],
          live: live.get(node.id) && { ...live.get(node.id)!, retry: retryLiveText(live.get(node.id)!.retrying) || undefined },
          start: starts.has(node.id) && entry ? { label } : undefined,
          open: openPorts(node, definition),
          status: targetStatus(node, statuses.data?.statuses),
          folds: Object.fromEntries(folds.filter((fold) => fold.kind === 'branch' && fold.owner === node.id).map((fold) => [fold.port, chip(fold)])),
          foldClose: (() => { const fold = folds.find((item) => item.kind === 'edge' && item.nodeIds[0] === node.id && isFoldOpen(foldState, item.id)); return fold && (() => setFoldState((state) => toggleFold(state, fold.id))); })(),
        },
      }));
  }, [definition, view, folds, foldState, placements, run.definition, direction, live, selected, sizes, statuses.data, connections.data, setFoldState]);
  const edges = useMemo(() => {
    const chips = new Map(view.closed.filter((fold) => fold.kind === 'edge').map((fold) => [fold.edgeId, fold] as const));
    const foldNames = { status: new Map(statuses.data?.statuses.map((status) => [status.id, status.name])) };
    return flowEdges(view.definition).map((edge) => {
      const fold = chips.get(edge.id);
      return fold ? { ...edge, data: { ...edge.data, fold: { text: foldText(definition, fold, foldNames), live: foldLiveText(fold, live), onToggle: () => setFoldState((state) => toggleFold(state, fold.id)) } } } : edge;
    });
  }, [view, definition, live, statuses.data, setFoldState]);

  // A remembered view comes back as it was; the first look fits the whole graph once every node is measured.
  const measured = useNodesInitialized();
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !measured) return;
    placed.current = true;
    void (saved ? flow.setViewport(saved) : flow.fitView(FIT));
  }, [measured, saved, flow]);

  return (
    <ReactFlow
      colorMode={dark ? 'dark' : 'light'}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      minZoom={0.05}
      onNodeClick={(_event, node) => (topCallIds(run.definition).includes(node.id) ? setOpenCall((open) => (open === node.id ? undefined : node.id)) : onOpenNode(node.id))}
      onMoveEnd={(_event, viewport) => {
        try {
          sessionStorage.setItem(viewportKey(run.id), JSON.stringify(viewport));
        } catch {
          // A view that is not remembered only fits again next time.
        }
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      {openCall && (
        <Panel position="top-left" className="max-h-[70%] w-80 overflow-auto rounded-md border bg-card p-3 text-sm shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium" title={run.definition.calls?.[openCall]?.name}>{run.definition.calls?.[openCall]?.name} · 안의 노드</span>
            <Button variant="ghost" size="sm" aria-label="닫기" onClick={() => setOpenCall(undefined)}><X /></Button>
          </div>
          <ul className="space-y-1">
            {callMembers(run.definition, openCall, run.nodes).map((member) => (
              <li key={member.node.id} className={member.depth ? 'pl-4' : undefined}>
                <Button variant="ghost" size="sm" className="h-auto w-full justify-between gap-2 py-1 font-normal" title="이 노드의 대사 보기" onClick={() => onOpenNode(member.node.id)}>
                  <span className="min-w-0 truncate text-left">{member.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {(Object.keys(ITEM_STATE) as (keyof typeof ITEM_STATE)[]).filter((state) => member.counts[state]).map((state) => `${ITEM_STATE[state]} ${member.counts[state]!.toLocaleString()}`).join(' · ') || '대사 없음'}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => onOpenNode(openCall)}>이 호출의 대사 전체 보기</Button>
        </Panel>
      )}
      <Panel position="bottom-right">
        <CanvasToolbar zoomPercent={zoom * 100} onZoomIn={() => void flow.zoomIn()} onZoomOut={() => void flow.zoomOut()} onFit={() => void flow.fitView({ ...FIT, duration: 200 })} onResetZoom={() => void flow.zoomTo(1, { duration: 180 })} foldsOpen={folds.length ? allFoldsOpen(folds, foldState) : undefined} onToggleFolds={() => setFoldState(setAllFolds(folds, !allFoldsOpen(folds, foldState)))} />
      </Panel>
    </ReactFlow>
  );
}
