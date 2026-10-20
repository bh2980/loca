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
  /** The line ends here (as failed): no exits, not even "error". */
  ends?: boolean;
  /** Runs outside the instant pass (network, sandbox); the runner dispatches it like an AI call. */
  async: boolean;
  /** The workflow inputs it is a node of (unset: both). */
  inputs?: readonly Subject[];
}

/**
 * Types a JSON output field can have (AI "json" output, script data). `strings`: a list of texts;
 * `lines`: evidence, the ids of lines in the request (stored as line keys); `list`: a list of
 * objects whose fields are `fields`.
 */
export const JSON_FIELD_TYPES = ['string', 'number', 'boolean', 'strings', 'lines', 'list'] as const;
export type JsonFieldType = (typeof JSON_FIELD_TYPES)[number];
export const JSON_FIELD_TYPE_LABELS: Record<JsonFieldType, string> = { string: '문자열', number: '숫자', boolean: '참/거짓', strings: '문자열 목록', lines: '대사 근거', list: '목록' };
export interface JsonField {
  name: string;
  type: JsonFieldType;
  description: string;
  /** Item fields of a `list`. */
  fields?: JsonField[];
  /** The answer must fill it: a text or list that is not empty. Numbers and true/false are always required. */
  required?: boolean;
  /** Bounds of a `number`. */
  min?: number;
  max?: number;
}
export const jsonFieldSchema: z.ZodType<JsonField> = z.lazy(() =>
  z.object({
    name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '영문·숫자·_ 로 된 이름'),
    type: z.enum(JSON_FIELD_TYPES).default('string'),
    description: z.string().default(''),
    fields: z.array(jsonFieldSchema).optional(),
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
) as z.ZodType<JsonField>;

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

/**
 * 반영 노드: put a node's output into the project. Each one is the workflow form of a chat/CLI
 * write tool and goes through the same service. What they take is declared in APPLY_TARGETS.
 *
 * shape `line`: one value per line (outputs.<from>.<field>). `list`: a list in a batch output, one
 * entry per item (outputs.<from>.<list>[]). `single`: one object in a batch output. Batch outputs are
 * carried by the batch's first line only (`batchLeader`), so they are applied once per batch.
 */
export type ApplyShape = 'line' | 'list' | 'single';
export interface ApplyField {
  name: string;
  label: string;
  type: JsonFieldType;
  required?: boolean;
  /** Item fields of a `list` field (e.g. a relationship's changes); mapped as "<field>.<sub>" or by the same name. */
  fields?: ApplyField[];
}
/** A workflow's input: what its items are (INPUT_TYPES in workflow.ts). */
export type Subject = 'lines' | 'terms';
export interface ApplyTarget {
  label: string;
  description: string;
  shape: ApplyShape;
  fields: ApplyField[];
  /** The chat/CLI tool a proposal is filed as (proposals.tool), and whose service writes it. */
  tool: string;
  /** The workflow inputs it is a node of; a `line` shape writes the item itself, so only its kind. */
  inputs: readonly Subject[];
}
const evidenceField = { name: 'evidence', label: '근거 대사', type: 'lines' } as const satisfies ApplyField;
export const APPLY_TARGETS = {
  saveCandidate: {
    label: '번역 후보 기록',
    description: '대사의 번역 후보로 남기고 번역 칸에 넣습니다. 사람이 저장한 번역은 덮어쓰지 않습니다.',
    shape: 'line',
    fields: [{ name: 'text', label: '번역문', type: 'string', required: true }],
    tool: 'propose_changes',
    inputs: ['lines'],
  },
  setListener: {
    label: '청자 설정',
    description: '대사의 청자를 적습니다(출처: AI). ‘unknown’이면 아무것도 적지 않습니다(청자 미상). 사람이 정했거나 가져온 청자는 바꾸지 않습니다.',
    shape: 'line',
    fields: [
      { name: 'listener', label: '청자', type: 'string', required: true },
      { name: 'confidence', label: '확신도', type: 'number' },
    ],
    tool: 'set_listeners',
    inputs: ['lines'],
  },
  tagLines: {
    label: '태그 붙이기',
    description: '값과 이름이 같은 대사 태그를 붙입니다. 없는 태그는 만들지 않습니다.',
    shape: 'line',
    fields: [{ name: 'tag', label: '태그 이름', type: 'string', required: true }],
    tool: 'propose_changes',
    inputs: ['lines'],
  },
  saveTermEntry: {
    label: '용어 표기 저장',
    description: '이 용어의 한국어 표기와 메모를 적습니다. 기본은 표기가 비어 있을 때만 채우고(사람이 그사이 채웠으면 그대로), 끄면 덮어씁니다.',
    shape: 'line',
    fields: [
      { name: 'target', label: '번역', type: 'string', required: true },
      { name: 'note', label: '메모', type: 'string' },
      { name: 'kind', label: '종류', type: 'string' },
      { name: 'meaning', label: '뜻', type: 'string' },
    ],
    tool: 'save_terms',
    inputs: ['terms'],
  },
  saveTerms: {
    label: '용어 저장',
    description: '용어집에 용어를 넣습니다. 이미 있는 용어(대소문자 무시)는 빈 칸만 채우고, 거절한 용어는 건드리지 않습니다.',
    shape: 'list',
    fields: [
      { name: 'source', label: '원문', type: 'string', required: true },
      { name: 'target', label: '번역', type: 'string' },
      { name: 'kind', label: '종류', type: 'string' },
      { name: 'meaning', label: '뜻', type: 'string' },
      { name: 'note', label: '메모', type: 'string' },
      evidenceField,
    ],
    tool: 'save_terms',
    inputs: ['lines', 'terms'],
  },
  saveCharacters: {
    label: '인물 저장',
    description: '인물을 넣습니다. 사람이 정한 인물은 바꾸지 않고, 이미 있는 인물은 빈 칸만 채웁니다.',
    shape: 'list',
    fields: [
      { name: 'name', label: '이름', type: 'string', required: true },
      { name: 'aliases', label: '별칭', type: 'strings' },
      { name: 'profile', label: '프로필', type: 'string' },
      { name: 'speech', label: '말버릇', type: 'string' },
      { name: 'gender', label: '성별', type: 'string' },
      { name: 'ageBand', label: '나이대', type: 'string' },
      { name: 'role', label: '역할', type: 'string' },
      { name: 'player', label: '플레이어 캐릭터', type: 'boolean' },
      evidenceField,
    ],
    tool: 'save_knowledge',
    inputs: ['lines', 'terms'],
  },
  saveRelationships: {
    label: '관계 저장',
    description: '두 인물의 관계와 그 변화를 넣습니다. 사람이 정한 관계는 바꾸지 않고, 달라진 점은 후보로 남깁니다.',
    shape: 'list',
    fields: [
      { name: 'from', label: '인물', type: 'string', required: true },
      { name: 'to', label: '상대', type: 'string', required: true },
      { name: 'kind', label: '관계', type: 'string', required: true },
      { name: 'description', label: '설명', type: 'string' },
      { name: 'mutual', label: '쌍방', type: 'boolean' },
      {
        name: 'changes',
        label: '변화',
        type: 'list',
        fields: [
          { name: 'at', label: '변화 대사', type: 'lines', required: true },
          { name: 'change', label: '변화', type: 'string', required: true },
          { name: 'cause', label: '원인', type: 'string' },
        ],
      },
      evidenceField,
    ],
    tool: 'save_knowledge',
    inputs: ['lines', 'terms'],
  },
  saveSpeechRules: {
    label: '말투 규칙 저장',
    description: '화자→청자 말투 규칙(등급·호칭)을 넣습니다. 사람이 정한 규칙과 다르면 후보로 남깁니다.',
    shape: 'list',
    fields: [
      { name: 'fromName', label: '화자', type: 'string', required: true },
      { name: 'toName', label: '청자', type: 'string', required: true },
      { name: 'level', label: '말투', type: 'string', required: true },
      { name: 'address', label: '호칭', type: 'string' },
      { name: 'note', label: '메모', type: 'string' },
      { name: 'startKey', label: '시작 대사', type: 'lines' },
      evidenceField,
    ],
    tool: 'save_knowledge',
    inputs: ['lines', 'terms'],
  },
  saveEvents: {
    label: '사건 저장',
    description: '사건(제목·요약·원인·결과·관련 인물)을 넣습니다. 같은 제목의 사건은 넣지 않습니다.',
    shape: 'list',
    fields: [
      { name: 'title', label: '제목', type: 'string', required: true },
      { name: 'summary', label: '요약', type: 'string' },
      { name: 'cause', label: '원인', type: 'string' },
      { name: 'outcome', label: '결과', type: 'string' },
      { name: 'participants', label: '관련 인물', type: 'strings' },
      evidenceField,
    ],
    tool: 'save_knowledge',
    inputs: ['lines', 'terms'],
  },
  saveDocument: {
    label: '문서 저장',
    description: '세계관·줄거리 같은 문서를 넣습니다. 같은 제목의 문서가 있으면 AI가 쓴 것만 내용을 바꿉니다.',
    shape: 'single',
    fields: [
      { name: 'title', label: '제목', type: 'string', required: true },
      { name: 'body', label: '본문', type: 'string', required: true },
      { name: 'kind', label: '종류', type: 'string' },
      evidenceField,
    ],
    tool: 'save_document',
    inputs: ['lines', 'terms'],
  },
} as const satisfies Record<string, ApplyTarget>;
export type ApplyFunctionName = keyof typeof APPLY_TARGETS;
export const APPLY_FUNCTION_NAMES = Object.keys(APPLY_TARGETS) as ApplyFunctionName[];

export const applyParams = z.object({
  /** shape `list`: the list field in that output whose items are applied. */
  list: z.string().default(''),
  /** Target field → source field (inside the list item for `list`, inside the output otherwise). */
  map: z.record(z.string(), z.string()).default({}),
  /** 용어 표기 저장: fill the term's Korean form only while it is empty (a person's is kept). */
  onlyEmpty: z.boolean().default(true),
});
export type ApplyParams = z.infer<typeof applyParams>;

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
    inputs: ['lines'],
  },
  glossaryCheck: {
    label: '용어 검사',
    description: '원문에 나온 확정 용어의 지정 번역이 후보에 쓰였는지 검사합니다.',
    params: z.object({}),
    ports: () => pass,
    async: false,
    inputs: ['lines'],
  },
  setStatus: {
    label: '상태 변경',
    description: '상태·태그를 바꿉니다. (번역은 노드가 낸 즉시 번역 칸에 들어갑니다.)',
    params: setStatusParams,
    ports: () => out,
    async: false,
    inputs: ['lines'],
  },
  setTermStatus: {
    label: '용어 상태 변경',
    description: '이 용어를 후보·확정·거절로 바꿉니다(AI가 정한 것으로 표시). 거절한 용어는 다시 제안되지 않습니다.',
    params: z.object({ status: z.enum(['candidate', 'confirmed', 'rejected']).default('rejected') }),
    ports: () => out,
    async: false,
    inputs: ['terms'],
  },
  ...(Object.fromEntries(
    Object.entries(APPLY_TARGETS).map(([name, target]) => [name, { label: target.label, description: target.description, params: applyParams, ports: () => out, async: false, inputs: target.inputs }]),
  ) as unknown as Record<ApplyFunctionName, FunctionInfo<typeof applyParams>>),
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
  'setTermStatus',
  'formatCheck',
  'glossaryCheck',
  'script',
  'http',
];

/**
 * The editor's group of a function node, which also gives its colour: 반영 writes to the project (the
 * apply targets and the status changes), 함수 reads and judges or computes.
 */
export const functionGroup = (fn: string): 'apply' | 'function' => (fn in APPLY_TARGETS || fn === 'setStatus' || fn === 'setTermStatus' ? 'apply' : 'function');

export function functionPorts(fn: string, params: unknown): Port[] {
  const info = FUNCTIONS[fn as FunctionName] as unknown as FunctionInfo | undefined;
  if (!info) return [{ id: 'error', label: '오류' }];
  const parsed = info.params.safeParse(params ?? {});
  const ports = info.ports(parsed.success ? parsed.data : info.params.parse({}));
  return info.ends ? ports : [...ports, { id: 'error', label: '오류' }];
}

/** Whether a function node can work on a workflow's items. */
/** Whether a function is a node of workflows with this input. */
export const functionTakes = (fn: string, input: Subject) => ((FUNCTIONS[fn as FunctionName] as FunctionInfo | undefined)?.inputs ?? ['lines', 'terms']).includes(input);
