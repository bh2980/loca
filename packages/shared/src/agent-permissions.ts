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
type Policy = { disabledTools?: string[]; permissions?: AgentPermissions };
const p = (resource: AgentResource, action: AgentAction): AgentPermission => ({ resource, action });
const read = (...targets: AgentResource[]) => targets.map((target) => p(target, 'read'));
const saves: Record<string, AgentResource> = { save_character: 'characters', save_relationship: 'relationships', save_speech_rule: 'speechRules', save_event: 'events', save_document: 'documents' };
const knowledge = ['characters', 'relationships', 'speechRules', 'events', 'documents'] as const;
const deletable = [...knowledge, 'terms', 'tags'] as const;
const fixed: Record<string, AgentPermission[]> = {
  project_overview: read('project', 'script', 'statuses', 'scenes', 'characters', 'documents', 'workflows'),
  list_scenes: read('scenes'), read_scene: read('scenes', 'script'),
  read_line: read('script', 'scenes', 'terms', 'characters', 'speechRules'),
  find_lines: read('script'), scenes_with: read('script', 'scenes'), show_graph: read('script', 'scenes'), line_context: read('script', 'scenes'), find_reading_route: read('script', 'scenes'), list_speakers: read('script'),
  list_characters: read('characters', 'relationships'), list_speech_rules: read('speechRules'), list_events: read('events'), read_documents: read('documents'),
  list_terms: read('terms', 'script'), term_usage: read('terms', 'script'), list_tags: read('tags'), list_statuses: read('statuses'), list_relationships: read('relationships'),
  harness_reference: read('workflows', 'statuses', 'tags'), read_workflow: read('workflows'), read_run: read('workflows'),
  plan_run: read('workflows', 'script', 'characters', 'speechRules', 'terms', 'tags', 'statuses'),
  create_unit: [p('script', 'create')], update_unit: [p('script', 'update')], delete_units: [p('script', 'delete')],
  create_group: [p('scenes', 'create')], update_group: [p('scenes', 'update')], delete_group: [p('scenes', 'delete')],
  propose_translation: [p('script', 'update')], propose_changes: [p('script', 'update')], set_listeners: [p('script', 'update')], link_events: [p('events', 'update')], link_lines: [p('script', 'update')], link_scenes: [p('script', 'update')], link_in_order: [p('script', 'update')], add_line_after: [p('script', 'create')], delete_lines: [p('script', 'delete')], save_group_summary: [p('scenes', 'update')],
  update_status: [p('statuses', 'update')], delete_status: [p('statuses', 'delete')],
  update_tag: [p('tags', 'update')], delete_tag: [p('tags', 'delete')],
  delete_workflow: [p('workflows', 'delete')], edit_workflow_node: [p('workflows', 'update')], start_run: [p('workflows', 'run')],
  read_project_settings: read('project'), update_project_settings: [p('project', 'update')],
  read_app_defaults: read('project'), pull_app_defaults: [p('project', 'update')],
  web_search: read('web'), read_web_page: read('web'),
};
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : [];
const unique = (values: AgentPermission[]) => values.filter((v, i) => values.findIndex((x) => x.resource === v.resource && x.action === v.action) === i);
const upsert = (resource: AgentResource, input: Record<string, unknown>) => p(resource, typeof input.id === 'string' && input.id.length > 0 ? 'update' : 'create');

/** Every entry point checks actual contents; batch transport is not a separate permission. */
export function requiredAgentPermissions(name: string, input: Record<string, unknown>): AgentPermission[] | null {
  if (saves[name]) return [upsert(saves[name], input)];
  if (name === 'save_terms') return unique(rows(input.terms).map((item) => upsert('terms', item)));
  if (name === 'save_knowledge') return unique(knowledge.flatMap((kind) => rows(input[kind]).map((item) => upsert(kind, item))));
  if (name === 'delete_items') return deletable.includes(input.kind as typeof deletable[number]) ? [p(input.kind as AgentResource, 'delete')] : null;
  if (name === 'tag_items') return [...knowledge, 'terms'].includes(input.kind as typeof knowledge[number]) ? [p(input.kind as AgentResource, 'update')] : null;
  if (name === 'save_status') return input.type === 'status' || input.type === 'tag' ? [p(input.type === 'status' ? 'statuses' : 'tags', 'create')] : null;
  if (name === 'save_workflow') return [p('workflows', typeof input.id === 'string' && input.id ? 'update' : 'create')];
  if (name === 'check_script') return read('script', ...(input.kind === 'terms' ? ['terms' as const] : input.kind === 'speech' ? ['speechRules' as const] : []));
  if (name === 'script_stats') return input.of === 'runs' ? read('workflows') : read('script', 'scenes', 'statuses');
  return fixed[name] ?? null;
}

/** Alternative valid calls, for discovery and conservative migration of old tool switches. */
export function agentToolPermissionOptions(name: string): AgentPermission[][] {
  if (saves[name]) return [[p(saves[name], 'create')], [p(saves[name], 'update')]];
  if (name === 'create_unit') return [[p('script', 'create')]];
  if (name === 'update_unit') return [[p('script', 'update')]];
  if (name === 'delete_units') return [[p('script', 'delete')]];
  if (name === 'create_group') return [[p('scenes', 'create')]];
  if (name === 'update_group') return [[p('scenes', 'update')]];
  if (name === 'delete_group') return [[p('scenes', 'delete')]];
  if (name === 'save_terms') return [[p('terms', 'create')], [p('terms', 'update')]];
  if (name === 'save_knowledge') return knowledge.flatMap((kind) => [[p(kind, 'create')], [p(kind, 'update')]]);
  if (name === 'delete_items') return deletable.map((kind) => [p(kind, 'delete')]);
  if (name === 'tag_items') return [...knowledge, 'terms' as const].map((kind) => [p(kind, 'update')]);
  if (name === 'save_status') return [[p('statuses', 'create')], [p('tags', 'create')]];
  if (name === 'save_workflow') return [[p('workflows', 'create')], [p('workflows', 'update')]];
  if (name === 'check_script') return [read('script'), read('script', 'terms'), read('script', 'speechRules')];
  if (name === 'script_stats') return [read('workflows'), read('script', 'scenes', 'statuses')];
  return fixed[name] ? [fixed[name]] : [];
}

export function effectiveAgentPermissions(settings: Policy): AgentPermissions {
  const result: AgentPermissions = {};
  // Everything is allowed until a person says otherwise, except deleting: that is switched on by hand.
  for (const resource of resources) result[resource] = Object.fromEntries(AGENT_RESOURCES[resource].actions.map((action) => [action, action !== 'delete']));
  for (const tool of settings.disabledTools ?? []) for (const permission of agentToolPermissionOptions(tool).flat()) result[permission.resource]![permission.action] = false;
  for (const resource of resources) Object.assign(result[resource]!, settings.permissions?.[resource]);
  return result;
}
export function agentToolAvailable(settings: Policy, name: string): boolean {
  if (settings.disabledTools?.includes(name)) return false;
  const permissions = effectiveAgentPermissions(settings);
  return agentToolPermissionOptions(name).some((option) => option.every(({ resource, action }) => permissions[resource]?.[action] === true));
}
export function agentPermissionError(settings: Policy, name: string, input: Record<string, unknown>): string | null {
  if (settings.disabledTools?.includes(name)) return '이 도구는 프로젝트 설정에서 꺼져 있습니다.';
  const required = requiredAgentPermissions(name, input);
  if (!required) return '허용되지 않은 도구 또는 대상입니다.';
  const permissions = effectiveAgentPermissions(settings);
  const denied = required.filter(({ resource, action }) => permissions[resource]?.[action] !== true);
  return denied.length ? `허용되지 않은 작업입니다: ${denied.map(({ resource, action }) => `${AGENT_RESOURCES[resource].label} ${AGENT_ACTIONS[action]}`).join(', ')}. 에이전트 권한 설정을 확인하세요.` : null;
}
