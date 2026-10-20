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
import { CanvasToolbar, type CanvasDirection } from '@loca/ui';
import { WorkflowNodeView, type FlowNode } from '@/components/workflow/node-view';
import { WorkflowEdgeView } from '@/components/workflow/workflow-edge';
import { entryStarts, flowEdges, nodeSummary, openPorts, targetStatus } from '@/components/workflow/flow-graph';
import { q } from '@/lib/queries';
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
  const definition = run.definition;
  const direction: CanvasDirection = definition.direction ?? 'vertical';
  const saved = useMemo(() => readViewport(run.id), [run.id]);

  const live = useMemo(() => {
    const counts = new Map<string, NonNullable<FlowNode['data']['live']>>();
    const entry = (nodeId: string) => counts.get(nodeId) ?? (counts.set(nodeId, { queued: 0, running: 0, failed: 0 }), counts.get(nodeId)!);
    for (const row of run.nodes) if (row.state === 'queued' || row.state === 'running' || row.state === 'failed') entry(row.nodeId)[row.state] += row.count;
    for (const [nodeId, count] of Object.entries(run.passed)) entry(nodeId).passed = count;
    // Requests in flight against how many the node sends at once (an AI node's 동시 처리 수).
    for (const [nodeId, limit] of Object.entries(run.callLimits)) Object.assign(entry(nodeId), { calls: run.calls[nodeId] ?? 0, limit });
    return counts;
  }, [run.nodes, run.passed, run.calls, run.callLimits]);

  // Nodes are rebuilt on every refresh; the sizes React Flow measured go back on them (as in the editor),
  // or a rebuilt node is unmeasured again and the view cannot fit it.
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const sized = changes.flatMap((change) => (change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : []));
    if (sized.length) setSizes((previous) => ({ ...previous, ...Object.fromEntries(sized) }));
  };
  const nodes: FlowNode[] = useMemo(() => {
    const names = { status: new Map(statuses.data?.statuses.map((status) => [status.id, status.name])), connection: new Map(connections.data?.map((connection) => [connection.id, connection.name])), connectionsLoaded: Boolean(connections.data) };
    const { entry, starts, label } = entryStarts(definition, names);
    return definition.nodes
      .filter((node) => node.type !== 'entry' && node.type !== 'end')
      .map((node) => ({
        id: node.id,
        type: 'workflow',
        position: node.position,
        measured: sizes[node.id],
        selected: node.id === selected,
        draggable: false,
        connectable: false,
        deletable: false,
        data: {
          node,
          direction,
          summary: nodeSummary(node, definition, names),
          errors: [],
          warnings: [],
          live: live.get(node.id),
          start: starts.has(node.id) && entry ? { label } : undefined,
          open: openPorts(node, definition),
          status: targetStatus(node, statuses.data?.statuses),
        },
      }));
  }, [definition, direction, live, selected, sizes, statuses.data, connections.data]);
  const edges = useMemo(() => flowEdges(definition), [definition]);

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
      onNodeClick={(_event, node) => onOpenNode(node.id)}
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
      <Panel position="bottom-right">
        <CanvasToolbar zoomPercent={zoom * 100} onZoomIn={() => void flow.zoomIn()} onZoomOut={() => void flow.zoomOut()} onFit={() => void flow.fitView({ ...FIT, duration: 200 })} onResetZoom={() => void flow.zoomTo(1, { duration: 180 })} />
      </Panel>
    </ReactFlow>
  );
}
