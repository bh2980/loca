/** What the editor and a run's graph share: a node's one-line summary and the edges as React Flow draws them. */
import { MarkerType } from '@xyflow/react';
import { z } from 'zod';
import { AI_OUTPUTS, APPLY_TARGETS, BATCH_MODE_LABELS, FUNCTIONS, WORKFLOW_SUBJECTS, formatCheckParams, httpParams, scriptParams, nodeName, nodePorts, previousSteps, callSummary, workflowInput, type FunctionName, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import type { FlowEdge } from '@/components/workflow/workflow-edge';

export interface SummaryNames {
  status: Map<string, string>;
  connection: Map<string, string>;
  /** Connections are known: a missing one reads as deleted rather than not loaded yet. */
  connectionsLoaded: boolean;
  /** The project's workflows, for a call card's summary (without them a call reads as not picked yet). */
  workflows?: { id: string; name: string }[];
}

/** Where a save node writes, in the words of the screens that show it. */
const SAVES_TO: Record<string, string> = { setListener: '대사 청자', saveTerms: '용어집', saveCharacters: '인물', saveRelationships: '관계', saveSpeechRules: '말투 규칙', saveEvents: '사건', saveDocument: '노트' };

/**
 * A save node's line: where it writes ("→ 대사 번역"), and whose result only when that is not the node drawn right before
 * it (a check or a condition in between passes the result on).
 */
function savesTo(node: WorkflowNode & { type: 'function' }, definition: WorkflowDefinition) {
  const where = node.config.fn === 'saveCandidate' ? (workflowInput(definition) === 'terms' ? '용어 번역어' : '대사 번역') : SAVES_TO[node.config.fn] ?? APPLY_TARGETS[node.config.fn as keyof typeof APPLY_TARGETS]?.label;
  const steps = previousSteps(definition, node.id);
  const drawnBefore = new Set(definition.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source));
  const from = steps.length && !steps.every((step) => drawnBefore.has(step.id)) ? ` · ${steps.map(nodeName).join(', ')}의 결과` : steps.length ? '' : ' · 앞 단계 결과 없음';
  return `→ ${where}${from}`;
}

/** An address as a card's line: without the scheme, its query left out ("?…" says there is one), cut at `max`. */
function shortAddress(url: string, max = 48) {
  const [, bare = '', rest = ''] = /^(?:https?:\/\/)?([^?#]*)(.*)$/i.exec(url.trim()) ?? [];
  const address = rest.startsWith('?') ? `${bare}?…` : bare;
  return address.length > max ? `${address.slice(0, max - 1)}…` : address;
}

/**
 * The format check's settings as the summary reads them: its own schema and defaults, with the custom rules only counted
 * (a rule being typed has no pattern yet and does not fit the schema; the other checks still read as they are set).
 */
const formatCheckSummaryParams = formatCheckParams.extend({ customRules: z.array(z.unknown()).default([]) });

/** "← 앞 단계" for a node that takes the previous step's result (a gather). */
const stepsLabel = (definition: WorkflowDefinition, nodeId: string) => {
  const steps = previousSteps(definition, nodeId);
  return steps.length ? `← ${steps.map(nodeName).join(', ')}` : '앞 단계 결과 없음';
};

/** The line under a node's title: its model, target status, checks, condition or source node. */
export function nodeSummary(node: WorkflowNode, definition: WorkflowDefinition, names: SummaryNames): string {
  switch (node.type) {
    case 'entry':
      return `${WORKFLOW_SUBJECTS[node.config.input]} 입력`;
    case 'ai':
      // What it makes and how it reads; the model is the card's badge (nodeBadge).
      return `${AI_OUTPUTS[node.config.output].label} · ${BATCH_MODE_LABELS[node.config.batch.mode]}`;
    case 'function': {
      const fn = node.config.fn;
      if (fn in APPLY_TARGETS) return savesTo(node, definition);
      const label = FUNCTIONS[fn as FunctionName]?.label ?? fn;
      if (fn === 'http') {
        const params = httpParams.safeParse(node.config.params ?? {});
        return params.success ? `${params.data.method} ${shortAddress(params.data.url) || '주소 없음'}` : label;
      }
      if (fn === 'script') {
        const params = scriptParams.safeParse(node.config.params ?? {});
        return params.success ? `출구: ${params.data.ports.join(', ')}` : label;
      }
      if (fn === 'formatCheck') {
        const parsed = formatCheckSummaryParams.safeParse(node.config.params ?? {});
        if (!parsed.success) return label;
        const params = parsed.data;
        const checks = [
          params.placeholders && '자리표시자',
          params.tags && '서식 태그',
          params.newlines && '줄바꿈',
          params.emptyText && '빈 번역',
          params.numbers && '숫자',
          params.spaces && '공백',
          params.particles && '조사',
          (params.maxChars || params.maxBytes || params.maxLineChars || params.maxLines || params.maxLengthRatio) && '길이',
          params.forbiddenWords.split(',').some((word) => word.trim()) && '금지어',
          params.customRules.length > 0 && `규칙 ${params.customRules.length}개`,
        ].filter(Boolean);
        return checks.length ? `검사: ${checks.join('·')}` : '켠 검사 항목 없음 (항상 통과)';
      }
      return label;
    }
    case 'condition':
      return node.config.description || '조건식';
    case 'gather':
      return stepsLabel(definition, node.id);
    case 'call':
      return callSummary(node.config, names.workflows);
    default:
      return '';
  }
}

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


/** The definition's edges as drawn (entry and end hidden), coloured by exit; `selected`/`hovered` are drawn thicker. */
export function flowEdges(definition: WorkflowDefinition, { selected, hovered }: { selected?: string; hovered?: string } = {}): FlowEdge[] {
  const hiddenNodeIds = new Set(definition.nodes.filter((node) => node.type === 'entry' || node.type === 'end').map((node) => node.id));
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
