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
  web: '웹',
} as const;
export type AgentToolTarget = keyof typeof AGENT_TOOL_TARGETS;
export const AGENT_TOOL_ACTIONS = {
  read: { label: '읽기', description: '읽기만 합니다.' },
  change: { label: '변경 제안', description: '만들거나 고치자는 제안. 항상 수락·거절 카드를 거칩니다(편집기 연동은 열린 편집기에 넣고 저장은 사람이).' },
  run: { label: '실행', description: '워크플로 실행을 제안합니다. 수락하면 시작되고 AI 비용이 듭니다.' },
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
  list_terms: tool('terms', 'read', '용어집 조회'),
  save_terms: tool('terms', 'change', '용어 저장'),
  harness_reference: tool('workflows', 'read', '워크플로 구조 확인'),
  read_workflow: tool('workflows', 'read', '워크플로 읽기'),
  read_run: tool('workflows', 'read', '실행 기록 읽기'),
  save_workflow: tool('workflows', 'change', '워크플로 저장'),
  edit_workflow_node: tool('workflows', 'change', '열린 편집기의 노드 수정'),
  start_run: tool('workflows', 'run', '워크플로 실행'),
  save_status: tool('settings', 'change', '상태·태그 만들기'),
  web_search: tool('web', 'read', '웹 검색'),
  read_web_page: tool('web', 'read', '웹 페이지 읽기'),
};

export const agentSettingsSchema = z.object({
  /** Tool names switched off for this project's agent (chat and CLI). */
  disabledTools: z.array(z.string()).default([]),
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
