import { z } from 'zod';
import Graph from 'graphology';
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

const aiConfig = z.object({
  profileId: z.string().default(''),
  instructions: z.string().default(''),
  context: contextConfigSchema.default(contextConfigSchema.parse({})),
  batch: batchConfigSchema.default(batchConfigSchema.parse({})),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('entry'), config: z.object({ statusIds: z.array(z.string()).default([]) }) }),
  z.object({ ...base, type: z.literal('translate'), config: aiConfig }),
  z.object({ ...base, type: z.literal('review'), config: aiConfig }),
  z.object({ ...base, type: z.literal('revise'), config: aiConfig }),
  z.object({
    ...base,
    type: z.literal('check'),
    config: z.object({
      placeholders: z.boolean().default(true),
      tags: z.boolean().default(true),
      newlines: z.boolean().default(true),
      emptyText: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('condition'),
    // JSON Logic expression evaluated against the item's data (see ConditionData).
    config: z.object({ expression: z.unknown(), description: z.string().default('') }),
  }),
  z.object({
    ...base,
    type: z.literal('update'),
    config: z.object({
      statusId: z.string().optional(),
      addTagIds: z.array(z.string()).default([]),
      removeTagIds: z.array(z.string()).default([]),
      applyCandidate: z.boolean().default(false),
    }),
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
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowNodeType = WorkflowNode['type'];
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type AiNode = Extract<WorkflowNode, { type: 'translate' | 'review' | 'revise' }>;

export interface NodeTypeInfo {
  label: string;
  description: string;
  hasInput: boolean;
  outputs: { id: string; label: string }[];
}

export const NODE_TYPES: Record<WorkflowNodeType, NodeTypeInfo> = {
  entry: { label: '진입', description: '선택한 상태의 대사가 흐름에 들어옵니다.', hasInput: false, outputs: [{ id: 'out', label: '다음' }] },
  translate: {
    label: 'AI 번역',
    description: '문맥과 함께 번역 후보를 만듭니다.',
    hasInput: true,
    outputs: [{ id: 'out', label: '완료' }, { id: 'error', label: '오류' }],
  },
  review: {
    label: 'AI 검수',
    description: '최신 후보를 검수하고 통과/실패를 판정합니다.',
    hasInput: true,
    outputs: [{ id: 'pass', label: '통과' }, { id: 'fail', label: '실패' }, { id: 'error', label: '오류' }],
  },
  revise: {
    label: 'AI 수정',
    description: '검수·형식 검사 의견을 반영해 새 후보를 만듭니다.',
    hasInput: true,
    outputs: [{ id: 'out', label: '완료' }, { id: 'error', label: '오류' }],
  },
  check: {
    label: '형식 검사',
    description: '태그·플레이스홀더·줄바꿈 보존을 검사합니다.',
    hasInput: true,
    outputs: [{ id: 'pass', label: '통과' }, { id: 'fail', label: '실패' }],
  },
  condition: {
    label: '조건',
    description: '방문 횟수·검수 결과 등으로 분기합니다.',
    hasInput: true,
    outputs: [{ id: 'true', label: '참' }, { id: 'false', label: '거짓' }],
  },
  update: {
    label: '상태 변경',
    description: '상태·태그를 바꾸고 후보를 대표 번역으로 적용합니다.',
    hasInput: true,
    outputs: [{ id: 'out', label: '다음' }],
  },
  human: {
    label: '사람 확인',
    description: '검토함에서 사람이 승인하거나 반려할 때까지 기다립니다.',
    hasInput: true,
    outputs: [{ id: 'approved', label: '승인' }, { id: 'rejected', label: '반려' }],
  },
  end: { label: '종료', description: '대사의 흐름을 마칩니다.', hasInput: true, outputs: [] },
};

export const isAiNode = (node: WorkflowNode): node is AiNode =>
  node.type === 'translate' || node.type === 'review' || node.type === 'revise';

/** Data a condition expression can read, e.g. {"<": [{"var": "visits.revise"}, 3]}. */
export interface ConditionData {
  visits: Record<string, number>;
  review?: { passed: boolean; score?: number; issues: string[] };
  check?: { passed: boolean; issues: string[] };
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
    if (!NODE_TYPES[source.type].outputs.some((port) => port.id === edge.sourceHandle))
      error(`'${NODE_TYPES[source.type].label}'에 없는 출구입니다: ${edge.sourceHandle}`, { edgeId: edge.id });
    if (!NODE_TYPES[target.type].hasInput) error('진입 노드로 들어가는 연결은 둘 수 없습니다.', { edgeId: edge.id });
    const port = `${edge.source}:${edge.sourceHandle}`;
    if (usedPorts.has(port)) error('한 출구에는 연결을 하나만 둘 수 있습니다.', { edgeId: edge.id });
    usedPorts.add(port);
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target);
  }

  for (const node of definition.nodes) {
    const info = NODE_TYPES[node.type];
    for (const port of info.outputs) {
      // An unconnected error port means "mark the line failed"; every other exit must lead somewhere.
      if (port.id !== 'error' && !usedPorts.has(`${node.id}:${port.id}`))
        error(`'${port.label}' 출구가 연결되지 않았습니다.`, { nodeId: node.id });
    }
    if (isAiNode(node) && !refs.profileIds.has(node.config.profileId))
      error(node.config.profileId ? '삭제된 AI 프로필입니다.' : 'AI 프로필을 선택하세요.', { nodeId: node.id });
    if (node.type === 'entry')
      for (const id of node.config.statusIds) if (!refs.statusIds.has(id)) error('삭제된 상태가 있습니다.', { nodeId: node.id });
    if (node.type === 'update') {
      if (node.config.statusId && !refs.statusIds.has(node.config.statusId)) error('삭제된 상태입니다.', { nodeId: node.id });
      for (const id of [...node.config.addTagIds, ...node.config.removeTagIds])
        if (!refs.tagIds.has(id)) error('삭제된 태그가 있습니다.', { nodeId: node.id });
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
    const exits = component.some((id) => {
      const type = (graph.getNodeAttribute(id, 'node') as WorkflowNode).type;
      return type === 'condition' || type === 'human' || type === 'review' || type === 'check';
    });
    if (!exits)
      warn(`분기 없이 도는 순환이 있습니다. 노드 방문 상한(${definition.settings.maxVisitsPerNode}회)에서만 멈춥니다.`, {
        nodeId: component[0],
      });
  }
  return issues;
}
