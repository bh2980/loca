import { z } from 'zod';

/**
 * The project agent's tools, as the settings page lists them. The same switches apply to the
 * in-app chat (API or pi) and to the CLI.
 */
export const AGENT_TOOL_GROUPS = {
  read: { label: '읽기', description: '대본·장면·대사·인물·말투 규칙·사건·용어·문서·워크플로·실행 기록을 읽습니다.' },
  change: { label: '변경 제안', description: '인물·관계·말투 규칙·사건·문서·용어·번역 후보·장면 요약·상태·프로필·워크플로를 만들거나 고칩니다. 항상 수락 카드를 거칩니다.' },
  run: { label: '워크플로 실행', description: '워크플로 실행을 제안합니다. 수락하면 시작되고 AI 비용이 듭니다.' },
  web: { label: '웹 검색', description: '인터넷을 검색하고 페이지를 읽습니다(기본: 키 없는 Exa).' },
  editor: { label: '편집기 연동', description: '열려 있는 워크플로 편집기의 노드를 고칩니다(API 채팅만).' },
} as const;
export type AgentToolGroup = keyof typeof AGENT_TOOL_GROUPS;

export const AGENT_TOOLS: Record<string, { group: AgentToolGroup; label: string }> = {
  project_overview: { group: 'read', label: '프로젝트 개요 조회' },
  list_scenes: { group: 'read', label: '장면 목록 조회' },
  read_scene: { group: 'read', label: '장면 읽기' },
  read_line: { group: 'read', label: '대사 읽기' },
  find_lines: { group: 'read', label: '대사 찾기' },
  scenes_with: { group: 'read', label: '같이 나오는 장면 찾기' },
  line_context: { group: 'read', label: '대사 앞뒤·분기 보기' },
  show_graph: { group: 'read', label: '그래프에서 보여 주기' },
  check_script: { group: 'read', label: '번역 점검' },
  script_stats: { group: 'read', label: '진행·실행 통계' },
  list_speakers: { group: 'read', label: '화자 목록 조회' },
  list_characters: { group: 'read', label: '인물 조회' },
  list_speech_rules: { group: 'read', label: '말투 규칙 조회' },
  list_events: { group: 'read', label: '사건 조회' },
  read_documents: { group: 'read', label: '참조 문서 읽기' },
  list_terms: { group: 'read', label: '용어집 조회' },
  harness_reference: { group: 'read', label: '워크플로 구조 확인' },
  read_workflow: { group: 'read', label: '워크플로 읽기' },
  read_run: { group: 'read', label: '실행 기록 읽기' },
  save_character: { group: 'change', label: '인물 저장' },
  save_relationship: { group: 'change', label: '관계 저장' },
  save_speech_rule: { group: 'change', label: '말투 규칙 저장' },
  save_event: { group: 'change', label: '사건 저장' },
  save_document: { group: 'change', label: '참조 문서 저장' },
  save_terms: { group: 'change', label: '용어 저장' },
  propose_translation: { group: 'change', label: '번역 후보 추가' },
  propose_changes: { group: 'change', label: '여러 대사 한꺼번에 변경' },
  save_group_summary: { group: 'change', label: '장면 요약 저장' },
  save_status: { group: 'change', label: '상태·태그 만들기' },
  save_workflow: { group: 'change', label: '워크플로 저장' },
  start_run: { group: 'run', label: '워크플로 실행' },
  web_search: { group: 'web', label: '웹 검색' },
  read_web_page: { group: 'web', label: '웹 페이지 읽기' },
  edit_workflow_node: { group: 'editor', label: '워크플로 노드 수정' },
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
