import { z } from 'zod';
import Graph from 'graphology';
import { APPLY_TARGETS, FUNCTIONS, functionPorts, functionTakes, jsonFieldSchema, type ApplyFunctionName, type ApplyParams, type FunctionName, type JsonField, type Port } from './functions.ts';
import { stronglyConnectedComponents } from 'graphology-components';
import { choiceKey, draftModelChoiceSchema, EMPTY_MODEL_CHOICE, modelChoiceSchema, type ModelChoice } from './model-choice.ts';
import { KNOWLEDGE_STATUSES } from './knowledge.ts';

/**
 * What an AI node pulls into its prompt. Every field maps to stored project data.
 * Defaults follow the experiments: a known listener with a confirmed speech rule,
 * glossary, preceding lines and the scene description help; character profiles, relationship bundles
 * and documents did nothing or hurt, so they are opt-in per node.
 */
export const contextConfigSchema = z.object({
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
  /** Term workflows: lines a term appears in (with their translations) sent with it. */
  examples: z.number().int().min(0).max(5).default(2),
  /** Estimated token cap for everything besides the lines themselves; what does not fit is dropped and recorded. Null = auto, from the model's limits (autoBudgets). */
  maxTokens: z.number().int().min(500).max(1_000_000).nullable().default(null),
});

/** How lines become model requests; see planBatches (apps/server/src/engine/batches.ts). */
export const batchConfigSchema = z.object({
  /**
   * group: consecutive scenes share a request, scenes kept whole when they fit; count: fixed size across
   * scenes; unit: one line each; whole: the whole script in as few requests as `maxTokens` allows (work analysis).
   */
  mode: z.enum(['unit', 'group', 'count', 'whole']).default('group'),
  /** Lines per request in "count" mode; the other modes are bounded by tokens only (lineCost per line). */
  size: z.number().int().min(1).max(1_000).default(60),
  /** Most estimated tokens of line text in one request ("group", "whole"); context is capped separately. Null = auto, from the model's limits (autoBudgets). */
  maxTokens: z.number().int().min(500).max(10_000_000).nullable().default(null),
});

const position = z.object({ x: z.number(), y: z.number() });
const base = { id: z.string().min(1), position, label: z.string().optional() };

/**
 * What an AI node returns: a form, not a purpose. Where a result goes in the project is up to the
 * apply nodes after it (APPLY_TARGETS); terms, characters or a work analysis are `json` outputs made
 * from a preset, not kinds of their own.
 */
export const AI_OUTPUTS = {
  text: { label: '문장', description: '대사마다 텍스트 하나(번역문·수정문 등). 흐름의 현재 번역문이 됩니다.' },
  verdict: { label: '판정', description: '대사마다 통과/실패와 이유. 통과·실패 두 출구로 나뉩니다.' },
  choice: { label: '선택', description: '대사마다 정한 선택지 중 하나(또는 없음)와 확신도(0~1).' },
  json: { label: 'JSON', description: '직접 정한 필드를 채웁니다. 대사마다 또는 묶음 전체에 하나.' },
} as const;
export type AiOutput = keyof typeof AI_OUTPUTS;
export const AI_OUTPUT_IDS = Object.keys(AI_OUTPUTS) as AiOutput[];

/** `line`: one answer per line. `batch`: one answer per request (lists that belong to no single line). Only `json` can be `batch`. */
export const AI_SCOPES = { line: '대사마다', batch: '묶음 전체' } as const;
export type AiScope = keyof typeof AI_SCOPES;

/**
 * Where a `choice` node's options come from: typed by hand, or a project list read when the run
 * sends the request (cast names plus group/public/self, line tag names, status names).
 */
export const CHOICE_SOURCES = { custom: '직접 입력', characters: '인물', lineTags: '태그', statuses: '상태' } as const;
export type ChoiceSource = keyof typeof CHOICE_SOURCES;
export const choiceConfigSchema = z.object({
  source: z.enum(Object.keys(CHOICE_SOURCES) as [ChoiceSource, ...ChoiceSource[]]).default('custom'),
  values: z.array(z.string().trim().min(1)).default([]),
  /** The model may answer "none of these" (null). */
  allowNone: z.boolean().default(true),
});
export type ChoiceConfig = z.infer<typeof choiceConfigSchema>;

export { jsonFieldSchema, type JsonField };

/**
 * An AI node's input. `previous`: the result of the step before it goes into the prompt as each line's
 * "previous", trimmed to `fields` (paths like "characters.name"; empty = all of it). The step before is
 * the last node on the line's way here that leaves a result (see leavesResult): conditions, checks and
 * save nodes pass it on, so 청자 추정 → 확신도? → 청자 저장 → 번역 gives 번역 the 청자 추정 result.
 * `lines: false` sends no lines at all, only the previous results (one answer for the request: json,
 * 묶음 전체), e.g. a node after a gather that combines the parts.
 */
export const aiInputSchema = z
  .object({ lines: z.boolean().default(true), previous: z.boolean().default(false), fields: z.array(z.string().trim().min(1)).default([]) })
  .prefault({});

/** Nodes whose result the next step reads (an AI node's "previous", an apply node, a gather): AI, script and gather nodes. Others pass the line on. */
export const leavesResult = (node: WorkflowNode | undefined) =>
  node?.type === 'ai' || node?.type === 'gather' || (node?.type === 'function' && node.config.fn === 'script');

/** The id of the previous step on an item's way (`path`): the last node it passed that leaves a result, not through its error exit. */
export function previousStepId(definition: Pick<WorkflowDefinition, 'nodes'>, path: { nodeId: string; port: string }[]): string | undefined {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  return path.findLast((visit) => visit.port !== 'error' && leavesResult(byId.get(visit.nodeId)))?.nodeId;
}

/**
 * The nodes whose result can reach `nodeId` as "previous": going back along the edges, the first node on
 * each way that leaves a result; a result node's error exit carries no result, so the way goes on behind it.
 */
export function previousSteps(definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>, nodeId: string): WorkflowNode[] {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const into = Map.groupBy(definition.edges, (edge) => edge.target);
  const found = new Set<string>();
  const seen = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length)
    for (const edge of into.get(stack.pop()!) ?? []) {
      const source = byId.get(edge.source);
      if (leavesResult(source) && edge.sourceHandle !== 'error' && edge.source !== nodeId) found.add(edge.source);
      else if (!seen.has(edge.source)) {
        seen.add(edge.source);
        stack.push(edge.source);
      }
    }
  return definition.nodes.filter((node) => found.has(node.id));
}

/**
 * `value` trimmed to `paths` ("a", "a.b"; a path through a list applies to each of its items), or
 * the value itself when there are none.
 */
export function pickPaths(value: unknown, paths: string[]): unknown {
  if (!paths.length || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => pickPaths(item, paths));
  const byHead = Map.groupBy(paths.map((path) => path.split('.')), (parts) => parts[0]!);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    [...byHead].filter(([head]) => head in record).map(([head, parts]) => {
      const rest = parts.map((part) => part.slice(1).join('.')).filter(Boolean);
      // A path that ends here keeps the whole value; longer ones only trim inside it.
      return [head, parts.some((part) => part.length === 1) ? record[head] : pickPaths(record[head], rest)];
    }),
  );
}

/** What a workflow takes in: script lines, or glossary terms. Its entry node declares it (`input`). */
export const WORKFLOW_SUBJECTS = { lines: '대사', terms: '용어' } as const;
export type WorkflowSubject = keyof typeof WORKFLOW_SUBJECTS;
export const WORKFLOW_SUBJECT_IDS = Object.keys(WORKFLOW_SUBJECTS) as WorkflowSubject[];

/**
 * How the two inputs differ, in one place: the editor, validation, the runner and the CLI read this
 * instead of asking "is it terms?" themselves. A node is core plus the extension of its workflow's
 * input; values of the other input's extension are kept but unused.
 */
export const INPUT_TYPES = {
  lines: {
    label: '대사',
    unit: '줄',
    /** AI batch modes: the core (count, unit) and scenes / the whole script. */
    batchModes: ['group', 'count', 'unit', 'whole'],
    /** AI context settings that only lines have. */
    contextFields: ['precedingLines', 'precedingTranslations', 'previousScenes', 'speech'],
    /** Condition rows that only lines have (the core: node result, visits, failure, translation). */
    conditionRows: ['status', 'lineKind', 'tag', 'mark', 'listener'],
  },
  terms: {
    label: '용어',
    unit: '개',
    batchModes: ['count', 'unit'],
    contextFields: ['examples'],
    conditionRows: ['termStatus', 'hasTarget', 'uses'],
  },
} as const satisfies Record<WorkflowSubject, { label: string; unit: string; batchModes: readonly BatchConfig['mode'][]; contextFields: readonly (keyof ContextConfig)[]; conditionRows: readonly string[] }>;
/** Context settings that belong to one input (shown and used only there); the rest is core. */
export const INPUT_CONTEXT_FIELDS = new Set<string>([...INPUT_TYPES.lines.contextFields, ...INPUT_TYPES.terms.contextFields]);

/** The entry node: what the workflow takes in. Which items a run takes is the run's scope (the run dialog), not the workflow's. */
export const entryConfigSchema = z
  .object({ input: z.enum(WORKFLOW_SUBJECT_IDS as [WorkflowSubject, ...WorkflowSubject[]]).default('lines') })
  .prefault({});
export type EntryConfig = z.infer<typeof entryConfigSchema>;
/** How the editor names batch modes. */
export const BATCH_MODE_LABELS: Record<BatchConfig['mode'], string> = { group: '장면별', count: '개수별', unit: '하나씩', whole: '대본 전체' };
/** A workflow's input: what its entry node declares. */
export const workflowInput = (definition: Pick<WorkflowDefinition, 'nodes'>): WorkflowSubject => {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  return entry?.type === 'entry' ? entryConfigSchema.parse(entry.config ?? {}).input : 'lines';
};
/** Whether an AI preset is written for this input (presets are for lines unless they say terms). */
export const presetTakes = (preset: { inputs?: readonly WorkflowSubject[] }, input: WorkflowSubject) => (preset.inputs ?? WORKFLOW_SUBJECT_IDS).includes(input);

/**
 * 모으기: waits until no item of the run is still open before it (every request of the nodes upstream
 * has answered), then passes ONE item on, carrying the previous step's results of all of them (the
 * result node before it on each item's way, see previousStepId):
 * outputs.<gather> = { parts: [one per answer, trimmed to `fields`], count, failed }. The other items
 * end there. After a gather the flow is "the combined result", not items: nodes that change an item
 * are refused, and an AI node right after it reads the parts with input { previous: true, lines: false }.
 */
export const gatherConfigSchema = z.object({ fields: z.array(z.string().trim().min(1)).default([]) }).prefault({});
export type GatherConfig = z.infer<typeof gatherConfigSchema>;

/** Functions that write the item itself (its status, translation, listener, tags, a term's form or status). */
export const ITEM_CHANGING_FUNCTIONS = new Set(['setStatus', 'saveCandidate', 'setListener', 'tagLines']);

/** An AI node's call time limit when it does not set one, in minutes. */
export const DEFAULT_CALL_MINUTES = 10;

/**
 * Why a line left a node through its "error" exit, as conditions read it (error.kind). The runner
 * never splits or re-sends a failed request on its own: a workflow routes these (a retry loop, a
 * smaller-batch node), or an exit left unconnected ends the line as failed. Rate limits and dropped connections are not the line's
 * fault: those lines wait for a later request, and the run pauses after the workflow's
 * "연속 실패" count.
 */
export const ITEM_ERROR_KINDS = {
  missing: '답에서 빠짐',
  'invalid-output': '형식 오류',
  timeout: '시간 초과',
  'too-long': '요청이 너무 김',
  'cut-off': '출력 잘림',
  refused: '거절',
  /** The node does not work on this kind of item (a line-only node given a term, or the reverse). */
  unsupported: '맞지 않는 항목',
  other: '기타',
} as const;
export type ItemErrorKind = keyof typeof ITEM_ERROR_KINDS;
export const ITEM_ERROR_KIND_IDS = Object.keys(ITEM_ERROR_KINDS) as ItemErrorKind[];

export const aiNodeConfigSchema = z.object({
  model: draftModelChoiceSchema.default({ ...EMPTY_MODEL_CHOICE }),
  /** More models sharing this node's work: each request goes to whichever account has a free slot. */
  extraModels: z.array(draftModelChoiceSchema).default([]),
  /** Empty = the model's default. Only some API models take it. */
  temperature: z.number().min(0).max(2).optional(),
  /** The prompt. Everything the model is told is here or in the read-only format part shown in the preview. */
  instructions: z.string().default(''),
  output: z.enum(AI_OUTPUT_IDS as [AiOutput, ...AiOutput[]]).default('text'),
  scope: z.enum(['line', 'batch']).default('line'),
  fields: z.array(jsonFieldSchema).default([]),
  choice: choiceConfigSchema.default(choiceConfigSchema.parse({})),
  /** The preset this node was filled from (shown as a hint; the node is an ordinary AI node). */
  preset: z.string().optional(),
  /** Also show the model the line's current candidate / the latest failing issues. */
  include: z
    .object({ candidate: z.boolean().default(true), issues: z.boolean().default(true) })
    .default({ candidate: true, issues: true }),
  context: contextConfigSchema.default(contextConfigSchema.parse({})),
  batch: batchConfigSchema.default(batchConfigSchema.parse({})),
  /** How long one request of this node may take before it fails with error kind "timeout". */
  timeoutMinutes: z.number().int().min(1).max(240).default(DEFAULT_CALL_MINUTES),
  /** How many of this node's requests a run sends at once (each one a model process for a CLI connection). */
  concurrency: z.number().int().min(1).max(16).default(1),
  /** What the request reads besides the context: the lines, and what an earlier node produced for them. */
  input: aiInputSchema,
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('entry'), config: entryConfigSchema }),
  z.object({ ...base, type: z.literal('ai'), config: aiNodeConfigSchema }),
  z.object({ ...base, type: z.literal('function'), config: z.object({ fn: z.string(), params: z.record(z.string(), z.unknown()).default({}) }) }),
  z.object({
    ...base,
    type: z.literal('condition'),
    // JSON Logic expression evaluated against the line's data (see ConditionData).
    config: z.object({ expression: z.unknown(), description: z.string().default('') }),
  }),
  z.object({ ...base, type: z.literal('end'), config: z.object({}).default({}) }),
  z.object({ ...base, type: z.literal('gather'), config: gatherConfigSchema }),
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
  ai: { label: 'AI', description: '고른 모델·지시문·문맥으로 AI를 호출해 후보·판정·용어·데이터를 받습니다.', hasInput: true },
  function: { label: '함수', description: '형식 검사·상태 변경·HTTP 호출·스크립트 등 정해진 동작을 실행합니다.', hasInput: true },
  condition: { label: '조건', description: '방문 횟수·앞 노드의 출력·대사 속성 등으로 분기합니다.', hasInput: true },
  end: { label: '종료', description: '대사의 흐름을 마칩니다.', hasInput: true },
  gather: { label: '모으기', description: '앞 노드의 결과를 모든 요청이 끝날 때까지 모았다가, 합친 결과 하나를 다음 노드로 넘깁니다.', hasInput: true },
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
    case 'gather':
      return [{ id: 'out', label: '다음' }];
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
  /** marks: the line's automatic marks right now (lineMarksOf in marks.ts; diverged is only known to the list filter). Line workflows. */
  unit?: { kind: string; speaker: string | null; listener: string | null; statusId: string; tagIds: string[]; marks: string[] };
  /** The term (runs on terms): its status, who decided it, whether it has a Korean form, lines it appears in, marks (termMarksOf), tags. */
  term?: { status: string; statusBy: string; hasTarget: boolean; lines: number | null; marks: string[]; tagIds: string[] };
  /** The last failure that sent the line out through an "error" exit (null once a node handles it). */
  error: { kind: ItemErrorKind; message: string; nodeId: string } | null;
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
  const input = workflowInput(definition);
  const inputType = INPUT_TYPES[input];

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
      if (!(inputType.batchModes as readonly string[]).includes(node.config.batch.mode)) error(`${inputType.label} 입력에서는 묶음을 ${inputType.batchModes.map((mode) => BATCH_MODE_LABELS[mode]).join('·')}(으)로 정합니다.`, { nodeId: node.id });
      if (!model.connectionId || !model.model) error('AI 연결과 모델을 고르세요.', { nodeId: node.id });
      else if (!refs.connections.has(model.connectionId)) error('고른 AI 연결이 삭제되었습니다. 다시 고르세요.', { nodeId: node.id });
      if (extraModels.some((choice) => !choice.connectionId || !choice.model)) error('추가한 모델을 고르거나 그 칸을 지우세요.', { nodeId: node.id });
      else if (extraModels.some((choice) => !refs.connections.has(choice.connectionId))) error('추가한 모델 중 연결이 삭제된 것이 있습니다.', { nodeId: node.id });
      if (node.config.output === 'json' && !node.config.fields.length) error('JSON 출력에는 필드가 하나 이상 필요합니다.', { nodeId: node.id });
      if (node.config.output === 'json' && node.config.fields.some((field) => field.type === 'list' && !field.fields?.length)) error('목록 필드에는 항목 필드가 하나 이상 필요합니다.', { nodeId: node.id });
      if (node.config.output === 'choice' && node.config.choice.source === 'custom' && !node.config.choice.values.length) error('선택지를 하나 이상 적으세요.', { nodeId: node.id });
      if (node.config.scope === 'batch' && node.config.output !== 'json') error("'묶음 전체' 출력은 JSON에서만 쓸 수 있습니다.", { nodeId: node.id });
      const input = aiInputSchema.parse(node.config.input ?? {});
      if (input.previous) {
        if (!previousSteps(definition, node.id).length) error('앞 단계에 결과를 내는 노드(AI·스크립트·모으기)가 없습니다.', { nodeId: node.id });
        if (node.config.batch.mode === 'whole') error('대본 전체로 읽는 노드에는 앞 단계 결과를 넣을 수 없습니다.', { nodeId: node.id });
      }
      if (!input.lines && !(input.previous && node.config.output === 'json' && node.config.scope === 'batch')) error('대사 없이 보내려면 앞 단계 결과를 넣고, 출력을 JSON · 묶음 전체로 하세요.', { nodeId: node.id });
    }
    if (node.type === 'gather') {
      const steps = previousSteps(definition, node.id);
      if (!steps.length) error('모으기 앞 단계에 결과를 내는 AI·스크립트 노드가 없습니다.', { nodeId: node.id });
      else if (steps.some((step) => step.type === 'gather')) error('모으기 바로 앞 단계가 또 모으기일 수는 없습니다.', { nodeId: node.id });
      const after = [...reach(node.id)].filter((id) => id !== node.id);
      // A gather inside a loop would close more than once per pass and never know when it is done.
      if ((graph.outNeighbors(node.id) as string[]).some((next) => reach(next).has(node.id))) error('모으기는 되돌아가는 고리 안에 둘 수 없습니다.', { nodeId: node.id });
      for (const id of after) {
        const next = definition.nodes.find((other) => other.id === id)!;
        // After a gather one item carries the combined result: nothing may change "the item".
        if (next.type === 'function' && ITEM_CHANGING_FUNCTIONS.has(next.config.fn)) error(`'${nodeName(next)}'는 모으기 뒤에 둘 수 없습니다. 모은 뒤에는 대사·용어가 아니라 합친 결과 하나가 흐릅니다.`, { nodeId: next.id });
        if (next.type === 'ai' && next.config.input.lines) error('모으기 뒤의 AI 노드는 입력에서 대사를 빼고(대사도 넣기 끔) 모은 결과를 읽어야 합니다.', { nodeId: next.id });
      }
    }
    if (node.type === 'function' && !functionTakes(node.config.fn, input)) error(`'${nodeName(node)}'는 ${inputType.label} 입력 워크플로에 쓸 수 없는 노드입니다.`, { nodeId: node.id });
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
        const known = input === 'terms' ? (KNOWLEDGE_STATUSES as readonly string[]).includes(params.statusId as string) : refs.statusIds.has(params.statusId as string);
        if (params.statusId && !known) error('삭제된 상태입니다.', { nodeId: node.id });
        for (const id of [...(params.addTagIds as string[]), ...(params.removeTagIds as string[])])
          if (!refs.tagIds.has(id)) error('삭제된 태그가 있습니다.', { nodeId: node.id });
      }
      if (node.config.fn === 'http') {
        if (!/^https?:\/\//.test(String(params.url).trim())) error('HTTP 호출할 주소(https://…)를 입력하세요.', { nodeId: node.id });
        if (params.connectionId && !refs.toolConnectionIds.has(params.connectionId as string)) error('삭제된 API 키입니다.', { nodeId: node.id });
      }
      if (node.config.fn in APPLY_TARGETS) for (const message of applyIssues(definition, node.id, node.config.fn as ApplyFunctionName, params as ApplyParams)) error(message, { nodeId: node.id });
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

/**
 * What is wrong with an apply node's source and mapping: the previous step (along the edges) must be an
 * AI or script node, a `list` target needs the list field, and every required field must be mapped.
 */
export function applyIssues(definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>, nodeId: string, fn: ApplyFunctionName, params: ApplyParams): string[] {
  const target = APPLY_TARGETS[fn];
  const steps = previousSteps(definition, nodeId);
  if (!steps.length || steps.some((step) => step.type === 'gather')) return ['앞 단계에 결과를 내는 AI·스크립트 노드가 없습니다. 반영할 결과를 내는 노드 뒤에 이으세요.'];
  const issues: string[] = [];
  if (target.shape === 'list' && !params.list) issues.push('항목을 가져올 목록 필드를 고르세요.');
  const missing = target.fields.filter((field) => 'required' in field && field.required && !params.map[field.name]);
  if (missing.length) issues.push(`필드를 연결하세요: ${missing.map((field) => field.label).join(', ')}`);
  return issues;
}

/** AI nodes that read the whole script in one request (batch mode "whole"). */
export const wholeScriptNodes = (definition: WorkflowDefinition) => definition.nodes.filter((node): node is AiNode => node.type === 'ai' && node.config.batch.mode === 'whole');
/** A workflow that reads the whole script at once: only one such run at a time per project (two would send the same script twice). */
export const isWholeScriptWorkflow = (definition: WorkflowDefinition) => wholeScriptNodes(definition).length > 0;

/**
 * Which run-dialog readiness checks matter for a workflow: those whose information some AI node
 * actually sends — listeners and speech rules (context "청자·말투"; a whole-script request never
 * sends them), the glossary (context "용어집", or a glossary check function). Unknown or unreviewed
 * entries there would reach the model as if they were settled.
 */
export function readinessUses(definition: WorkflowDefinition) {
  const contexts = definition.nodes.filter((node): node is AiNode => node.type === 'ai').map((node) => ({ context: contextConfigSchema.parse(node.config.context ?? {}), whole: node.config.batch?.mode === 'whole' }));
  return {
    speech: contexts.some(({ context, whole }) => context.speech && !whole),
    glossary: contexts.some(({ context }) => context.glossary) || definition.nodes.some((node) => node.type === 'function' && node.config.fn === 'glossaryCheck'),
  };
}

/** Whether a run picks its lines by status (the run dialog's status filter): such a run never overwrites a translation a person saved (#51). */
export const filtersByStatus = (scope: { statusIds?: string[] }) => Boolean(scope.statusIds?.length);

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
    entry = { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: entryConfigSchema.parse({}) };
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

