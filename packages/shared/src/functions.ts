import { z } from 'zod';
import { customFormatRuleSchema, formatPatternError } from './format-check.ts';

/**
 * Function nodes run one function from this registry. Each entry declares its parameters and exits;
 * the server holds the implementation (apps/server/src/engine/functions). Adding a function means
 * adding an entry here and one implementation file there.
 */
export interface Port {
  id: string;
  label: string;
}

export interface FunctionInfo<P extends z.ZodType = z.ZodType> {
  label: string;
  description: string;
  params: P;
  /** Exits can depend on the parameters (e.g. a script declares its own). `error` is always added. */
  ports: (params: z.infer<P>) => Port[];
  /** Runs outside the instant pass (network, sandbox); the runner dispatches it like an AI call. */
  async: boolean;
}

/** A named, typed field of a JSON output (AI "json" output, script data). */
export const jsonFieldSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '영문·숫자·_ 로 된 이름'),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  description: z.string().default(''),
});
export type JsonField = z.infer<typeof jsonFieldSchema>;

const pass: Port[] = [{ id: 'pass', label: '통과' }, { id: 'fail', label: '실패' }];
const out: Port[] = [{ id: 'out', label: '다음' }];

export const formatCheckParams = z.object({
  placeholders: z.boolean().default(true),
  tags: z.boolean().default(true),
  newlines: z.boolean().default(true),
  emptyText: z.boolean().default(true),
  numbers: z.boolean().default(false),
  spaces: z.boolean().default(false),
  particles: z.boolean().default(false),
  particlesPattern: z.string().default(''),
  /** Length limits; 0 = off. */
  maxChars: z.number().int().min(0).default(0),
  maxBytes: z.number().int().min(0).default(0),
  maxLineChars: z.number().int().min(0).default(0),
  maxLines: z.number().int().min(0).default(0),
  /** Translation length ÷ source length; 0 = off. */
  maxLengthRatio: z.number().min(0).default(0),
  /** Comma-separated plain words the translation must not contain. */
  forbiddenWords: z.string().default(''),
  customRules: z
    .array(
      customFormatRuleSchema.extend({
        pattern: z.string().min(1).refine((pattern) => !formatPatternError(pattern), { message: '쓸 수 없는 정규식입니다.' }),
      }),
    )
    .default([]),
});

export const setStatusParams = z.object({
  statusId: z.string().optional(),
  addTagIds: z.array(z.string()).default([]),
  removeTagIds: z.array(z.string()).default([]),
});

export const addTermsParams = z.object({
  /** AI node whose "terms" output to add. Empty = the most recent terms output on the line. */
  fromNodeId: z.string().default(''),
});

export const applyKnowledgeParams = z.object({
  /** AI node whose "knowledge" output to apply. Empty = the most recent one on the line. */
  fromNodeId: z.string().default(''),
});

export const saveAnalysisParams = z.object({
  /** AI node whose "analysis" output to save. Empty = the most recent one on the line. */
  fromNodeId: z.string().default(''),
});

export const setListenerParams = z.object({
  /** AI node whose "listener" (분류·추론) output to record. Empty = the most recent one on the line. */
  fromNodeId: z.string().default(''),
});

export const httpParams = z.object({
  /** Full address, e.g. "https://api.example.com/spell?lang=ko"; "{{unit.key}}"-style values are filled in (URL-encoded). */
  url: z.string().default(''),
  /** An API key (credential) whose header goes with the request; empty for public APIs. */
  connectionId: z.string().default(''),
  method: z.enum(['GET', 'POST']).default('POST'),
  /** JSON body; "{{candidate}}", "{{unit.source}}", "{{outputs.<node>.<field>}}" are replaced per line. */
  body: z.string().default('{\n  "text": "{{candidate}}"\n}'),
  /** Where the answer is in the response, e.g. "result.text". Empty = whole body. */
  resultPath: z.string().default(''),
  /** candidate: the result becomes a new candidate · verdict: a boolean picks pass/fail · data: just store it. */
  mode: z.enum(['candidate', 'verdict', 'data']).default('candidate'),
  timeoutSeconds: z.number().int().min(1).max(300).default(30),
});

export const scriptParams = z.object({
  code: z
    .string()
    .default(
      [
        '// input: { unit, candidate, outputs, visits }',
        '// 반환: { port?: "out" | 선언한 출구, candidate?: string, data?: object, issues?: string[] }',
        'export default function run(input) {',
        '  const text = (input.candidate ?? "").replace(/\\s+$/g, "");',
        '  return { candidate: text, port: "out" };',
        '}',
      ].join('\n'),
    ),
  /** Exits the script may return besides "error". */
  ports: z.array(z.string().trim().min(1)).min(1).default(['out']),
  /** The `data` object the script returns: declared fields are checked and coerced, and offered to conditions as outputs.<node>.<name>. */
  fields: z.array(jsonFieldSchema).default([]),
});

export const FUNCTIONS = {
  formatCheck: {
    label: '형식 검사',
    description: '켠 항목(치환자·서식 태그·줄바꿈·빈 번역·숫자·공백·한국어 조사), 길이 제한(글자·바이트·줄·원문 대비 비율), 금칙어, 사용자 정의 정규식 규칙을 검사합니다. 치환자·태그 문법은 프로젝트 설정의 치환자·태그 문법을 따릅니다.',
    params: formatCheckParams,
    ports: () => pass,
    async: false,
  },
  glossaryCheck: {
    label: '용어 준수 검사',
    description: '원문에 나온 확정 용어의 지정 번역이 후보에 쓰였는지 검사합니다.',
    params: z.object({}),
    ports: () => pass,
    async: false,
  },
  setStatus: {
    label: '상태 변경',
    description: '상태·태그를 바꿉니다. (번역은 노드가 낸 즉시 번역 칸에 들어갑니다.)',
    params: setStatusParams,
    ports: () => out,
    async: false,
  },
  addTerms: {
    label: '용어 후보 추가',
    description: 'AI 노드가 뽑은 용어를 용어집에 추가합니다. 확정할지 후보로 둘지는 AI 결과 반영의 ‘용어’를 따릅니다. 이미 있는 용어(대소문자 무시)는 그대로 두고 빈 번역·메모만 채웁니다. 거절한 용어는 건드리지 않습니다.',
    params: addTermsParams,
    ports: () => out,
    async: false,
  },
  applyKnowledge: {
    label: '자료 반영',
    description: 'AI 노드가 찾은 새 인물·관계 변화·사건·말투 구간을 자료에 넣습니다(출처: AI). 확정할지 후보로 둘지는 AI 결과 반영을 따릅니다. 사람이 정한 자료는 바꾸지 않고, 다르게 보는 내용은 AI 후보로 옆에 남깁니다.',
    params: applyKnowledgeParams,
    ports: () => out,
    async: false,
  },
  saveAnalysis: {
    label: 'AI 결과 반영',
    description: 'AI 노드의 작품 분석(개요·인물·관계·사건·말투 규칙·장면별 청자·용어 중 고른 것)을 자료·용어집·대사 청자에 넣습니다(출처: 작품 분석). 확정할지 후보로 둘지는 AI 결과 반영을 따릅니다. 대본 전체를 읽은 실행이면 지난 분석의 손대지 않은 AI 항목을 새 결과로 바꾸고, 사람이 만들거나 고치거나 확정·버린 항목은 그대로 둡니다.',
    params: saveAnalysisParams,
    ports: () => out,
    async: false,
  },
  setListener: {
    label: '청자 기록',
    description: 'AI 노드가 추정한 청자와 확신도를 대사에 적습니다(출처: AI). 사람이 정한 청자는 바꾸지 않고, 확신도가 낮은 청자는 문맥에서 “미상”으로 다룹니다.',
    params: setListenerParams,
    ports: () => out,
    async: false,
  },
  http: {
    label: 'HTTP 호출',
    description: '외부 API(맞춤법·사전 등)를 주소로 호출하고 결과를 후보·판정·데이터로 받습니다. 키가 필요하면 설정의 API 키를 고릅니다.',
    params: httpParams,
    ports: (params: z.infer<typeof httpParams>) => (params.mode === 'verdict' ? pass : out),
    async: true,
  },
  script: {
    label: '스크립트',
    description: '직접 작성한 JavaScript 함수를 격리된 샌드박스에서 실행합니다(네트워크·파일 접근 없음).',
    params: scriptParams,
    ports: (params: z.infer<typeof scriptParams>) => params.ports.map((id) => ({ id, label: id })),
    async: true,
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, FunctionInfo<any>>;

export type FunctionName = keyof typeof FUNCTIONS;
export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as FunctionName[];
/** Standalone deterministic functions exposed in the workflow node library under '함수 동작'. */
export const PALETTE_FUNCTION_NAMES: FunctionName[] = [
  'setStatus',
  'formatCheck',
  'glossaryCheck',
  'script',
  'http',
];

export function functionPorts(fn: string, params: unknown): Port[] {
  const info = FUNCTIONS[fn as FunctionName] as unknown as FunctionInfo | undefined;
  if (!info) return [{ id: 'error', label: '오류' }];
  const parsed = info.params.safeParse(params ?? {});
  return [...info.ports(parsed.success ? parsed.data : info.params.parse({})), { id: 'error', label: '오류' }];
}
