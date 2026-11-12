import { z } from 'zod';

export const AGENT_ACTIONS = { create: '생성', read: '조회', update: '변경', delete: '삭제', run: '실행' } as const;
export type AgentAction = keyof typeof AGENT_ACTIONS;
export const AGENT_RESOURCES = {
  script: { label: '대사', actions: ['create', 'read', 'update', 'delete'] },
  scenes: { label: '장면', actions: ['create', 'read', 'update', 'delete'] },
  characters: { label: '인물', actions: ['create', 'read', 'update', 'delete'] },
  relationships: { label: '관계', actions: ['create', 'read', 'update', 'delete'] },
  speechRules: { label: '말투 규칙', actions: ['create', 'read', 'update', 'delete'] },
  events: { label: '사건', actions: ['create', 'read', 'update', 'delete'] },
  documents: { label: '노트', actions: ['create', 'read', 'update', 'delete'] },
  terms: { label: '용어집', actions: ['create', 'read', 'update', 'delete'] },
  statuses: { label: '상태', actions: ['create', 'read', 'update', 'delete'] },
  tags: { label: '태그', actions: ['create', 'read', 'update', 'delete'] },
  workflows: { label: '워크플로', actions: ['create', 'read', 'update', 'delete', 'run'], description: '실행하면 워크플로의 반영 노드가 바로 적용하는 변경도 함께 일어납니다.' },
  project: { label: '프로젝트 설정', actions: ['read', 'update'] },
  web: { label: '웹', actions: ['read'] },
} as const satisfies Record<string, { label: string; actions: readonly AgentAction[]; description?: string }>;
export type AgentResource = keyof typeof AGENT_RESOURCES;
export type AgentPermission = { resource: AgentResource; action: AgentAction };
const resources = Object.keys(AGENT_RESOURCES) as [AgentResource, ...AgentResource[]];
const actions = Object.keys(AGENT_ACTIONS) as [AgentAction, ...AgentAction[]];
export const agentPermissionsSchema = z.partialRecord(z.enum(resources), z.partialRecord(z.enum(actions), z.boolean()));
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;
type Policy = { permissions?: AgentPermissions };

export function effectiveAgentPermissions(settings: Policy): AgentPermissions {
  const result: AgentPermissions = {};
  // Everything is allowed until a person says otherwise, except deleting: that is switched on by hand.
  for (const resource of resources) result[resource] = Object.fromEntries(AGENT_RESOURCES[resource].actions.map((action) => [action, action !== 'delete']));
  for (const resource of resources) Object.assign(result[resource]!, settings.permissions?.[resource]);
  return result;
}
