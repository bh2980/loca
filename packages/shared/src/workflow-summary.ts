import { APPLY_TARGETS, FUNCTIONS, functionInfo, type FunctionParams } from './functions.ts';
import { AI_OUTPUTS, BATCH_MODE_LABELS, INPUT_TYPES, byNodeType, callSummary, nodeCallsOut, nodeName, previousSteps, retrySummary, workflowInput, type FunctionNode, type WorkflowDefinition, type WorkflowNode } from './workflow.ts';

type Flow = Pick<WorkflowDefinition, 'nodes' | 'edges'>;

/** Names a summary shows that a definition only has ids for. */
export interface SummaryNames {
  /** The project's workflows, for a call's summary (without them a call reads as not picked yet). */
  workflows?: readonly { id: string; name: string }[];
}

/**
 * A save node's line: where it writes ("→ 대사 번역"), and whose result only when that is not the node drawn right before
 * it (a check or a condition in between passes the result on).
 */
function savesTo(node: FunctionNode, definition: Flow) {
  if (!(node.config.fn in APPLY_TARGETS)) return FUNCTIONS[node.config.fn].label;
  const writes = APPLY_TARGETS[node.config.fn as keyof typeof APPLY_TARGETS].writes;
  const where = typeof writes === 'string' ? writes : writes[workflowInput(definition)];
  const steps = previousSteps(definition, node.id);
  const drawnBefore = new Set(definition.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source));
  const from = steps.length && !steps.every((step) => drawnBefore.has(step.id)) ? ` · ${steps.map(nodeName).join(', ')}의 결과` : steps.length ? '' : ' · 앞 단계 결과 없음';
  return `→ ${where}${from}`;
}

/** "← 앞 단계" for a node that takes the previous step's result (a gather). */
function stepsLabel(definition: Flow, nodeId: string) {
  const steps = previousSteps(definition, nodeId);
  return steps.length ? `← ${steps.map(nodeName).join(', ')}` : '앞 단계 결과 없음';
}

/**
 * The line under a node's title, wherever a node is listed (the editor's card, a run's graph, `loca workflows show`):
 * what it takes in, makes, checks, where it writes, its condition or the workflow it calls. An AI node's model is not
 * in it (the card shows it as a badge, the terminal with nodeDetails).
 */
export function nodeSummary(node: WorkflowNode, definition: Flow, names: SummaryNames = {}): string {
  return byNodeType(node, {
    entry: ({ config }) => `${INPUT_TYPES[config.input].label} 입력`,
    ai: ({ config }) => `${AI_OUTPUTS[config.output].label} · ${BATCH_MODE_LABELS[config.batch.mode]}`,
    function: (fn) => {
      const info = functionInfo(fn.config.fn);
      if (info.group === 'apply') return savesTo(fn, definition);
      return (info.summary as ((params: FunctionParams) => string) | undefined)?.(fn.config.params) ?? info.label;
    },
    condition: ({ config }) => config.description || '조건식',
    gather: ({ id }) => stepsLabel(definition, id),
    call: ({ config }) => callSummary(config, names.workflows),
  });
}

/**
 * What a terminal reader needs beyond the summary line, where the app shows it elsewhere (a badge, the config pane):
 * ids as a definition spells them, the model, how many calls at once, declared fields, retry rules, the condition itself.
 */
export function nodeDetails(node: WorkflowNode, definition: Pick<WorkflowDefinition, 'settings'>): string[] {
  const concurrency = nodeCallsOut(node) ? [`동시 ${node.config.concurrency}`] : [];
  return byNodeType<string[]>(node, {
    entry: () => ['실행 범위로 고름'],
    ai: ({ config }) => {
      const rules = config.retries;
      return [
        `${config.output}·${config.scope}`,
        ...(config.preset ? [`프리셋 ${config.preset}`] : []),
        config.model.model || '모델 없음',
        ...concurrency,
        ...(config.output === 'json' && config.fields.length ? [`필드 ${config.fields.map((field) => field.name).join(', ')}`] : []),
        `재시도 ${rules ? (rules.length ? rules.map(retrySummary).join(' / ') : '안 함') : `워크플로 기본${definition.settings.retries.length ? '' : '(안 함)'}`}`,
      ];
    },
    function: ({ config }) => [config.fn, ...concurrency],
    condition: ({ config }) => [JSON.stringify(config.expression ?? null)],
    gather: ({ config }) => (config.fields.length ? [`필드 ${config.fields.join(', ')}`] : []),
    call: ({ config }) => (config.workflowId ? [config.workflowId] : []),
  });
}
