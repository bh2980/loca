import { z } from 'zod';
import { agentPermissionsSchema } from './agent-permissions.ts';
import { modelChoiceSchema } from './model-choice.ts';

/** Tool display labels and proposal risk classes. Resource/action authorization lives in
 * agent-permissions.ts; these labels are not permission switches. */
export const AGENT_TOOL_TARGETS = {
  script: '대사',
  scenes: '장면',
  knowledge: '자료',
  terms: '용어집',
  workflows: '워크플로',
  settings: '상태·태그',
  /** Deleting rows of any kind (#45): its own group, so switching it off does not touch saving. */
  items: '항목 삭제(자료·용어·태그)',
  project: '프로젝트 설정',
  web: '웹',
} as const;
export type AgentToolTarget = keyof typeof AGENT_TOOL_TARGETS;
export const AGENT_TOOL_ACTIONS = {
  read: { label: '읽기', description: '읽기만 합니다.' },
  change: { label: '변경', description: '만들거나 고칩니다. 대화의 권한 모드에 따라 카드로 묻거나(수락/거절) 바로 반영합니다(자동 검토·바로 반영).' },
  run: { label: '실행', description: '워크플로 실행을 제안합니다. 수락하면 시작되고 AI 비용이 듭니다.' },
  delete: { label: '삭제', description: '항목을 지우거나 합칩니다. 자동 검토 모드에서도 항상 묻습니다.' },
} as const;
export type AgentToolAction = keyof typeof AGENT_TOOL_ACTIONS;

const tool = (target: AgentToolTarget, action: AgentToolAction, label: string) => ({ target, action, label });
export const AGENT_TOOLS: Record<string, { target: AgentToolTarget; action: AgentToolAction; label: string }> = {
  project_overview: tool('script', 'read', '프로젝트 개요 조회'),
  list_scenes: tool('scenes', 'read', '장면 목록 조회'),
  read_scene: tool('scenes', 'read', '장면 읽기'),
  read_line: tool('script', 'read', '대사 읽기'),
  find_lines: tool('script', 'read', '대사 찾기'),
  scenes_with: tool('script', 'read', '같이 나오는 장면 찾기'),
  line_context: tool('script', 'read', '대사 앞뒤·분기 보기'),
  find_reading_route: tool('script', 'read', '경로 대본 찾기'),
  show_graph: tool('script', 'read', '그래프에서 보여 주기'),
  check_script: tool('script', 'read', '번역 점검'),
  script_stats: tool('script', 'read', '진행·실행 통계'),
  list_speakers: tool('script', 'read', '화자 목록 조회'),
  create_unit: tool('script', 'change', '대사 추가'),
  update_unit: tool('script', 'change', '대사 수정'),
  delete_units: tool('script', 'delete', '대사 삭제'),
  create_group: tool('scenes', 'change', '장면 추가'),
  update_group: tool('scenes', 'change', '장면 수정'),
  delete_group: tool('scenes', 'delete', '장면 삭제'),
  propose_translation: tool('script', 'change', '번역 후보 추가'),
  propose_changes: tool('script', 'change', '대사 일괄 변경'),
  set_listeners: tool('script', 'change', '청자 저장'),
  save_group_summary: tool('scenes', 'change', '장면 요약 저장'),
  list_characters: tool('knowledge', 'read', '인물 조회'),
  list_speech_rules: tool('knowledge', 'read', '말투 규칙 조회'),
  list_events: tool('knowledge', 'read', '사건 조회'),
  read_documents: tool('knowledge', 'read', '노트 읽기'),
  save_character: tool('knowledge', 'change', '인물 저장'),
  save_relationship: tool('knowledge', 'change', '관계 저장'),
  save_speech_rule: tool('knowledge', 'change', '말투 규칙 저장'),
  save_event: tool('knowledge', 'change', '사건 저장'),
  link_events: tool('knowledge', 'change', '사건 잇기'),
  link_lines: tool('script', 'change', '대사 그래프 잇기'),
  link_scenes: tool('script', 'change', '장면 잇기'),
  link_in_order: tool('script', 'change', '대본 순서로 잇기'),
  add_line_after: tool('script', 'change', '대사 넣기'),
  delete_lines: tool('script', 'change', '대사 지우기'),
  save_document: tool('knowledge', 'change', '노트 저장'),
  save_knowledge: tool('knowledge', 'change', '자료 일괄 저장'),
  delete_items: tool('items', 'delete', '항목 삭제'),
  list_relationships: tool('knowledge', 'read', '관계 조회'),
  list_statuses: tool('settings', 'read', '상태 목록 조회'),
  list_tags: tool('settings', 'read', '태그 목록 조회'),
  term_usage: tool('terms', 'read', '용어 사용 위치 조회'),
  plan_run: tool('workflows', 'read', '워크플로 실행 계획 조회'),
  list_terms: tool('terms', 'read', '용어집 조회'),
  save_terms: tool('terms', 'change', '용어 저장'),
  harness_reference: tool('workflows', 'read', '워크플로 구조 확인'),
  read_workflow: tool('workflows', 'read', '워크플로 읽기'),
  read_run: tool('workflows', 'read', '실행 기록 읽기'),
  save_workflow: tool('workflows', 'change', '워크플로 저장'),
  delete_workflow: tool('workflows', 'delete', '워크플로 삭제'),
  edit_workflow_node: tool('workflows', 'change', '편집기 노드 수정'),
  start_run: tool('workflows', 'run', '워크플로 실행'),
  save_status: tool('settings', 'change', '상태·태그 만들기'),
  update_status: tool('settings', 'change', '상태 수정'),
  delete_status: tool('settings', 'delete', '상태 삭제'),
  update_tag: tool('settings', 'change', '태그 수정'),
  delete_tag: tool('settings', 'delete', '태그 삭제'),
  tag_items: tool('settings', 'change', '태그 붙이기·떼기'),
  read_project_settings: tool('project', 'read', '프로젝트 설정 조회'),
  update_project_settings: tool('project', 'change', '프로젝트 설정 변경'),
  read_app_defaults: tool('project', 'read', '홈 기본값 조회'),
  pull_app_defaults: tool('project', 'change', '홈 기본값 가져오기'),
  web_search: tool('web', 'read', '웹 검색'),
  read_web_page: tool('web', 'read', '웹 페이지 읽기'),
};

/** Tools that add candidates without changing the current translation. */
export const CANDIDATE_ONLY_TOOLS = new Set(['propose_translation']);

/** How an accepted change reads: to the agent and the CLI (decided) and on cards (short). */
export function acceptedLabel(toolName: string): { decided: string; short: string } {
  return CANDIDATE_ONLY_TOOLS.has(toolName)
    ? { decided: '수락되어 후보로 추가됨', short: '후보로 추가됨' }
    : { decided: '수락되어 반영됨', short: '적용됨' };
}

/**
 * How a conversation's changes are decided (#45). Every change becomes a proposal row either way, so
 * the agent hears the result the same way and the change log is one.
 */
export const PERMISSION_MODES = ['ask', 'auto', 'bypass'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PERMISSION_MODE_INFO: Record<PermissionMode, { label: string; description: string }> = {
  ask: { label: '수락/거절', description: '변경마다 카드에서 수락하거나 거절합니다.' },
  auto: { label: '자동 검토', description: '검사를 통과한 작은 변경은 바로 반영하고, 큰 일괄 변경·삭제·실행(비용)·경고가 있는 변경만 묻습니다.' },
  bypass: { label: '바로 반영', description: '허용한 작업을 확인 없이 반영합니다. 변경 기록은 남고 되돌릴 수 있습니다.' },
};

/** 저장한 지시: a prompt kept per project and called from the chat box's / list (it fills the box, the person sends it; a `{대상}` in it opens the @ picker there). */
export const savedPromptSchema = z.object({
  /** What follows the slash: no spaces, no leading slash. Korean is fine. */
  name: z
    .string()
    .trim()
    .min(1, '이름을 입력하세요.')
    .max(30, '이름은 30자까지입니다.')
    .regex(/^[^\s/]+$/u, '이름에는 공백과 /를 쓸 수 없습니다.'),
  text: z.string().trim().min(1, '지시 내용을 입력하세요.').max(8000, '지시는 8,000자까지입니다.'),
});
export type SavedPrompt = z.infer<typeof savedPromptSchema>;
export const savedPromptsSchema = z.array(savedPromptSchema).max(100).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((prompt, index) => {
    const key = prompt.name.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'name'], message: `이름이 겹칩니다: ${prompt.name}` });
    seen.add(key);
  });
});

export const agentSettingsSchema = z.object({
  /** Tool names switched off for this project's agent (chat and CLI). */
  disabledTools: z.array(z.string()).default([]),
  /** Per-resource operations; old tool switches are conservatively interpreted until saved. */
  permissions: agentPermissionsSchema.optional(),
  /** The model a new conversation talks to; unset, it takes the one the latest conversation picked. */
  chatModel: modelChoiceSchema.nullable().default(null),
  /** The permission mode a new conversation starts in. */
  defaultPermissionMode: z.enum(PERMISSION_MODES).default('ask'),
  /** 저장한 지시: /name in the chat box inserts the text. */
  prompts: savedPromptsSchema.default([]),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/**
 * A conversation's name from its first message, without a model call: the first sentence, the
 * request ending and filler words dropped ("지금 진행 상황을 요약해줘" → "진행 상황 요약"), so the
 * title names the topic instead of repeating the message shown right below it. At most 24 characters.
 */
export function chatTitle(text: string): string {
  const first = text.replace(/\s+/g, ' ').trim().split(/(?<=[.?!。？！])\s|\n/)[0] ?? '';
  let title = first.replace(/[.?!。？！~…]+$/u, '').trim();
  title = title.replace(/^(지금|좀|혹시|그럼|이제|그리고|음|저기|please|can you|could you)\s+/iu, '');
  title = title
    .replace(/\s*(해\s?줘|해\s?주세요|해\s?줄래|해\s?줄\s?수\s?있어|해\s?봐|해\s?볼래|하자|할래|해라|해요|줘|주세요|줄래|부탁해|부탁드려요)$/u, '')
    .replace(/(을|를)$/u, '')
    .trim();
  // "요약" left after dropping "해줘" from "요약해줘"; an object particle before it reads better without.
  title = title.replace(/(\S+)(을|를) (\S+)$/u, '$1 $3');
  if (!title) title = first.trim() || '새 대화';
  return title.length > 24 ? `${title.slice(0, 23).trimEnd()}…` : title;
}
