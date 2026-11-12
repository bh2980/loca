/** What the editor and a run's graph share: a node's one-line summary and the edges as React Flow draws them. */
import { MarkerType } from '@xyflow/react';
import { nodePorts, nodeSummary as sharedNodeSummary, type WorkflowDefinition, type WorkflowNode } from '@loca/shared';
import type { CanvasDirection } from '@loca/ui';
import type { FlowEdge } from '@/components/workflow/workflow-edge';
import { exitKey, exitTagItems, type MarkNames } from '@/components/workflow/exit-marks';

export interface SummaryNames {
  status: Map<string, string>;
  connection: Map<string, string>;
  /** Connections are known: a missing one reads as deleted rather than not loaded yet. */
  connectionsLoaded: boolean;
  /** The project's workflows, for a call card's summary (without them a call reads as not picked yet). */
  workflows?: { id: string; name: string }[];
}

/** The line under a node's title (the shared summary every surface shows), with the names this screen knows. */
export const nodeSummary = (node: WorkflowNode, definition: WorkflowDefinition, names: SummaryNames): string => sharedNodeSummary(node, definition, { workflows: names.workflows });

/** An AI node's model as its card's chip ("grok-4.7"), or "모델 없음"; nothing for any other node. */
export function nodeBadge(node: WorkflowNode, names: SummaryNames): string | undefined {
  if (node.type !== 'ai') return undefined;
  if (!node.config.model.model) return '모델 없음';
  if (names.connectionsLoaded && !names.connection.has(node.config.model.connectionId)) return '삭제된 연결';
  return node.config.model.model;
}

/** The hidden entry's exits: the nodes lines start at, and the 시작 mark's label. */
export function entryStarts(definition: WorkflowDefinition, names: SummaryNames) {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const starts = new Set(definition.edges.filter((edge) => edge.source === entry?.id).map((edge) => edge.target));
  const label = entry && entry.type === 'entry' ? `시작 · ${nodeSummary(entry, definition, names)}` : '시작';
  return { entry, starts, label };
}

/** Exits with no line leaving them (drawn with an end mark). */
export const openPorts = (node: WorkflowNode, definition: WorkflowDefinition) =>
  nodePorts(node).map((port) => port.id).filter((port) => !definition.edges.some((edge) => edge.source === node.id && edge.sourceHandle === port));


/** The definition's edges as drawn (the entry hidden), coloured by exit; `selected`/`hovered` are drawn thicker. */
export function flowEdges(definition: WorkflowDefinition, { selected, hovered }: { selected?: string; hovered?: string } = {}): FlowEdge[] {
  const hiddenNodeIds = new Set(definition.nodes.filter((node) => node.type === 'entry').map((node) => node.id));
  const all = definition.edges.filter((edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target));
  // A line back to an earlier step (an earlier frame, or up the flow within one) is the loop: one dashed line in the accent.
  const frameOf = new Map((definition.groups ?? []).flatMap((group, index) => group.nodeIds.map((id) => [id, index] as const)));
  const along = (node: WorkflowNode | undefined) => (node ? (definition.direction === 'horizontal' ? node.position.x : node.position.y) : 0);
  const goesBack = (source: WorkflowNode | undefined, target: WorkflowNode | undefined) => {
    if (!source || !target) return false;
    const from = frameOf.get(source.id);
    const to = frameOf.get(target.id);
    return from !== undefined && to !== undefined && from !== to ? to < from : along(target) < along(source);
  };
  return all.map((edge) => {
    const branches = all.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length;
    const source = definition.nodes.find((node) => node.id === edge.source);
    const port = source && nodePorts(source).find((item) => item.id === edge.sourceHandle);
    const back = goesBack(source, definition.nodes.find((node) => node.id === edge.target));
    const tone = back ? 'var(--stroke-accent)' : edge.sourceHandle === 'error' ? 'var(--stroke-danger)' : ['fail', 'false', 'rejected'].includes(edge.sourceHandle) ? 'var(--stroke-warning)' : 'var(--stroke-graph-edge)';
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: 'in',
      type: 'workflow',
      interactionWidth: 24,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      selected: edge.id === selected,
      // The colour says the main way, 실패 or 오류; a label only where it cannot: a condition's 예 / 아니요, an exit sent down several lines.
      data: { points: edge.layout?.points, label: port && (branches > 1 ? `${port.label} · 모두 보냄` : source?.type === 'condition' ? port.label : undefined), labelPosition: edge.layout?.labelPosition },
      style: { stroke: edge.id === selected ? 'var(--stroke-accent)' : tone, strokeWidth: edge.id === selected || edge.id === hovered ? 3 : 2, ...(back && { strokeDasharray: '6 4' }) },
    };
  });
}

/** The names a workflow graph shows: statuses, connections and workflows in a node's summary, tags and statuses on an exit's marks. */
export interface FlowNames {
  summary: SummaryNames;
  marks: MarkNames;
}

export function flowNames({ statuses, tags, connections, workflows }: {
  statuses?: readonly { id: string; name: string; color: string; kind?: 'initial' | 'normal' | 'final'; inReview?: boolean }[];
  tags?: readonly { id: string; name: string; color: string }[];
  /** Absent until loaded. */
  connections?: readonly { id: string; name: string }[];
  workflows?: { id: string; name: string }[];
}): FlowNames {
  return {
    summary: { status: new Map(statuses?.map((status) => [status.id, status.name])), connection: new Map(connections?.map((connection) => [connection.id, connection.name])), connectionsLoaded: Boolean(connections), workflows },
    marks: { tags: new Map(tags?.map((tag) => [tag.id, tag])), statuses: new Map(statuses?.map((status) => [status.id, status])) },
  };
}

/**
 * What a node's card says in the editor and in a run's graph alike: the node, its one-line summary, an AI node's
 * model, and its exits no line leaves, each with what it does at its end (the layout keeps that room). `whole` is
 * the definition the node belongs to; the node itself may come from a folded view of it.
 */
export function flowNodeCard(node: WorkflowNode, whole: WorkflowDefinition, direction: CanvasDirection, names: FlowNames) {
  const open = openPorts(node, whole);
  return {
    node,
    direction,
    summary: nodeSummary(node, whole, names.summary),
    badge: nodeBadge(node, names.summary),
    open,
    exitMarks: Object.fromEntries(open.map((port) => [port, exitTagItems(node, port, names.marks, whole)])),
  };
}

/**
 * The drawn edges with what each exit does: an exit's actions are drawn on its first line (they apply once, before
 * its lines split), so every edge comes with its exit's key and label and, on that first line, the exit's marks.
 * `drawn` is the definition as drawn (folded), `whole` the one its nodes belong to.
 */
export function exitEdges(drawn: WorkflowDefinition, whole: Pick<WorkflowDefinition, 'nodes' | 'edges'>, marks: MarkNames, highlight?: { selected?: string; hovered?: string }) {
  const first = new Map<string, string>();
  for (const edge of drawn.edges) if (!first.has(exitKey(edge.source, edge.sourceHandle))) first.set(exitKey(edge.source, edge.sourceHandle), edge.id);
  return flowEdges(drawn, highlight).map((edge) => {
    const source = drawn.nodes.find((node) => node.id === edge.source);
    const port = edge.sourceHandle ?? 'out';
    const key = exitKey(edge.source, port);
    return {
      edge,
      source,
      port,
      key,
      /** The exit's name as its node's ports give it. */
      exit: source ? (nodePorts(source).find((item) => item.id === port)?.label ?? port) : port,
      items: source && first.get(key) === edge.id ? exitTagItems(source, port, marks, whole) : [],
    };
  });
}
