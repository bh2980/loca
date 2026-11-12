import { AGENT_ACTIONS, AGENT_RESOURCES, effectiveAgentPermissions, type AgentAction, type AgentPermission, type AgentPermissions, type AgentResource } from './agent-permissions.ts';

type Input = Record<string, unknown>;

/** Permissions that depend on what a call asks for: `of` for one input (null = not a valid target), `options` every alternative a valid call can need. */
interface NeedsByInput {
  of: (input: Input) => AgentPermission[] | null;
  options: AgentPermission[][];
}

/**
 * Everything about an agent tool that is not its code: the one place its label, the permissions it
 * needs and how much it changes are written. The server's catalogue (name → description, input,
 * execute) is typed against these keys; the risk class, whether it goes through the change gate and
 * how many items a call touches are computed from here, never written a second time.
 */
export interface ToolSpec {
  label: string;
  needs: AgentPermission[] | NeedsByInput;
  /** The input fields that list what a call changes; their lengths add up to its item count (one when there are none). */
  batch?: readonly string[];
  /**
   * How it is carried out when not the default (a read runs at once, anything else goes through the change gate):
   * `direct` writes at once (saved graph views: a way of looking at the graph, not project data);
   * `editor` has no server side: the workflow editor open in the browser applies it to its draft.
   */
  via?: 'direct' | 'editor';
  /** Accepted, it only adds an AI 제안; the current translation stays. */
  candidateOnly?: true;
}

const p = (resource: AgentResource, action: AgentAction): AgentPermission => ({ resource, action });
const read = (...targets: AgentResource[]) => targets.map((target) => p(target, 'read'));
const isRecord = (value: unknown): value is Input => !!value && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
const unique = (values: AgentPermission[]) => values.filter((v, i) => values.findIndex((x) => x.resource === v.resource && x.action === v.action) === i);
/** A save with an id changes that item; without one it makes a new item. */
const upsertOf = (resource: AgentResource, input: Input) => p(resource, typeof input.id === 'string' && input.id.length > 0 ? 'update' : 'create');
const upsert = (resource: AgentResource): NeedsByInput => ({ of: (input) => [upsertOf(resource, input)], options: [[p(resource, 'create')], [p(resource, 'update')]] });
/** One permission on the resource the input's `kind` names. */
const byKind = (kinds: readonly AgentResource[], action: AgentAction): NeedsByInput => ({
  of: (input) => (kinds.includes(input.kind as AgentResource) ? [p(input.kind as AgentResource, action)] : null),
  options: kinds.map((kind) => [p(kind, action)]),
});

const KNOWLEDGE_KEYS = ['characters', 'relationships', 'speechRules', 'events', 'documents'] as const;
const DELETABLE = [...KNOWLEDGE_KEYS, 'terms', 'tags'] as const;
const TAGGABLE = [...KNOWLEDGE_KEYS, 'terms'] as const;
const taxonomy = (action: AgentAction): NeedsByInput => ({
  of: (input) => (input.type === 'status' || input.type === 'tag' ? [p(input.type === 'status' ? 'statuses' : 'tags', action)] : null),
  options: [[p('statuses', action)], [p('tags', action)]],
});

export const TOOL_SPECS = {
  // ── lines and scenes ──
  project_overview: { label: '프로젝트 개요 조회', needs: read('project', 'script', 'statuses', 'scenes', 'characters', 'documents', 'workflows') },
  list_scenes: { label: '장면 목록 조회', needs: read('scenes') },
  read_scene: { label: '장면 읽기', needs: read('scenes', 'script') },
  read_line: { label: '대사 읽기', needs: read('script', 'scenes', 'terms', 'characters', 'speechRules') },
  find_lines: { label: '대사 찾기', needs: read('script') },
  scenes_with: { label: '같이 나오는 장면 찾기', needs: read('script', 'scenes') },
  line_context: { label: '대사 앞뒤·분기 보기', needs: read('script', 'scenes') },
  find_reading_route: { label: '경로 대본 찾기', needs: read('script', 'scenes') },
  show_graph: { label: '그래프에서 보여 주기', needs: read('script', 'scenes'), via: 'direct' },
  list_views: { label: '저장된 보기 목록 조회', needs: read('script', 'scenes') },
  update_view: { label: '보기 이름·노드 바꾸기', needs: read('script', 'scenes'), via: 'direct' },
  check_script: {
    label: '번역 점검',
    needs: { of: (input) => read('script', ...(input.kind === 'terms' ? ['terms' as const] : [])), options: [read('script'), read('script', 'terms')] },
  },
  script_stats: {
    label: '진행·실행 통계',
    needs: { of: (input) => (input.of === 'runs' ? read('workflows') : read('script', 'scenes', 'statuses')), options: [read('workflows'), read('script', 'scenes', 'statuses')] },
  },
  list_speakers: { label: '화자 목록 조회', needs: read('script') },
  create_unit: { label: '대사 추가', needs: [p('script', 'create')] },
  update_unit: { label: '대사 수정', needs: [p('script', 'update')] },
  delete_lines: { label: '대사 삭제', needs: [p('script', 'delete')], batch: ['keys'] },
  create_group: { label: '장면 추가', needs: [p('scenes', 'create')] },
  update_group: { label: '장면 수정', needs: [p('scenes', 'update')] },
  delete_group: { label: '장면 삭제', needs: [p('scenes', 'delete')] },
  propose_translation: { label: '번역 제안 추가', needs: [p('script', 'update')], candidateOnly: true },
  decide_suggestion: { label: 'AI 제안 적용·거절', needs: [p('script', 'update')] },
  propose_changes: { label: '대사 일괄 변경', needs: [p('script', 'update')], batch: ['changes'] },
  set_listeners: { label: '청자 저장', needs: [p('script', 'update')], batch: ['lines'] },
  link_lines: { label: '대사 그래프 잇기', needs: [p('script', 'update')] },
  link_in_order: { label: '대본 순서로 잇기', needs: [p('script', 'update')], batch: ['scenes', 'lines'] },
  // ── knowledge ──
  list_characters: { label: '인물 조회', needs: read('characters', 'relationships') },
  list_relationships: { label: '관계 조회', needs: read('relationships') },
  list_speech_rules: { label: '말투 규칙 조회', needs: read('speechRules') },
  list_events: { label: '사건 조회', needs: read('events') },
  read_documents: { label: '노트 읽기', needs: read('documents') },
  save_character: { label: '인물 저장', needs: upsert('characters') },
  save_relationship: { label: '관계 저장', needs: upsert('relationships') },
  save_speech_rule: { label: '말투 규칙 저장', needs: upsert('speechRules') },
  save_event: { label: '사건 저장', needs: upsert('events') },
  save_document: { label: '노트 저장', needs: upsert('documents') },
  link_events: { label: '사건 잇기', needs: [p('events', 'update')] },
  save_knowledge: {
    label: '자료 일괄 저장',
    needs: {
      of: (input) => unique(KNOWLEDGE_KEYS.flatMap((kind) => rows(input[kind]).map((item) => upsertOf(kind, item)))),
      options: KNOWLEDGE_KEYS.flatMap((kind) => [[p(kind, 'create')], [p(kind, 'update')]]),
    },
    batch: KNOWLEDGE_KEYS,
  },
  delete_items: { label: '항목 삭제', needs: byKind(DELETABLE, 'delete'), batch: ['ids'] },
  // ── glossary ──
  list_terms: { label: '용어집 조회', needs: read('terms', 'script') },
  term_usage: { label: '용어 사용 위치 조회', needs: read('terms', 'script') },
  save_terms: {
    label: '용어 저장',
    needs: { of: (input) => unique(rows(input.terms).map((item) => upsertOf('terms', item))), options: [[p('terms', 'create')], [p('terms', 'update')]] },
    batch: ['terms'],
  },
  discover_terms: { label: '대본에서 용어 후보 찾기', needs: [p('terms', 'create')] },
  // ── statuses and tags ──
  list_statuses: { label: '상태 목록 조회', needs: read('statuses') },
  list_tags: { label: '태그 목록 조회', needs: read('tags') },
  save_status: { label: '상태·태그 만들기', needs: taxonomy('create') },
  update_status: { label: '상태 수정', needs: [p('statuses', 'update')] },
  delete_status: { label: '상태 삭제', needs: [p('statuses', 'delete')], batch: ['ids'] },
  update_tag: { label: '태그 수정', needs: [p('tags', 'update')] },
  delete_tag: { label: '태그 삭제', needs: [p('tags', 'delete')], batch: ['ids'] },
  order_settings: { label: '상태·태그 순서 바꾸기', needs: taxonomy('update') },
  tag_items: { label: '태그 붙이기·떼기', needs: byKind(TAGGABLE, 'update'), batch: ['ids'] },
  // ── workflows and runs ──
  harness_reference: { label: '워크플로 구조 확인', needs: read('workflows', 'statuses', 'tags') },
  read_workflow: { label: '워크플로 읽기', needs: read('workflows') },
  read_run: { label: '실행 기록 읽기', needs: read('workflows') },
  plan_run: { label: '워크플로 실행 계획 조회', needs: read('workflows', 'script', 'characters', 'speechRules', 'terms', 'tags', 'statuses') },
  save_workflow: { label: '워크플로 저장', needs: upsert('workflows') },
  delete_workflow: { label: '워크플로 삭제', needs: [p('workflows', 'delete')] },
  edit_workflow_node: { label: '편집기 노드 수정', needs: [p('workflows', 'update')], via: 'editor' },
  start_run: { label: '워크플로 실행', needs: [p('workflows', 'run')] },
  continue_run: { label: '실행 이어 하기', needs: [p('workflows', 'run')] },
  // ── project and web ──
  read_project_settings: { label: '프로젝트 설정 조회', needs: read('project') },
  update_project_settings: { label: '프로젝트 설정 변경', needs: [p('project', 'update')] },
  read_app_defaults: { label: '홈 기본값 조회', needs: read('project') },
  pull_app_defaults: { label: '홈 기본값 가져오기', needs: [p('project', 'update')] },
  web_search: { label: '웹 검색', needs: read('web') },
  read_web_page: { label: '웹 페이지 읽기', needs: read('web') },
} satisfies Record<string, ToolSpec>;

export type ToolName = keyof typeof TOOL_SPECS;
export const TOOL_NAMES = Object.keys(TOOL_SPECS) as ToolName[];
/** A tool's spec by a name that may not be one (a stored proposal, a model's call). */
export const toolSpec = (name: string): ToolSpec | undefined => (Object.hasOwn(TOOL_SPECS, name) ? (TOOL_SPECS as Record<string, ToolSpec>)[name] : undefined);

/** Every entry point checks actual contents; batch transport is not a separate permission. Null: not a tool, or not a target it takes. */
export function requiredAgentPermissions(name: string, input: Input): AgentPermission[] | null {
  const needs = toolSpec(name)?.needs;
  if (!needs) return null;
  return Array.isArray(needs) ? needs : needs.of(input);
}

/** Alternative valid calls, for discovery: a tool is offered when the settings allow one of them. */
export function agentToolPermissionOptions(name: string): AgentPermission[][] {
  const needs = toolSpec(name)?.needs;
  if (!needs) return [];
  return Array.isArray(needs) ? [needs] : needs.options;
}

/**
 * What kind of thing a call is, from the permissions it needs: deleting anything is a delete, running a
 * workflow a run, only reading a read, the rest a change. It is not written anywhere else.
 */
export type ToolClass = 'read' | 'change' | 'run' | 'delete';
const classOf = (needs: AgentPermission[]): ToolClass =>
  needs.some((need) => need.action === 'delete') ? 'delete' : needs.some((need) => need.action === 'run') ? 'run' : needs.length > 0 && needs.every((need) => need.action === 'read') ? 'read' : 'change';
/** With an input: that call's class. Without (or for a target the tool does not take): the most serious class any call of the tool can have. */
export function toolClass(name: string, input?: Input): ToolClass {
  return classOf((input && requiredAgentPermissions(name, input)) || agentToolPermissionOptions(name).flat());
}

/**
 * How a call of the tool is carried out: `now` runs at once (a read, or a direct write the spec marks),
 * `gate` becomes a proposal the permission mode decides, `editor` is applied by the open workflow editor.
 */
export type ToolRoute = 'now' | 'gate' | 'editor';
export function toolRoute(name: string): ToolRoute {
  const via = toolSpec(name)?.via;
  if (via === 'editor') return 'editor';
  return via === 'direct' || toolClass(name) === 'read' ? 'now' : 'gate';
}

/** How many things a call changes: the lengths of the spec's batch fields, one when it has none. */
export function itemCount(name: string, input: Input): number {
  const fields = toolSpec(name)?.batch;
  if (!fields) return 1;
  return Math.max(1, fields.reduce((sum, field) => sum + (Array.isArray(input[field]) ? (input[field] as unknown[]).length : 0), 0));
}

/** How an accepted change reads: to the agent and the CLI (decided) and on cards (short). */
export function acceptedLabel(name: string): { decided: string; short: string } {
  return toolSpec(name)?.candidateOnly
    ? { decided: '수락되어 AI 제안으로 추가됨 (사람이 적용·거절)', short: '제안으로 추가됨' }
    : { decided: '수락되어 반영됨', short: '적용됨' };
}

type Policy = { permissions?: AgentPermissions };
export function agentToolAvailable(settings: Policy, name: string): boolean {
  const permissions = effectiveAgentPermissions(settings);
  return agentToolPermissionOptions(name).some((option) => option.every(({ resource, action }) => permissions[resource]?.[action] === true));
}
export function agentPermissionError(settings: Policy, name: string, input: Input): string | null {
  const required = requiredAgentPermissions(name, input);
  if (!required) return '허용되지 않은 도구 또는 대상입니다.';
  const permissions = effectiveAgentPermissions(settings);
  const denied = required.filter(({ resource, action }) => permissions[resource]?.[action] !== true);
  return denied.length ? `허용되지 않은 작업입니다: ${denied.map(({ resource, action }) => `${AGENT_RESOURCES[resource].label} ${AGENT_ACTIONS[action]}`).join(', ')}. 에이전트 권한 설정을 확인하세요.` : null;
}
