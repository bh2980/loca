/**
 * A run's workflow as a graph (실행 기록 › 그래프): the definition the run froze, read-only, each node
 * with what it is doing now (requests in flight against its 동시 처리 수, lines being worked on,
 * waiting, failed) and how many lines went through it. Clicking a node opens the lines at it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Panel, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, useViewport, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowDefinition } from '@loca/shared';
import { Box, Button, CanvasToolbar, EdgeLegend, Inline, Text, type CanvasDirection, useCanvasDismiss } from '@loca/ui';
import { X } from 'lucide-react';
import { ITEM_STATE } from '@/lib/labels';
import { callMembers, callOf, collapseCalls, liveCounts, topCallIds } from '@/components/workflow/run-calls';
import { frameNodes, frameTints, isFrameId, type FrameNode } from '@/components/workflow/frames';
import { allFoldsOpen, computeFolds, foldedDefinition, foldLiveText, foldPlacements, foldText, isFoldOpen, openFoldContaining, setAllFolds, toggleFold, type Fold } from '@/components/workflow/fold';
import { useFoldState } from '@/components/workflow/use-fold-state';
import type { FlowNode } from '@/components/workflow/node-view';
import { arrangeFlow, FIT_WHOLE as FIT, FLOW_EDGE_TYPES, FLOW_NODE_TYPES, useFlowNames, useMeasuredSizes } from '@/components/workflow/flow-canvas';
import { entryStarts, exitEdges, flowNodeCard } from '@/components/workflow/flow-graph';
import { retryBadge, retryLiveText } from '@/lib/retry-info';
import { useIsDark } from '@/lib/theme';
import { shiftRoute } from '@/components/workflow/route-shift';
import { toast } from 'sonner';
import { stored, STORED } from '@/lib/storage';
import { useStoredViewport } from '@/lib/viewport';

export interface RunGraphData {
  id: string;
  definition: WorkflowDefinition;
  nodes: { nodeId: string; state: string; count: number }[];
  calls: Record<string, number>;
  callLimits: Record<string, number>;
  passed: Record<string, number>;
  retrying?: Record<string, { count: number; kinds: Record<string, number> }>;
}

/**
 * Where this browser put a run's nodes: dragged or arranged here, for looking only. The run's definition (a copy of the
 * workflow as it started) and the workflow itself keep theirs. `routes`: the arranged lines; null after a drag (straight lines).
 */
type RunLayout = { positions: Record<string, { x: number; y: number }>; routes: Record<string, unknown> | null };
const readLayout = (runId: string): RunLayout | undefined => stored(STORED.runGraphLayout, runId).read() ?? undefined;
const writeLayout = (runId: string, layout: RunLayout) => stored(STORED.runGraphLayout, runId).write(layout);

export function RunGraph(props: { projectId: string; run: RunGraphData; selected?: string; onOpenNode: (nodeId: string) => void }) {
  return (
    <ReactFlowProvider key={props.run.id}>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

function Graph({ projectId, run, selected, onOpenNode }: { projectId: string; run: RunGraphData; selected?: string; onOpenNode: (nodeId: string) => void }) {
  const dismiss = useCanvasDismiss();
  const dark = useIsDark();
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const { names } = useFlowNames(projectId);
  // Each call is one card (its nodes are listed when it is opened); the run's own definition has them expanded.
  const [layout, setLayout] = useState<RunLayout | undefined>(() => readLayout(run.id));
  const keepLayout = (next: RunLayout) => {
    setLayout(next);
    writeLayout(run.id, next);
  };
  const definition = useMemo(() => {
    const base = collapseCalls(run.definition);
    if (!layout) return base;
    return {
      ...base,
      nodes: base.nodes.map((node) => (layout.positions[node.id] ? { ...node, position: layout.positions[node.id] } : node)),
      // A layout kept without routes (older pages dropped them on a click) draws the run's own routes; a line whose ends
      // moved away from them is drawn plainly (routeMatchesPorts).
      edges: base.edges.map((edge) => ({ ...edge, layout: (layout.routes?.[edge.id] ?? edge.layout) as typeof edge.layout })),
    };
  }, [run.definition, layout]);
  const [openCall, setOpenCall] = useState<string>();
  const direction: CanvasDirection = definition.direction ?? 'vertical';
  const { initial: saved, save: saveViewport } = useStoredViewport(projectId, 'run', run.id);

  const live = useMemo(() => liveCounts(run.definition, run), [run]);

  // Nodes are rebuilt on every refresh; the sizes React Flow measured go back on them (as in the editor),
  // or a rebuilt node is unmeasured again and the view cannot fit it.
  const [sizes, recordSizes] = useMeasuredSizes();
  // While a node is dragged it follows the pointer here; where it is dropped is kept (and the lines go straight).
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const onNodesChange = (allChanges: NodeChange<FlowNode | FrameNode>[]) => {
    const changes = allChanges.filter((change) => !('id' in change) || !isFrameId(change.id)) as NodeChange<FlowNode>[];
    recordSizes(changes);
    // React Flow reports a position on a plain click too (the node did not move): only a real move counts.
    // Where the node is drawn now (a fold's placement first, as `nodes` draws it).
    const at = (id: string) => placements.get(id) ?? definition.nodes.find((node) => node.id === id)?.position;
    const moved = changes.flatMap((change) => (change.type === 'position' && change.position && (change.dragging || change.position.x !== at(change.id)?.x || change.position.y !== at(change.id)?.y) ? [change] : []));
    if (!moved.length) return;
    const dropped = moved.filter((change) => !change.dragging && at(change.id) && (change.position!.x !== at(change.id)!.x || change.position!.y !== at(change.id)!.y));
    setDragging((previous) => {
      const next = { ...previous };
      for (const change of moved) if (change.dragging) next[change.id] = change.position!; else delete next[change.id];
      return next;
    });
    if (!dropped.length) return;
    // The dropped nodes' lines keep their shape and follow them (shiftRoute); every other line stays as it was.
    const deltas = new Map(dropped.map((change) => [change.id, { dx: change.position!.x - at(change.id)!.x, dy: change.position!.y - at(change.id)!.y }]));
    const still = { dx: 0, dy: 0 };
    keepLayout({
      positions: { ...layout?.positions, ...Object.fromEntries(dropped.map((change) => [change.id, change.position!])) },
      routes: Object.fromEntries(definition.edges.map((edge) => [edge.id, deltas.has(edge.source) || deltas.has(edge.target) ? shiftRoute(edge.layout, deltas.get(edge.source) ?? still, deltas.get(edge.target) ?? still) : edge.layout])),
    });
  };
  const arrange = async () => {
    try {
      const { next } = await arrangeFlow(flow, view.definition, direction, names.marks);
      keepLayout({ positions: { ...layout?.positions, ...Object.fromEntries(next.nodes.map((node) => [node.id, node.position])) }, routes: Object.fromEntries(next.edges.map((edge) => [edge.id, edge.layout])) });
      requestAnimationFrame(() => void flow.fitView({ ...FIT, duration: 300 }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '자동 정렬하지 못했습니다.');
    }
  };
  // 접기, as in the editor: side nodes are chips (with their lines' counts) until opened.
  const folds = useMemo(() => computeFolds(definition), [definition]);
  const [foldState, setFoldState] = useFoldState(`run.${run.id}`);
  const openFolds = useMemo(() => new Set(foldState.open), [foldState]);
  const view = useMemo(() => foldedDefinition(definition, folds, openFolds), [definition, folds, openFolds]);
  const placements = useMemo(() => foldPlacements(definition, folds, openFolds, new Map(Object.entries(sizes)), direction), [definition, folds, openFolds, sizes, direction]);
  useEffect(() => setFoldState((state) => openFoldContaining(state, folds, selected)), [selected, folds, setFoldState]);
  const nodes: FlowNode[] = useMemo(() => {
    const { entry, starts, label } = entryStarts(definition, names.summary);
    const chip = (fold: Fold) => ({ text: foldText(definition, fold), open: isFoldOpen(foldState, fold.id), live: foldLiveText(fold, live), onToggle: () => setFoldState((state) => toggleFold(state, fold.id)) });
    return view.definition.nodes
      .filter((node) => node.type !== 'entry')
      .map((node) => ({
        id: node.id,
        type: 'workflow',
        position: dragging[node.id] ?? placements.get(node.id) ?? node.position,
        measured: sizes[node.id],
        selected: node.id === selected || callOf(run.definition, selected ?? '') === node.id,
        draggable: true,
        connectable: false,
        deletable: false,
        data: {
          ...flowNodeCard(node, definition, direction, names),
          // A call is one card here: it says how many nodes it holds.
          ...(node.type === 'call' && { summary: `노드 ${run.definition.nodes.filter((inner) => inner.id.startsWith(`${node.id}/`)).length}개` }),
          retry: retryBadge(run.definition, node),
          errors: [],
          warnings: [],
          live: live.get(node.id) && { ...live.get(node.id)!, retry: retryLiveText(live.get(node.id)!.retrying) || undefined },
          start: starts.has(node.id) && entry ? { label } : undefined,
          folds: Object.fromEntries(folds.filter((fold) => fold.owner === node.id).map((fold) => [fold.port, chip(fold)])),
          onOpenExit: () => onOpenNode(node.id),
        },
      }));
  }, [definition, view, folds, foldState, placements, run.definition, direction, live, selected, sizes, dragging, names, setFoldState]); // eslint-disable-line react-hooks/exhaustive-deps
  // An exit's actions on its first line.
  const edges = useMemo(
    () => exitEdges(view.definition, definition, names.marks).map(({ edge, source, exit, items }) => (items.length ? { ...edge, data: { ...edge.data, tag: { items, exit, onOpen: () => onOpenNode(source!.id) } } } : edge)),
    [view, definition, names, onOpenNode],
  );

  // The run's steps, drawn around their nodes with how their lines are doing (what every node in the frame holds now).
  // A run's graph keeps a layout of its own, so a frame is as large as its nodes here, not where the editor stood it.
  const frames = useMemo(() => frameNodes(nodes, definition.groups?.map(({ box: _box, ...group }) => group), sizes, (group) => {
    const sum = group.nodeIds.reduce((total, id) => {
      const counts = live.get(id);
      return counts ? { running: total.running + counts.running, queued: total.queued + counts.queued, failed: total.failed + counts.failed } : total;
    }, { running: 0, queued: 0, failed: 0 });
    const parts = [sum.running && `처리 ${sum.running.toLocaleString()}`, sum.queued && `대기 ${sum.queued.toLocaleString()}`, sum.failed && `실패 ${sum.failed.toLocaleString()}`].filter(Boolean);
    return parts.length ? <Text variant="caption" tone="muted" tabular>{parts.join(' · ')}</Text> : undefined;
  }).map((frame) => ({ ...frame, draggable: false })), [nodes, definition.groups, sizes, live]);

  // A remembered view comes back as it was; the first look fits the whole graph once every node is measured.
  const measured = useNodesInitialized();
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !measured) return;
    placed.current = true;
    void (saved ? flow.setViewport(saved) : flow.fitView(FIT));
  }, [measured, saved, flow]);

  return (
    <ReactFlow ref={dismiss}
      colorMode={dark ? 'dark' : 'light'}
      nodes={[...frameTints(frames), ...frames, ...nodes] as FlowNode[]}
      edges={edges}
      nodeTypes={FLOW_NODE_TYPES}
      edgeTypes={FLOW_EDGE_TYPES}
      onNodesChange={onNodesChange}
      nodesDraggable
      nodesConnectable={false}
      edgesFocusable={false}
      minZoom={0.05}
      onNodeClick={(_event, node) => isFrameId(node.id) ? undefined : (topCallIds(run.definition).includes(node.id) ? setOpenCall((open) => (open === node.id ? undefined : node.id)) : onOpenNode(node.id))}
      onMoveEnd={(_event, viewport) => saveViewport(viewport)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      {openCall && (
        <Box asChild maxHeight="pane" width="popover" overflow="auto" radius="md" border="all" background="surface" padding="normal" variant="body" shadow="sm"><Panel position="top-left">
          <Inline marginBottom="condensed" gap="condensed">
            <Text minWidth={0} grow truncate weight="medium" title={run.definition.calls?.[openCall]?.name}>{run.definition.calls?.[openCall]?.name} · 안의 노드</Text>
            <Button variant="ghost" aria-label="닫기" onClick={() => setOpenCall(undefined)}><X /></Button>
          </Inline>
          <Box as="ul" spaceY="tight">
            {callMembers(run.definition, openCall, run.nodes).map((member) => (
              <Box as="li" key={member.node.id} paddingLeft={member.depth ? 'comfortable' : undefined}>
                <Button variant="ghost" height="auto" width="full" justifyContent="between" gap="condensed" paddingY="tight" weight="normal" title="이 노드를 거친 대사 보기" onClick={() => onOpenNode(member.node.id)}>
                  <Text minWidth={0} truncate align="start">{member.name}</Text>
                  <Text shrink={false} variant="caption" tone="muted" tabular>
                    {(Object.keys(ITEM_STATE) as (keyof typeof ITEM_STATE)[]).filter((state) => member.counts[state]).map((state) => `${ITEM_STATE[state]} ${member.counts[state]!.toLocaleString()}`).join(' · ') || '대사 없음'}
                  </Text>
                </Button>
              </Box>
            ))}
          </Box>
          <Button variant="outline" marginTop="condensed" width="full" onClick={() => onOpenNode(openCall)}>이 호출의 대사 전체 보기</Button>
        </Panel></Box>
      )}
      <Panel position="top-right"><EdgeLegend /></Panel>
      <Panel position="bottom-left">
        <CanvasToolbar zoomPercent={zoom * 100} onZoomIn={() => void flow.zoomIn()} onZoomOut={() => void flow.zoomOut()} onFit={() => void flow.fitView({ ...FIT, duration: 200 })} onResetZoom={() => void flow.zoomTo(1, { duration: 180 })} foldsOpen={folds.length ? allFoldsOpen(folds, foldState) : undefined} onToggleFolds={() => setFoldState(setAllFolds(folds, !allFoldsOpen(folds, foldState)))} onLayout={() => void arrange()} layoutLabel="자동 정렬" />
      </Panel>
    </ReactFlow>
  );
}
