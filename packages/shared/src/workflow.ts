import { z } from 'zod';
import Graph from 'graphology';
import { FUNCTIONS, functionPorts, jsonFieldSchema, type FunctionName, type JsonField, type Port } from './functions.ts';
import { stronglyConnectedComponents } from 'graphology-components';
import { ANALYSIS_SECTIONS } from './knowledge.ts';
import { choiceKey, draftModelChoiceSchema, EMPTY_MODEL_CHOICE, modelChoiceSchema, type ModelChoice } from './model-choice.ts';

/**
 * What an AI node pulls into its prompt. Every field maps to stored project data.
 * Defaults follow the experiments: a known listener with a confirmed speech rule,
 * glossary, preceding lines and the scene description help; character profiles, relationship bundles
 * and documents did nothing or hurt, so they are opt-in per node.
 */
export const contextConfigSchema = z.object({
  /**
   * Leave out terms and knowledge that AI confirmed and no person has looked at (✦), e.g. for a
   * review that should check against what people decided. Off: AI-confirmed items are used too.
   */
  humanOnly: z.boolean().default(false),
  glossary: z.boolean().default(true),
  documents: z.boolean().default(false),
  characters: z.boolean().default(false),
  relationships: z.boolean().default(false),
  /** Each line's listener and the confirmed speech rule for that speaker → listener pair. */
  speech: z.boolean().default(true),
  /** Every confirmed character's name, aliases and player flag, so the model can name people not mentioned in the batch. */
  cast: z.boolean().default(false),
  precedingLines: z.number().int().min(0).max(50).default(8),
  previousScenes: z.number().int().min(0).max(10).default(1),
  /**
   * Show the current translation of preceding lines. Off by default: only lines at a batch boundary
   * get preceding lines at all, and in experiment E9 it reached 6 of 407 lines with no measurable effect.
   */
  precedingTranslations: z.boolean().default(false),
  /** Estimated token cap for everything besides the lines themselves; what does not fit is dropped and recorded. */
  maxTokens: z.number().int().min(500).max(200_000).default(12_000),
});

/** How lines become model requests; see planBatches (apps/server/src/engine/batches.ts). */
export const batchConfigSchema = z.object({
  /**
   * group: consecutive scenes share a request, scenes kept whole when they fit; count: fixed size across
   * scenes; unit: one line each; whole: the whole script in as few requests as `maxTokens` allows (work analysis).
   */
  mode: z.enum(['unit', 'group', 'count', 'whole']).default('group'),
  /** Most lines in one request. */
  size: z.number().int().min(1).max(200).default(60),
  /** Most estimated tokens of line text in one request ("group", "whole"); context is capped separately. */
  maxTokens: z.number().int().min(500).max(1_000_000).default(6_000),
});

const position = z.object({ x: z.number(), y: z.number() });
const base = { id: z.string().min(1), position, label: z.string().optional() };

/** What an AI node returns for each line; the choice also decides its exits. */
export const AI_OUTPUTS = {
  candidate: { label: '문장 생성 (번역·윤문)', description: '대사마다 번역문·수정문 등 새 문장을 만들어 후보로 기록합니다.' },
  verdict: { label: '통과·실패 판정', description: '번역 품질·말투·설정 일관성 등을 판정해 통과/실패 두 출구로 나눕니다.' },
  terms: { label: '용어 후보', description: '원문에서 용어(원문·번역·메모)를 뽑습니다.' },
  listener: { label: '분류·추론 (값 + 확신도)', description: '대사마다 지시문에 따라 값(청자·분류·감정 등)과 확신도(0~1)를 냅니다. 청자나 태그에 반영하거나 조건 분기에만 쓸 수 있습니다.' },
  knowledge: { label: '자료 변경', description: '이 대사들에서 새로 드러난 인물·관계 변화·사건·말투 변화를 냅니다.' },
  analysis: { label: '작품 분석', description: '읽은 대본 전체에서 고른 항목(개요·인물·관계·사건·말투 규칙·장면별 청자·용어)을 근거 줄과 함께 냅니다.' },
  json: { label: '자유 형식', description: '직접 정한 필드를 대사마다 채웁니다.' },
} as const;
export type AiOutput = keyof typeof AI_OUTPUTS;

export { jsonFieldSchema, type JsonField };

/**
 * Where a "listener" (분류·추론) node's inferred value goes: the line's listener, the line tag with
 * that name, or nowhere (only outputs.<node>.value / .confidence for later conditions).
 */
export const CLASSIFY_TARGETS = ['listener', 'tag', 'none'] as const;
export type ClassifyTarget = (typeof CLASSIFY_TARGETS)[number];

export const aiNodeConfigSchema = z.object({
  model: draftModelChoiceSchema.default({ ...EMPTY_MODEL_CHOICE }),
  /** More models sharing this node's work: each request goes to whichever account has a free slot. */
  extraModels: z.array(draftModelChoiceSchema).default([]),
  /** Empty = the model's default. Only some API models take it. */
  temperature: z.number().min(0).max(2).optional(),
  instructions: z.string().default(''),
  output: z.enum(['candidate', 'verdict', 'terms', 'listener', 'knowledge', 'analysis', 'json']).default('candidate'),
  fields: z.array(jsonFieldSchema).default([]),
  /** "listener" (분류·추론) output only: where the inferred value goes; unset = 'listener'. */
  classifyTarget: z.enum(CLASSIFY_TARGETS).optional(),
  /** What an "analysis" node reads the script for; empty = every section. */
  sections: z.array(z.enum(ANALYSIS_SECTIONS)).optional(),
  /** Whether extracted terms/listener/knowledge/analysis should be saved automatically without requiring a separate save function node. */
  autoApply: z.boolean().optional(),
  /** When true, extracted terms/knowledge/analysis items are saved as 'candidate' instead of 'confirmed' (✦). */
  asCandidate: z.boolean().optional(),
  /** Also show the model the line's current candidate / the latest failing issues. */
  include: z
    .object({ candidate: z.boolean().default(true), issues: z.boolean().default(true) })
    .default({ candidate: true, issues: true }),
  context: contextConfigSchema.default(contextConfigSchema.parse({})),
  batch: batchConfigSchema.default(batchConfigSchema.parse({})),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('entry'), config: z.object({ statusIds: z.array(z.string()).default([]) }) }),
  z.object({ ...base, type: z.literal('ai'), config: aiNodeConfigSchema }),
  z.object({ ...base, type: z.literal('function'), config: z.object({ fn: z.string(), params: z.record(z.string(), z.unknown()).default({}) }) }),
  z.object({
    ...base,
    type: z.literal('condition'),
    // JSON Logic expression evaluated against the line's data (see ConditionData).
    config: z.object({ expression: z.unknown(), description: z.string().default('') }),
  }),
  z.object({ ...base, type: z.literal('end'), config: z.object({}).default({}) }),
]);

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  /** Last ELK route, used for the rendered edge until nodes are dragged or layout is rerun. */
  layout: z.object({
    points: z.array(position).min(2),
    labelPosition: position.optional(),
  }).optional(),
});

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  /** Last explicitly arranged graph direction; older saved definitions default to vertical. */
  direction: z.enum(['vertical', 'horizontal']).optional(),
  settings: z
    .object({
      maxVisitsPerNode: z.number().int().min(1).max(50).default(5),
      concurrency: z.number().int().min(1).max(8).default(2),
      /** The run pauses after this many model or function calls in a row fail. */
      maxConsecutiveFailures: z.number().int().min(1).max(50).default(3),
    })
    .default({ maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 }),
});

export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type BatchConfig = z.infer<typeof batchConfigSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowNodeType = WorkflowNode['type'];
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/**
 * Models for one run, by AI node id (the run dialog, `start_run`, `loca plan`). A node given one
 * runs on that model alone for this run (the models it otherwise shares batches with are left out);
 * the workflow itself keeps its own models.
 */
export const runModelsSchema = z.record(z.string(), modelChoiceSchema);
export type RunModels = z.infer<typeof runModelsSchema>;
export function withRunModels(definition: WorkflowDefinition, models: RunModels | undefined): WorkflowDefinition {
  if (!models || !Object.keys(models).length) return definition;
  return { ...definition, nodes: definition.nodes.map((node) => (node.type === 'ai' && models[node.id] ? { ...node, config: { ...node.config, model: models[node.id]!, extraModels: [] } } : node)) };
}
export type AiNode = Extract<WorkflowNode, { type: 'ai' }>;
export type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;

/** Every model an AI node may send a request with (picked ones only, each once), its own first. */
export function nodeModels(node: AiNode): ModelChoice[] {
  const seen = new Set<string>();
  return [node.config.model, ...node.config.extraModels].flatMap((choice) => {
    if (!choice.connectionId || !choice.model || seen.has(choiceKey(choice))) return [];
    seen.add(choiceKey(choice));
    return [{ connectionId: choice.connectionId, model: choice.model, ...(choice.effort && { effort: choice.effort }) }];
  });
}

/** Functions that change the line itself (its status, tags or representative translation). */
const LINE_CHANGING_FUNCTIONS = new Set(['setStatus']);

export interface NodeTypeInfo {
  label: string;
  description: string;
  hasInput: boolean;
}

export const NODE_TYPES: Record<WorkflowNodeType, NodeTypeInfo> = {
  entry: { label: '진입', description: '선택한 상태의 대사가 흐름에 들어옵니다.', hasInput: false },
  ai: { label: 'AI 동작', description: '고른 모델·지시문·문맥으로 AI를 호출해 후보·판정·용어·데이터를 받습니다.', hasInput: true },
  function: { label: '함수 동작', description: '형식 검사·상태 변경·HTTP 호출·스크립트 등 정해진 동작을 실행합니다.', hasInput: true },
  condition: { label: '조건 분기', description: '방문 횟수·앞 노드의 출력·대사 속성 등으로 분기합니다.', hasInput: true },
  end: { label: '종료', description: '대사의 흐름을 마칩니다.', hasInput: true },
};

const OUT: Port[] = [{ id: 'out', label: '완료' }];
const ERROR: Port = { id: 'error', label: '오류' };

/** The exits of a node, derived from its type and config. */
export function nodePorts(node: WorkflowNode): Port[] {
  switch (node.type) {
    case 'entry':
      return [{ id: 'out', label: '다음' }];
    case 'ai':
      return node.config.output === 'verdict' ? [{ id: 'pass', label: '통과' }, { id: 'fail', label: '실패' }, ERROR] : [...OUT, ERROR];
    case 'function':
      return functionPorts(node.config.fn, node.config.params);
    case 'condition':
      return [{ id: 'true', label: '참' }, { id: 'false', label: '거짓' }];
    case 'end':
      return [];
  }
}

/** A short name for a node: its label, else its function / output kind. */
export function nodeName(node: WorkflowNode): string {
  if (node.label) return node.label;
  if (node.type === 'function') return FUNCTIONS[node.config.fn as FunctionName]?.label ?? node.config.fn;
  if (node.type === 'ai') return `AI ${AI_OUTPUTS[node.config.output].label}`;
  return NODE_TYPES[node.type].label;
}

/** Data a condition expression can read, e.g. {"<": [{"var": "visits.review"}, 3]}. */
export interface ConditionData {
  visits: Record<string, number>;
  /** Every node's output for this line, by node id (verdicts: {passed, issues}). */
  outputs: Record<string, Record<string, unknown>>;
  candidate: string | null;
  issues: string[];
  /** marks: the line's automatic marks right now (lineMarksOf in marks.ts; diverged is only known to the list filter). */
  unit: { kind: string; speaker: string | null; statusId: string; tagIds: string[]; marks: string[] };
  /**
   * The line needs no listener estimate: its listener came from the import or a person, or is an AI guess
   * at or above the confidence threshold, or the line is not dialogue.
   */
  listenerKnown: boolean;
}

export interface WorkflowIssue {
  level: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowRefs {
  /** AI connections (not HTTP tool keys) by id, with their kind. */
  connections: Map<string, string>;
  statusIds: Set<string>;
  tagIds: Set<string>;
  /** HTTP tool connections usable by the http function. */
  toolConnectionIds: Set<string>;
}

export function validateWorkflow(definition: WorkflowDefinition, refs: WorkflowRefs): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const error = (message: string, at: Pick<WorkflowIssue, 'nodeId' | 'edgeId'> = {}) => issues.push({ level: 'error', message, ...at });
  const warn = (message: string, at: Pick<WorkflowIssue, 'nodeId' | 'edgeId'> = {}) => issues.push({ level: 'warning', message, ...at });

  const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });
  for (const node of definition.nodes) {
    if (graph.hasNode(node.id)) error(`노드 ID가 중복됩니다: ${node.id}`, { nodeId: node.id });
    else graph.addNode(node.id, { node });
  }
  const entries = definition.nodes.filter((node) => node.type === 'entry');
  if (entries.length !== 1) error(entries.length ? '진입 노드는 하나만 둘 수 있습니다.' : '진입 노드가 필요합니다.');

  const usedPorts = new Set<string>();
  for (const edge of definition.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      error('없는 노드를 잇는 연결입니다.', { edgeId: edge.id });
      continue;
    }
    const source = graph.getNodeAttribute(edge.source, 'node') as WorkflowNode;
    const target = graph.getNodeAttribute(edge.target, 'node') as WorkflowNode;
    if (!nodePorts(source).some((port) => port.id === edge.sourceHandle))
      error(`'${nodeName(source)}'에 없는 출구입니다: ${edge.sourceHandle}`, { edgeId: edge.id });
    if (!NODE_TYPES[target.type].hasInput) error('진입 노드로 들어가는 연결은 둘 수 없습니다.', { edgeId: edge.id });
    const port = `${edge.source}:${edge.sourceHandle}`;
    if (definition.edges.some((other) => other !== edge && other.source === edge.source && other.sourceHandle === edge.sourceHandle && other.target === edge.target && definition.edges.indexOf(other) < definition.edges.indexOf(edge)))
      error('같은 출구에서 같은 노드로 가는 연결이 두 번 있습니다.', { edgeId: edge.id });
    usedPorts.add(port);
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target);
  }

  // An exit with several connections sends each line down all of them (a copy per branch). The
  // branches may share an end node (each copy just ends there), but no other node: a line would
  // arrive twice. Only one of them may change the line itself, or two branches would set its
  // status at the same time.
  const reach = (start: string) => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !graph.hasNode(id)) continue;
      seen.add(id);
      stack.push(...graph.outNeighbors(id));
    }
    return seen;
  };
  for (const [port, edges] of Map.groupBy(definition.edges, (edge) => `${edge.source}:${edge.sourceHandle}`)) {
    const targets = [...new Set(edges.map((edge) => edge.target))];
    if (targets.length < 2) continue;
    const source = definition.nodes.find((node) => node.id === port.slice(0, port.indexOf(':')));
    const where = source ? `'${nodeName(source)}'의 갈래` : '갈래';
    const branches = targets.map((target) => reach(target));
    const isEnd = (id: string) => definition.nodes.find((node) => node.id === id)?.type === 'end';
    const met = branches.flatMap((branch, index) => branches.slice(index + 1).flatMap((other) => [...branch].filter((id) => other.has(id) && !isEnd(id))));
    if (met.length) {
      const node = definition.nodes.find((candidate) => candidate.id === met[0]);
      error(`${where}가 '${node ? nodeName(node) : met[0]}'에서 다시 만납니다. 한 출구에서 나간 갈래는 따로 끝나야 합니다.`, { nodeId: source?.id });
    }
    const changing = branches.filter((branch) => [...branch].some((id) => { const node = definition.nodes.find((candidate) => candidate.id === id); return node?.type === 'function' && LINE_CHANGING_FUNCTIONS.has(node.config.fn); }));
    if (changing.length > 1) error(`${where} 중 둘 이상이 대사의 상태를 바꿉니다. 상태 변경은 한 갈래에만 두세요.`, { nodeId: source?.id });
  }

  for (const node of definition.nodes) {
    for (const port of nodePorts(node)) {
      if (
        port.id === 'error' ||
        (port.id === 'out' && node.type !== 'entry') ||
        usedPorts.has(`${node.id}:${port.id}`) ||
        (port.id === 'fail' && usedPorts.has(`${node.id}:pass`)) ||
        ((port.id === 'true' || port.id === 'false') && (usedPorts.has(`${node.id}:true`) || usedPorts.has(`${node.id}:false`)))
      ) continue;
      error(`'${port.label}' 출구가 연결되지 않았습니다.`, { nodeId: node.id });
    }
    if (node.type === 'ai') {
      const { model, extraModels } = node.config;
      if (!model.connectionId || !model.model) error('AI 연결과 모델을 고르세요.', { nodeId: node.id });
      else if (!refs.connections.has(model.connectionId)) error('고른 AI 연결이 삭제되었습니다. 다시 고르세요.', { nodeId: node.id });
      if (extraModels.some((choice) => !choice.connectionId || !choice.model)) error('함께 나눌 모델을 고르거나 그 칸을 지우세요.', { nodeId: node.id });
      else if (extraModels.some((choice) => !refs.connections.has(choice.connectionId))) error('함께 나눌 모델 중 연결이 삭제된 것이 있습니다.', { nodeId: node.id });
      if (node.config.output === 'json' && !node.config.fields.length) error('자유 형식 출력에는 필드가 하나 이상 필요합니다.', { nodeId: node.id });
      if (node.config.output === 'analysis' && node.config.batch.mode !== 'whole') warn("작품 분석은 '대본 전체' 묶음에서 가장 정확하고 쌉니다. 장면 묶음으로 나누면 부분마다 같은 인물을 다시 읽습니다.", { nodeId: node.id });
    }
    if (node.type === 'entry')
      for (const id of node.config.statusIds) if (!refs.statusIds.has(id)) error('삭제된 상태가 있습니다.', { nodeId: node.id });
    if (node.type === 'function') {
      const info = FUNCTIONS[node.config.fn as FunctionName];
      if (!info) {
        error(`알 수 없는 함수입니다: ${node.config.fn}`, { nodeId: node.id });
        continue;
      }
      const parsed = info.params.safeParse(node.config.params);
      if (!parsed.success) {
        error(`설정 오류: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`, { nodeId: node.id });
        continue;
      }
      const params = parsed.data as Record<string, unknown>;
      if (node.config.fn === 'setStatus') {
        if (params.statusId && !refs.statusIds.has(params.statusId as string)) error('삭제된 상태입니다.', { nodeId: node.id });
        for (const id of [...(params.addTagIds as string[]), ...(params.removeTagIds as string[])])
          if (!refs.tagIds.has(id)) error('삭제된 태그가 있습니다.', { nodeId: node.id });
      }
      if (node.config.fn === 'http') {
        if (!/^https?:\/\//.test(String(params.url).trim())) error('HTTP 호출할 주소(https://…)를 입력하세요.', { nodeId: node.id });
        if (params.connectionId && !refs.toolConnectionIds.has(params.connectionId as string)) error('삭제된 API 키입니다.', { nodeId: node.id });
      }
      if (node.config.fn === 'addTerms' && params.fromNodeId) {
        const from = definition.nodes.find((other) => other.id === params.fromNodeId);
        if (from?.type !== 'ai' || from.config.output !== 'terms') error('용어 후보를 내는 AI 노드를 선택하세요.', { nodeId: node.id });
      }
      if (node.config.fn === 'applyKnowledge' && params.fromNodeId) {
        const from = definition.nodes.find((other) => other.id === params.fromNodeId);
        if (from?.type !== 'ai' || from.config.output !== 'knowledge') error('자료 변경을 내는 AI 노드를 선택하세요.', { nodeId: node.id });
      }
      if (node.config.fn === 'saveAnalysis' && params.fromNodeId) {
        const from = definition.nodes.find((other) => other.id === params.fromNodeId);
        if (from?.type !== 'ai' || from.config.output !== 'analysis') error('작품 분석을 내는 AI 노드를 선택하세요.', { nodeId: node.id });
      }
      if (node.config.fn === 'setListener' && params.fromNodeId) {
        const from = definition.nodes.find((other) => other.id === params.fromNodeId);
        if (from?.type !== 'ai' || from.config.output !== 'listener') error('청자를 내는 AI 노드를 선택하세요.', { nodeId: node.id });
      }
    }
    if (node.type === 'condition' && (node.config.expression === undefined || node.config.expression === null))
      error('조건식을 입력하세요.', { nodeId: node.id });
  }

  if (entries.length === 1) {
    const reachable = new Set<string>();
    const stack = [entries[0].id];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      stack.push(...graph.outNeighbors(id));
    }
    for (const node of definition.nodes)
      if (!reachable.has(node.id)) warn('진입 노드에서 도달할 수 없는 노드입니다.', { nodeId: node.id });
  }

  // A loop is fine as long as something inside it can leave it; otherwise only the visit limit stops it.
  for (const component of stronglyConnectedComponents(graph)) {
    const looping = component.length > 1 || graph.hasDirectedEdge(component[0], component[0]);
    if (!looping) continue;
    // Something in the loop must be able to choose a different exit.
    const exits = component.some((id) => nodePorts(graph.getNodeAttribute(id, 'node') as WorkflowNode).filter((port) => port.id !== 'error').length > 1);
    if (!exits)
      warn(`분기 없이 도는 순환이 있습니다. 노드 방문 상한(${definition.settings.maxVisitsPerNode}회)에서만 멈춥니다.`, {
        nodeId: component[0],
      });
  }
  return issues;
}

/** The work-analysis nodes of a workflow (AI nodes with the "analysis" output, #47). */
export const analysisNodes = (definition: WorkflowDefinition) => definition.nodes.filter((node): node is AiNode => node.type === 'ai' && node.config.output === 'analysis');
/** A workflow that runs a work analysis: only one such run at a time per project. */
export const isAnalysisWorkflow = (definition: WorkflowDefinition) => analysisNodes(definition).length > 0;

/**
 * Which run-dialog readiness checks matter for a workflow: only nodes that write or judge
 * translations (번역 후보, 판정) are made worse by unknown listeners, unreviewed speech rules or
 * terms, and only when they get that context — or a speech / glossary check function runs. A work
 * analysis, listener guess or term extraction reads the script for itself and gets no warnings.
 */
export function readinessUses(definition: WorkflowDefinition) {
  const translating = definition.nodes.filter((node): node is AiNode => node.type === 'ai' && (node.config.output === 'candidate' || node.config.output === 'verdict'));
  const fn = (name: string) => definition.nodes.some((node) => node.type === 'function' && node.config.fn === name);
  return {
    speech: translating.some((node) => node.config.context?.speech !== false),
    glossary: translating.some((node) => node.config.context?.glossary !== false) || fn('glossaryCheck'),
  };
}

/** Whether a run picks its lines by status (its entry names statuses and the scope does not ignore them): such a run never overwrites a translation a person saved (#51). */
export const filtersByStatus = (definition: WorkflowDefinition, scope: { statusIds?: string[]; ignoreStatus?: boolean }) => {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const statusIds = scope.statusIds ?? (entry?.type === 'entry' ? entry.config.statusIds : []);
  return statusIds.length > 0 && !scope.ignoreStatus;
};

/**
 * Keeps the entry node and its connections to the root work node(s) in sync:
 * - Removes any end nodes and their incident edges.
 * - Ensures an entry node exists.
 * - Connects entry to root work node(s) (nodes with 0 incoming edges from other work nodes,
 *   or the first work node if all are in a cycle) when none of the existing entry edges point to a valid root.
 * - Removes redundant entry -> node edges when a work node receives an incoming edge from another work node (unless no other root exists).
 */
export function syncEntryEdges(definition: WorkflowDefinition): WorkflowDefinition {
  let nodes = definition.nodes.filter((node) => node.type !== 'end');

  let entry = nodes.find((node) => node.type === 'entry');
  if (!entry) {
    entry = { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } };
    nodes = [entry, ...nodes];
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  let edges = definition.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  const workNodes = nodes.filter((node) => node.type !== 'entry');
  const workNodeIds = new Set(workNodes.map((node) => node.id));

  if (workNodes.length === 0) {
    edges = edges.filter((edge) => edge.source !== entry.id);
    return { ...definition, nodes, edges };
  }

  const hasIncomingFromWork = new Set<string>();
  for (const edge of edges) {
    if (workNodeIds.has(edge.source) && workNodeIds.has(edge.target)) {
      hasIncomingFromWork.add(edge.target);
    }
  }

  const rootNodes = workNodes.filter((node) => !hasIncomingFromWork.has(node.id));
  const roots = rootNodes.length > 0 ? rootNodes : [workNodes[0]];
  const rootIdSet = new Set(roots.map((node) => node.id));

  if (rootNodes.length > 0) {
    edges = edges.filter((edge) => !(edge.source === entry.id && hasIncomingFromWork.has(edge.target)));
  }

  const currentEntryTargets = new Set(
    edges.filter((edge) => edge.source === entry.id && edge.sourceHandle === 'out').map((edge) => edge.target),
  );

  const hasValidRootConnection = [...currentEntryTargets].some((targetId) => rootIdSet.has(targetId));

  if (!hasValidRootConnection) {
    for (const root of roots) {
      if (!currentEntryTargets.has(root.id)) {
        edges.push({
          id: `e-entry-${root.id}`,
          source: entry.id,
          sourceHandle: 'out',
          target: root.id,
        });
      }
    }
  }

  return { ...definition, nodes, edges };
}

