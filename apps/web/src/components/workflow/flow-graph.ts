/** What the editor and a run's graph share: a node's one-line summary and the edges as React Flow draws them. */
import { MarkerType } from '@xyflow/react';
import { APPLY_TARGETS, FUNCTIONS, ISSUE_KINDS, TAG_ACTIONS, tagLinesParams, WORKFLOW_SUBJECTS, nodeName, nodePorts, previousSteps, callSummary, retrySummary, type FunctionName, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import type { FlowEdge } from '@/components/workflow/workflow-edge';

export interface SummaryNames {
  status: Map<string, string>;
  connection: Map<string, string>;
  /** Connections are known: a missing one reads as deleted rather than not loaded yet. */
  connectionsLoaded: boolean;
  /** The project's workflows, for a call card's summary (without them a call reads as not picked yet). */
  workflows?: { id: string; name: string }[];
}

/** "← 앞 단계" for a node that takes the previous step's result (apply nodes, a gather). */
const stepsLabel = (definition: WorkflowDefinition, nodeId: string) => {
  const steps = previousSteps(definition, nodeId);
  return steps.length ? `← ${steps.map(nodeName).join(', ')}` : '앞 단계 결과 없음';
};

/** The line under a node's title: its model, target status, checks, condition or source node. */
export function nodeSummary(node: WorkflowNode, definition: WorkflowDefinition, names: SummaryNames): string {
  switch (node.type) {
    case 'entry':
      return `${WORKFLOW_SUBJECTS[node.config.input]} 입력`;
    case 'ai': {
      const model = node.config.model.model ? [names.connection.get(node.config.model.connectionId) ?? (names.connectionsLoaded ? '삭제된 연결' : undefined), node.config.model.model].filter(Boolean).join(' · ') : '모델 없음';
      return model;
    }
    case 'function': {
      const params = node.config.params as Record<string, unknown>;
      if (node.config.fn === 'setStatus')
        return [params.statusId && `→ ${names.status.get(params.statusId as string) ?? '삭제된 상태'}`].filter(Boolean).join(' · ') || '변경 없음';
      if (node.config.fn === 'http') return `${(params.method as string) ?? 'POST'} ${names.connection.get(params.connectionId as string) ?? '연결 없음'}/${(params.path as string) ?? ''}`;
      if (node.config.fn === 'script') return `출구: ${((params.ports as string[]) ?? ['out']).join(', ')}`;
      if (node.config.fn === 'tagLines') {
        // "붙이기 · 검수 지적 종류", "떼기 · 형식": the action, then where the tags come from.
        const tags = tagLinesParams.parse(params);
        const named = tags.map.tag && (tags.map.tag === 'categories' ? '검수 지적 종류' : tags.map.tag === 'kind' ? '검사 종류' : `결과의 ${tags.map.tag}`);
        const picked = [...tags.kinds.map((kind) => ISSUE_KINDS[kind].name), ...(tags.tagIds.length ? [`태그 ${tags.tagIds.length}개`] : [])];
        return [TAG_ACTIONS[tags.action], ...(tags.allKinds ? ['모든 문제 유형'] : picked), named].filter(Boolean).join(' · ');
      }
      if (node.config.fn in APPLY_TARGETS) return stepsLabel(definition, node.id);
      if (node.config.fn === 'formatCheck') {
        const checks = [
          params.placeholders !== false && '자리표시자',
          params.tags !== false && '서식 태그',
          params.newlines !== false && '줄바꿈',
          params.emptyText !== false && '빈 번역',
          params.numbers && '숫자',
          params.spaces && '공백',
          params.particles && '조사',
          Array.isArray(params.customRules) && params.customRules.length > 0 && `규칙 ${params.customRules.length}개`,
        ].filter(Boolean);
        return checks.length ? `검사: ${checks.join('·')}` : '켠 검사 항목 없음 (항상 통과)';
      }
      return FUNCTIONS[node.config.fn as FunctionName]?.label ?? node.config.fn;
    }
    case 'condition':
      return node.config.description || '조건식';
    case 'gather':
      return stepsLabel(definition, node.id);
    case 'retry':
      return retrySummary(node.config);
    case 'call':
      return callSummary(node.config, names.workflows);
    default:
      return '';
  }
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

/** A status-change node's target status, shown in that status's colour. */
export function targetStatus(node: WorkflowNode, statuses: { id: string; name: string; color: string }[] | undefined) {
  const statusId = node.type === 'function' && node.config.fn === 'setStatus' ? (node.config.params as { statusId?: string }).statusId : undefined;
  const status = statusId ? statuses?.find((item) => item.id === statusId) : undefined;
  return status && { name: status.name, color: status.color };
}

/** The definition's edges as drawn (entry and end hidden), coloured by exit; `selected`/`hovered` are drawn thicker. */
export function flowEdges(definition: WorkflowDefinition, { selected, hovered }: { selected?: string; hovered?: string } = {}): FlowEdge[] {
  const hiddenNodeIds = new Set(definition.nodes.filter((node) => node.type === 'entry' || node.type === 'end').map((node) => node.id));
  const all = definition.edges.filter((edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target));
  return all.map((edge) => {
    const branches = all.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length;
    const source = definition.nodes.find((node) => node.id === edge.source);
    const port = source && nodePorts(source).find((item) => item.id === edge.sourceHandle);
    const tone = edge.sourceHandle === 'error' ? 'var(--stroke-danger)' : ['fail', 'false', 'rejected'].includes(edge.sourceHandle) ? 'var(--stroke-warning)' : 'var(--stroke-graph-edge)';
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
      data: { points: edge.layout?.points, label: port && (branches > 1 ? `${port.label} · 모두 보냄` : port.label), labelPosition: edge.layout?.labelPosition },
      style: { stroke: edge.id === selected ? 'var(--stroke-accent)' : tone, strokeWidth: edge.id === selected || edge.id === hovered ? 3 : 2 },
    };
  });
}
