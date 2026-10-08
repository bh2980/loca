import { z } from 'zod';
import Graph from 'graphology';
import { FUNCTIONS, functionPorts, type FunctionName, type Port } from './functions.ts';
import { stronglyConnectedComponents } from 'graphology-components';

/** What an AI node pulls into its prompt. Every field maps to stored project data. */
export const contextConfigSchema = z.object({
  glossary: z.boolean().default(true),
  documents: z.boolean().default(true),
  characters: z.boolean().default(true),
  relationships: z.boolean().default(true),
  precedingLines: z.number().int().min(0).max(50).default(8),
  previousScenes: z.number().int().min(0).max(10).default(1),
});

export const batchConfigSchema = z.object({
  mode: z.enum(['unit', 'group', 'count']).default('group'),
  size: z.number().int().min(1).max(200).default(30),
});

const position = z.object({ x: z.number(), y: z.number() });
const base = { id: z.string().min(1), position, label: z.string().optional() };

/** What an AI node returns for each line; the choice also decides its exits. */
export const AI_OUTPUTS = {
  candidate: { label: '번역 후보', description: '대사마다 새 번역 후보를 만듭니다.' },
  verdict: { label: '판정', description: '통과/실패와 의견을 냅니다.' },
  terms: { label: '용어 후보', description: '원문에서 용어(원문·번역·메모)를 뽑습니다.' },
  json: { label: '자유 형식', description: '직접 정한 필드를 대사마다 채웁니다.' },
} as const;
export type AiOutput = keyof typeof AI_OUTPUTS;

export const jsonFieldSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '영문·숫자·_ 로 된 이름'),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  description: z.string().default(''),
});

const aiConfig = z.object({
  profileId: z.string().default(''),
  instructions: z.string().default(''),
  output: z.enum(['candidate', 'verdict', 'terms', 'json']).default('candidate'),
  fields: z.array(jsonFieldSchema).default([]),
  /** Also show the model the line's current candidate / the latest failing issues. */
  include: z
    .object({ candidate: z.boolean().default(true), issues: z.boolean().default(true) })
    .default({ candidate: true, issues: true }),
  context: contextConfigSchema.default(contextConfigSchema.parse({})),
  batch: batchConfigSchema.default(batchConfigSchema.parse({})),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('entry'), config: z.object({ statusIds: z.array(z.string()).default([]) }) }),
  z.object({ ...base, type: z.literal('ai'), config: aiConfig }),
  z.object({ ...base, type: z.literal('function'), config: z.object({ fn: z.string(), params: z.record(z.string(), z.unknown()).default({}) }) }),
  z.object({
    ...base,
    type: z.literal('condition'),
    // JSON Logic expression evaluated against the line's data (see ConditionData).
    config: z.object({ expression: z.unknown(), description: z.string().default('') }),
  }),
  z.object({ ...base, type: z.literal('human'), config: z.object({ instructions: z.string().default('') }) }),
  z.object({ ...base, type: z.literal('end'), config: z.object({}).default({}) }),
]);

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
});

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  settings: z
    .object({
      maxVisitsPerNode: z.number().int().min(1).max(50).default(5),
      concurrency: z.number().int().min(1).max(8).default(2),
    })
    .default({ maxVisitsPerNode: 5, concurrency: 2 }),
});

export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type BatchConfig = z.infer<typeof batchConfigSchema>;
export type JsonField = z.infer<typeof jsonFieldSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowNodeType = WorkflowNode['type'];
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type AiNode = Extract<WorkflowNode, { type: 'ai' }>;
export type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;

export interface NodeTypeInfo {
  label: string;
  description: string;
  hasInput: boolean;
}

export const NODE_TYPES: Record<WorkflowNodeType, NodeTypeInfo> = {
  entry: { label: '진입', description: '선택한 상태의 대사가 흐름에 들어옵니다.', hasInput: false },
  ai: { label: 'AI', description: '프로필·지시문·문맥으로 AI를 호출해 후보·판정·용어·데이터를 받습니다.', hasInput: true },
  function: { label: '함수', description: '형식 검사·상태 변경·HTTP 호출·스크립트 등 정해진 동작을 실행합니다.', hasInput: true },
  condition: { label: '조건', description: '방문 횟수·앞 노드의 출력 등으로 분기합니다.', hasInput: true },
  human: { label: '사람 확인', description: '검토함에서 사람이 승인하거나 반려할 때까지 기다립니다.', hasInput: true },
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
    case 'human':
      return [{ id: 'approved', label: '승인' }, { id: 'rejected', label: '반려' }];
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
  unit: { kind: string; speaker: string | null; statusId: string; tagIds: string[] };
}

export interface WorkflowIssue {
  level: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowRefs {
  profileIds: Set<string>;
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
    if (usedPorts.has(port)) error('한 출구에는 연결을 하나만 둘 수 있습니다.', { edgeId: edge.id });
    usedPorts.add(port);
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target);
  }

  for (const node of definition.nodes) {
    for (const port of nodePorts(node)) {
      // An unconnected error port means "mark the line failed"; every other exit must lead somewhere.
      if (port.id !== 'error' && !usedPorts.has(`${node.id}:${port.id}`))
        error(`'${port.label}' 출구가 연결되지 않았습니다.`, { nodeId: node.id });
    }
    if (node.type === 'ai') {
      if (!refs.profileIds.has(node.config.profileId))
        error(node.config.profileId ? '삭제된 AI 프로필입니다.' : 'AI 프로필을 선택하세요.', { nodeId: node.id });
      if (node.config.output === 'json' && !node.config.fields.length) error('자유 형식 출력에는 필드가 하나 이상 필요합니다.', { nodeId: node.id });
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
      if (node.config.fn === 'http' && !refs.toolConnectionIds.has(params.connectionId as string))
        error(params.connectionId ? '삭제된 도구 연결입니다.' : '호출할 HTTP 연결을 선택하세요.', { nodeId: node.id });
      if (node.config.fn === 'addTerms' && params.fromNodeId) {
        const from = definition.nodes.find((other) => other.id === params.fromNodeId);
        if (from?.type !== 'ai' || from.config.output !== 'terms') error('용어 후보를 내는 AI 노드를 선택하세요.', { nodeId: node.id });
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
