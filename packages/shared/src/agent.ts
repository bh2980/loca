import { z } from 'zod';

/**
 * The project agent's tools, as the settings page lists them: what each acts on (target) and how far
 * it goes (action). The same switches apply to the chat panel (API or pi) and to the terminal
 * (loca tools / loca call).
 */
export const AGENT_TOOL_TARGETS = {
  script: '대본·번역',
  knowledge: '자료(인물·관계·말투·사건·문서)',
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
  change: { label: '변경', description: '만들거나 고칩니다. 대화의 권한 모드에 따라 카드로 묻거나(수락/거절) 바로 반영합니다(자동 검토·우회).' },
  run: { label: '실행', description: '워크플로 실행을 제안합니다. 수락하면 시작되고 AI 비용이 듭니다.' },
  delete: { label: '삭제', description: '항목을 지우거나 합칩니다. 자동 검토 모드에서도 항상 묻습니다.' },
} as const;
export type AgentToolAction = keyof typeof AGENT_TOOL_ACTIONS;

const tool = (target: AgentToolTarget, action: AgentToolAction, label: string) => ({ target, action, label });
export const AGENT_TOOLS: Record<string, { target: AgentToolTarget; action: AgentToolAction; label: string }> = {
  project_overview: tool('script', 'read', '프로젝트 개요 조회'),
  list_scenes: tool('script', 'read', '장면 목록 조회'),
  read_scene: tool('script', 'read', '장면 읽기'),
  read_line: tool('script', 'read', '대사 읽기'),
  find_lines: tool('script', 'read', '대사 찾기'),
  scenes_with: tool('script', 'read', '같이 나오는 장면 찾기'),
  line_context: tool('script', 'read', '대사 앞뒤·분기 보기'),
  show_graph: tool('script', 'read', '그래프에서 보여 주기'),
  check_script: tool('script', 'read', '번역 점검'),
  script_stats: tool('script', 'read', '진행·실행 통계'),
  list_speakers: tool('script', 'read', '화자 목록 조회'),
  propose_translation: tool('script', 'change', '번역 후보 추가'),
  propose_changes: tool('script', 'change', '여러 대사 한꺼번에 변경'),
  save_group_summary: tool('script', 'change', '장면 요약 저장'),
  list_characters: tool('knowledge', 'read', '인물 조회'),
  list_speech_rules: tool('knowledge', 'read', '말투 규칙 조회'),
  list_events: tool('knowledge', 'read', '사건 조회'),
  read_documents: tool('knowledge', 'read', '참조 문서 읽기'),
  save_character: tool('knowledge', 'change', '인물 저장'),
  save_relationship: tool('knowledge', 'change', '관계 저장'),
  save_speech_rule: tool('knowledge', 'change', '말투 규칙 저장'),
  save_event: tool('knowledge', 'change', '사건 저장'),
  save_document: tool('knowledge', 'change', '참조 문서 저장'),
  save_knowledge: tool('knowledge', 'change', '설정 자료 한꺼번에 저장'),
  delete_items: tool('items', 'delete', '항목 삭제'),
  list_terms: tool('terms', 'read', '용어집 조회'),
  save_terms: tool('terms', 'change', '용어 저장'),
  harness_reference: tool('workflows', 'read', '워크플로 구조 확인'),
  read_workflow: tool('workflows', 'read', '워크플로 읽기'),
  read_run: tool('workflows', 'read', '실행 기록 읽기'),
  save_workflow: tool('workflows', 'change', '워크플로 저장'),
  edit_workflow_node: tool('workflows', 'change', '열린 편집기의 노드 수정'),
  start_run: tool('workflows', 'run', '워크플로 실행'),
  save_status: tool('settings', 'change', '상태·태그 만들기'),
  tag_items: tool('settings', 'change', '용어·자료에 태그 붙이기·떼기'),
  read_project_settings: tool('project', 'read', '프로젝트 설정 조회'),
  update_project_settings: tool('project', 'change', '프로젝트 설정 변경'),
  web_search: tool('web', 'read', '웹 검색'),
  read_web_page: tool('web', 'read', '웹 페이지 읽기'),
};

/**
 * How a conversation's changes are decided (#45). Every change becomes a proposal row either way, so
 * the agent hears the result the same way and the change log is one.
 */
export const PERMISSION_MODES = ['ask', 'auto', 'bypass'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PERMISSION_MODE_INFO: Record<PermissionMode, { label: string; description: string }> = {
  ask: { label: '수락/거절', description: '변경마다 카드에서 수락하거나 거절합니다.' },
  auto: { label: '자동 검토', description: '검사를 통과한 작은 변경은 바로 반영하고, 큰 일괄 변경·삭제·실행(비용)·경고가 있는 변경만 묻습니다.' },
  bypass: { label: '우회', description: '묻지 않고 모두 바로 반영합니다. 변경 기록은 남습니다.' },
};

export const agentSettingsSchema = z.object({
  /** Tool names switched off for this project's agent (chat and CLI). */
  disabledTools: z.array(z.string()).default([]),
  /** The permission mode a new conversation starts in. */
  defaultPermissionMode: z.enum(PERMISSION_MODES).default('ask'),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/** pi's own coding tools; off unless switched on, since they act on this computer's files. */
export const PI_BUILTIN_TOOLS = {
  read: '파일 읽기',
  grep: '파일 내용 검색',
  find: '파일 찾기',
  ls: '폴더 보기',
  edit: '파일 고치기',
  write: '파일 쓰기',
  bash: '쉘 명령 실행',
} as const;
export type PiBuiltinTool = keyof typeof PI_BUILTIN_TOOLS;

/**
 * What a pi connection loads besides the workbench tools. pi users usually have their own harness
 * (web access, routers, guardrails…), so packages/extensions load by default and each can be
 * switched off; anything that touches local files or adds instructions is opt-in.
 */
export const piOptionsSchema = z.object({
  extensions: z.boolean().default(true),
  /** Extension paths switched off individually. */
  disabledExtensions: z.array(z.string()).default([]),
  builtinTools: z.array(z.enum(Object.keys(PI_BUILTIN_TOOLS) as [PiBuiltinTool, ...PiBuiltinTool[]])).default([]),
  skills: z.boolean().default(false),
  promptTemplates: z.boolean().default(false),
  /** AGENTS.md / CLAUDE.md files found from the working folder. */
  contextFiles: z.boolean().default(false),
  /** Working folder for pi's file tools and context files; empty = a temporary folder. */
  cwd: z.string().default(''),
});
export type PiOptions = z.infer<typeof piOptionsSchema>;

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
