import { z } from 'zod';
import { customFormatRuleSchema, formatPatternError } from './format-check.ts';
import { SUBJECTS, type Subject } from './subject.ts';

/**
 * Function nodes run one function from this registry. An entry is everything about the function that is
 * data: its name and help, its settings, exits and results, where the editor lists it, whether it calls
 * out and what it writes. What is code is keyed by the same names and typed against this registry, so a
 * function missing one does not compile: its implementation (apps/server/src/engine/functions), its
 * checks (FUNCTION_ISSUES in workflow.ts), its config form and its icon (apps/web workflow/node-config).
 */
export interface Port {
  id: string;
  label: string;
}

export interface FunctionInfo<P extends z.ZodType = z.ZodType> {
  label: string;
  description: string;
  /**
   * Its settings as a node stores them. A draft the editor is still typing fits (a rule with no pattern yet, an
   * address not entered); what is not ready to run is said by validateWorkflow, never by this schema.
   */
  params: P;
  /** Exits can depend on the parameters (e.g. a script declares its own). `error` is always added. */
  ports: (params: z.infer<P>) => Port[];
  /** Calls out of the server (network, sandbox): the runner dispatches it like an AI call, with the node's own 동시 처리 수. */
  callsOut: boolean;
  /**
   * The editor's group, which also gives the node its colour: 반영 writes to the project (the apply targets), 함수 reads
   * and judges or computes. The library lists a group's functions in the order they are declared here.
   */
  group: FunctionGroup;
  /** What it writes: the item itself (a line's translation or listener, a term's form), the project's knowledge, or nothing. */
  changes: 'item' | 'project' | null;
  /** The workflow inputs it is a node of (unset: both). */
  inputs?: readonly Subject[];
  /**
   * What it returns for the next steps (their "앞 단계 결과", a save node's fields, condition rows):
   * fixed fields, or "declared" by the node (a script's or an HTTP call's fields). Unset: it passes the line on.
   */
  outputs?: readonly JsonField[] | 'declared';
  /** The line under the node's title, from its settings. Unset: its label (a save node says where it writes, see nodeSummary). */
  summary?: (params: z.infer<P>) => string;
}
export type FunctionGroup = 'function' | 'apply';

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
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Fields read off a sample result (a script's or an HTTP call's test run), for "이 결과로 칸 채우기":
 * each top-level key with the type its value has; a list of objects keeps its items' fields. Names
 * that cannot be field names are left out.
 */
export function fieldsFromSample(sample: unknown): JsonField[] {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return [];
  const typeOf = (value: unknown): Pick<JsonField, 'type' | 'fields'> => {
    if (typeof value === 'number') return { type: 'number' };
    if (typeof value === 'boolean') return { type: 'boolean' };
    if (Array.isArray(value)) return value.every((entry) => typeof entry === 'string') ? { type: 'strings' } : { type: 'list', fields: fieldsFromSample(value.find((entry) => entry && typeof entry === 'object')) };
    return { type: 'string' };
  };
  return Object.entries(sample as Record<string, unknown>)
    .filter(([name]) => FIELD_NAME.test(name))
    .map(([name, value]) => ({ name, description: '', ...typeOf(value) }));
}

/** A field as a node stores it. A name still being typed fits; jsonFieldIssues says when one cannot be used. */
export const jsonFieldSchema: z.ZodType<JsonField> = z.lazy(() =>
  z.object({
    name: z.string().trim(),
    type: z.enum(JSON_FIELD_TYPES).default('string'),
    description: z.string().default(''),
    fields: z.array(jsonFieldSchema).optional(),
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
) as z.ZodType<JsonField>;

/** What keeps declared fields from being used: a name that is empty or not letters, digits and _, or one used twice in the same list. */
export function jsonFieldIssues(fields: readonly JsonField[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (!FIELD_NAME.test(field.name)) issues.push(field.name ? `필드 이름 '${field.name}'은(는) 쓸 수 없습니다. 영문·숫자·_ 로 적고 숫자로 시작하지 마세요.` : '이름이 없는 필드가 있습니다.');
    else if (seen.has(field.name)) issues.push(`필드 이름 '${field.name}'이(가) 두 번 있습니다.`);
    seen.add(field.name);
    issues.push(...jsonFieldIssues(field.fields ?? []));
  }
  return issues;
}

const pass: Port[] = [{ id: 'pass', label: '통과' }, { id: 'fail', label: '실패' }];
/** What a check returns: the text it checked, whether it passed, what it found and the kind of problem it looks for (a 태그 붙이기 node can name its tag after it). */
export const CHECK_OUTPUTS: readonly JsonField[] = [
  { name: 'text', type: 'string', description: '검사한 번역문' },
  { name: 'passed', type: 'boolean', description: '통과했는지' },
  { name: 'issues', type: 'strings', description: '찾은 문제' },
  { name: 'kind', type: 'string', description: '이 검사가 찾는 문제 유형' },
];
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
  /** A rule being typed may have no pattern yet, or one that is not a regex yet: the check skips it and validation asks for it. */
  customRules: z.array(customFormatRuleSchema.extend({ pattern: z.string() })).default([]),
});
export type FormatCheckParams = z.infer<typeof formatCheckParams>;

/** A custom rule that cannot be checked yet, in words: no pattern, or not a regex. */
export const customRuleIssue = (rule: { pattern: string }): string | null => (rule.pattern.trim() ? formatPatternError(rule.pattern) : '패턴을 입력하세요.');

/** The format check's line under its title: the checks that are on. */
function formatCheckSummary(params: FormatCheckParams) {
  const checks = [
    params.placeholders && '자리표시자',
    params.tags && '서식 태그',
    params.newlines && '줄바꿈',
    params.emptyText && '빈 번역',
    params.numbers && '숫자',
    params.spaces && '공백',
    params.particles && '조사',
    (params.maxChars || params.maxBytes || params.maxLineChars || params.maxLines || params.maxLengthRatio) && '길이',
    params.forbiddenWords.split(',').some((word) => word.trim()) && '금지어',
    params.customRules.length > 0 && `규칙 ${params.customRules.length}개`,
  ].filter(Boolean);
  return checks.length ? `검사: ${checks.join('·')}` : '켠 검사 항목 없음 (항상 통과)';
}

/** An address as a card's line: without the scheme, its query left out ("?…" says there is one), cut at `max`. */
function shortAddress(url: string, max = 48) {
  const [, bare = '', rest = ''] = /^(?:https?:\/\/)?([^?#]*)(.*)$/i.exec(url.trim()) ?? [];
  const address = rest.startsWith('?') ? `${bare}?…` : bare;
  return address.length > max ? `${address.slice(0, max - 1)}…` : address;
}

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
  /** Item fields of a `list` field (e.g. a relationship's views and their changes); mapped as "<field>.<sub>" (with the whole path for deeper ones) or by the same name. */
  fields?: ApplyField[];
}
export interface ApplyTarget {
  label: string;
  description: string;
  shape: ApplyShape;
  fields: ApplyField[];
  /** Where it writes, in the words of the screens that show it ("→ 용어집"); per input where the item itself is what it writes. */
  writes: string | Record<Subject, string>;
  /** The chat/CLI tool a proposal is filed as (proposals.tool), and whose service writes it. */
  tool: string;
  /** The workflow inputs it is a node of; a `line` shape writes the item itself, so only its kind. */
  inputs: readonly Subject[];
}
const evidenceField = { name: 'evidence', label: '근거 대사', type: 'lines' } as const satisfies ApplyField;
export const APPLY_TARGETS = {
  saveCandidate: {
    label: '번역 저장',
    description: '이 항목에 번역을 넣습니다: 대사는 번역문(번역 기록에도 남음), 용어는 표기와 메모. 사람이 저장한 번역은 덮어쓰지 않습니다. 대사의 번역문이 바뀌면 옛 번역에 대한 지적이던 문제 유형 태그는 떨어집니다.',
    shape: 'line',
    fields: [
      { name: 'text', label: '번역', type: 'string', required: true },
      { name: 'note', label: '메모', type: 'string' },
    ],
    writes: { lines: '대사 번역', terms: '용어 번역어' },
    tool: 'propose_changes',
    inputs: ['lines', 'terms'],
  },
  setListener: {
    label: '청자 저장',
    description: '대사의 청자를 적습니다(출처: AI). ‘unknown’이면 아무것도 적지 않습니다(청자 미상). 사람이 정했거나 가져온 청자는 바꾸지 않습니다.',
    shape: 'line',
    fields: [
      { name: 'listener', label: '청자', type: 'string', required: true },
      { name: 'confidence', label: '확신도', type: 'number' },
    ],
    writes: '대사 청자',
    tool: 'set_listeners',
    inputs: ['lines'],
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
    writes: '용어집',
    tool: 'save_terms',
    inputs: ['lines', 'terms'],
  },
  saveCharacters: {
    label: '인물 저장',
    description: '인물을 넣습니다. 이미 있는 인물에게는 새 별칭을 더하고 모르던 역할·성별·나이대를 채우며, 새로 알게 된 사실·말버릇을 프로필·말버릇 끝에 줄을 바꿔 덧붙입니다. 이미 쓰인 글은 누가 썼든 고치지 않고, 이미 적힌 사실은 다시 더하지 않습니다.',
    shape: 'list',
    fields: [
      { name: 'name', label: '이름', type: 'string', required: true },
      { name: 'aliases', label: '별칭', type: 'strings' },
      { name: 'newFacts', label: '새로 안 사실', type: 'list', fields: [{ name: 'text', label: '사실', type: 'string', required: true }, evidenceField] },
      { name: 'newSpeech', label: '새로 안 말버릇', type: 'list', fields: [{ name: 'text', label: '말버릇', type: 'string', required: true }, evidenceField] },
      { name: 'gender', label: '성별', type: 'string' },
      { name: 'ageBand', label: '나이대', type: 'string' },
      { name: 'role', label: '역할', type: 'string' },
      { name: 'player', label: '플레이어 캐릭터', type: 'boolean' },
      evidenceField,
    ],
    writes: '인물',
    tool: 'save_knowledge',
    inputs: ['lines', 'terms'],
  },
  saveRelationships: {
    label: '관계 저장',
    description:
      '두 인물의 관계를 방향마다 넣습니다(한 쌍에 한 방향 또는 두 방향). 두 방향의 관계와 변화가 같으면 쌍방 관계 하나로 저장합니다. 이미 있는 관계는 종류·설명을 그대로 두고, 새 변화만 변화 목록 끝에 덧붙입니다(같은 대사의 변화는 건너뜀). ‘확인 못 한 쌍’ 목록을 고르면 그 쌍은 관계 ‘관계 미확인’(후보, 이유는 설명, 확인 권장 표시)으로 넣어 사람이 보게 하고, 관계가 없는 쌍이 이미 있으면 건너뛰며, 저장된 인물이 아닌 사람이 낀 쌍은 넣지 않고 결과에 센 수만 남깁니다. ‘사람이 아님’으로 표시된 쌍은 넣지 않고 센 수만 남깁니다. 나중에 같은 쌍의 진짜 관계가 저장되면 이 ‘관계 미확인’ 후보는 그 관계로 바뀝니다.',
    shape: 'list',
    fields: [
      {
        name: 'views',
        label: '방향별 관계',
        type: 'list',
        required: true,
        fields: [
          { name: 'from', label: '인물', type: 'string', required: true },
          { name: 'to', label: '상대', type: 'string', required: true },
          { name: 'kind', label: '관계', type: 'string', required: true },
          { name: 'description', label: '설명', type: 'string' },
          evidenceField,
          {
            name: 'changes',
            label: '변화',
            type: 'list',
            fields: [
              { name: 'at', label: '변화 대사', type: 'lines', required: true },
              { name: 'kind', label: '바뀐 관계', type: 'string', required: true },
              { name: 'cause', label: '원인', type: 'string' },
            ],
          },
        ],
      },
    ],
    writes: '관계',
    tool: 'save_knowledge',
    inputs: ['lines', 'terms'],
  },
  saveSpeechRules: {
    label: '말투 규칙 저장',
    description: '화자→청자 말투 규칙(등급·호칭)을 넣습니다. 이미 있는 규칙은 그대로 두고, 새 구간이나 새 쌍의 규칙만 넣습니다. 같은 쌍·구간에서 저장된 규칙과 다르면 넣지 않습니다.',
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
    writes: '말투 규칙',
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
    writes: '사건',
    tool: 'save_knowledge',
    inputs: ['lines', 'terms'],
  },
  saveDocument: {
    label: '노트 저장',
    description: '세계관·줄거리 같은 노트를 넣습니다. 같은 제목의 노트가 있으면 AI가 쓴 것만 내용을 바꿉니다.',
    shape: 'single',
    fields: [
      { name: 'title', label: '제목', type: 'string', required: true },
      { name: 'body', label: '본문', type: 'string', required: true },
      { name: 'kind', label: '종류', type: 'string' },
      evidenceField,
    ],
    writes: '노트',
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
  /** 관계 저장 only: the list field of the output whose items are pairs of people with no relationship to write ({ between, reason }); they are saved as pairs to look at, never as relationships. Empty = not used. */
  unresolved: z.string().optional(),
  /** 인물 저장 only: the list field of the output ({ name, reason }) naming speaker labels that are not people: no character is made for them, and a stored character of that name gets 확인 권장 ("인물이 아닐 수 있음"), nothing else changes. Empty = not used. */
  notPeople: z.string().optional(),
});
export type ApplyParams = z.infer<typeof applyParams>;

/** An exit's tag action: put on or take off (exitActionSchema in workflow.ts). */
export const TAG_ACTIONS = { add: '붙이기', remove: '떼기' } as const;
export type TagAction = keyof typeof TAG_ACTIONS;

export const httpParams = z.object({
  /** Full address, e.g. "https://api.example.com/spell?lang=ko"; "{{unit.key}}"-style values are filled in (URL-encoded). */
  url: z.string().default(''),
  /** An API key (credential) whose header goes with the request; empty for public APIs. */
  connectionId: z.string().default(''),
  method: z.enum(['GET', 'POST']).default('POST'),
  /** JSON body; "{{candidate}}", "{{unit.source}}", "{{outputs.<node>.<field>}}" are replaced per line. */
  body: z.string().default('{\n  "text": "{{candidate}}"\n}'),
  /** What it returns: fields like a script's; each is read from the response at its path in `paths` (default: the field's own name). A "text" field becomes the line's working text. */
  fields: z.array(jsonFieldSchema).default([]),
  /** Field name → where it is in the response, e.g. "result.text". */
  paths: z.record(z.string(), z.string()).default({}),
  timeoutSeconds: z.number().int().min(1).max(300).default(30),
});

export const scriptParams = z.object({
  code: z
    .string()
    .default(
      [
        '// input: { unit(용어면 term), candidate(지금 번역), previous(앞 단계 결과), outputs, visits }',
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

/** A function node's concurrency (HTTP and script nodes only): how many of the node's calls a run makes at once. */
export const FUNCTION_CONCURRENCY = { min: 1, max: 8, default: 2 } as const;

export const FUNCTIONS = {
  formatCheck: {
    label: '형식 검사',
    description: '번역 후보를 검사해 통과·실패만 정합니다(태그는 붙이지 않습니다). 켠 항목(치환자·서식 태그·줄바꿈·빈 번역·숫자·공백·한국어 조사), 길이 제한(글자·바이트·줄·원문 대비 비율), 금칙어, 사용자 정의 정규식 규칙을 검사합니다. 치환자·태그 문법은 프로젝트 설정의 치환자·태그 문법을 따릅니다.',
    params: formatCheckParams,
    ports: () => pass,
    callsOut: false,
    group: 'function',
    changes: null,
    inputs: ['lines', 'terms'],
    outputs: CHECK_OUTPUTS,
    summary: formatCheckSummary,
  },
  glossaryCheck: {
    label: '용어 검사',
    description: '원문에 나온 확정 용어의 지정 번역이 후보에 쓰였는지 검사해 통과·실패만 정합니다(태그는 붙이지 않습니다).',
    params: z.object({}),
    ports: () => pass,
    callsOut: false,
    group: 'function',
    changes: null,
    inputs: ['lines', 'terms'],
    outputs: CHECK_OUTPUTS,
  },
  script: {
    label: '스크립트',
    description: '직접 작성한 JavaScript 함수를 격리된 샌드박스에서 실행합니다(네트워크·파일 접근 없음).',
    params: scriptParams,
    ports: (params: z.infer<typeof scriptParams>) => params.ports.map((id) => ({ id, label: id })),
    callsOut: true,
    group: 'function',
    changes: null,
    outputs: 'declared',
    summary: (params: z.infer<typeof scriptParams>) => `출구: ${params.ports.join(', ')}`,
  },
  http: {
    label: 'HTTP 호출',
    description: '외부 API(맞춤법·사전 등)를 주소로 호출하고, 응답에서 고른 값을 선언한 결과 칸으로 돌려줍니다. text 칸은 대사의 지금 번역이 됩니다. 키가 필요하면 설정의 API 키를 고릅니다.',
    params: httpParams,
    ports: () => out,
    callsOut: true,
    group: 'function',
    changes: null,
    outputs: 'declared',
    summary: (params: z.infer<typeof httpParams>) => `${params.method} ${shortAddress(params.url) || '주소 없음'}`,
  },
  // The save nodes, one per apply target: a `line` shape writes the item itself, the others the project's knowledge.
  ...(Object.fromEntries(
    Object.entries(APPLY_TARGETS).map(([name, target]) => [
      name,
      { label: target.label, description: target.description, params: applyParams, ports: () => out, callsOut: false, group: 'apply', changes: target.shape === 'line' ? 'item' : 'project', inputs: target.inputs } satisfies FunctionInfo<typeof applyParams>,
    ]),
  ) as unknown as Record<ApplyFunctionName, FunctionInfo<typeof applyParams>>),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, FunctionInfo<any>>;

export type FunctionName = keyof typeof FUNCTIONS;
export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as FunctionName[];
export const isFunctionName = (name: string): name is FunctionName => Object.hasOwn(FUNCTIONS, name);
/** A function's settings, as its node stores them. */
export type FunctionParams<F extends FunctionName = FunctionName> = z.infer<(typeof FUNCTIONS)[F]['params']>;
/** A function's registry entry read as plain data (its own params type forgotten). */
export const functionInfo = (fn: FunctionName): FunctionInfo => FUNCTIONS[fn] as unknown as FunctionInfo;

/** A function node's config: the function and its own settings. One member per function, so `params` is typed by `fn`. */
export type FunctionConfig<F extends FunctionName = FunctionName> = { [K in F]: { fn: K; params: FunctionParams<K>; concurrency: number } }[F];
type FunctionConfigInput = { [K in FunctionName]: { fn: K; params?: z.input<(typeof FUNCTIONS)[K]['params']>; concurrency?: number } }[FunctionName];
/** Built from FUNCTIONS: a config naming a function that is not there, or carrying settings of the wrong shape, does not parse. */
export const functionConfigSchema = z.discriminatedUnion(
  'fn',
  FUNCTION_NAMES.map((fn) =>
    z.object({
      fn: z.literal(fn),
      params: functionInfo(fn).params.prefault({}),
      concurrency: z.number().int().min(FUNCTION_CONCURRENCY.min).max(FUNCTION_CONCURRENCY.max).default(FUNCTION_CONCURRENCY.default),
    }),
  ) as never,
) as unknown as z.ZodType<FunctionConfig, FunctionConfigInput>;

/** The editor's library: a group's functions, in the order they are declared. */
export const paletteFunctions = (group: FunctionGroup): FunctionName[] => FUNCTION_NAMES.filter((fn) => FUNCTIONS[fn].group === group);

/** A function node's exits: its own for its settings, then 오류. */
export function functionPorts(config: FunctionConfig): Port[] {
  return [...(functionInfo(config.fn).ports as (params: FunctionParams) => Port[])(config.params), { id: 'error', label: '오류' }];
}

/** Whether a function is a node of workflows with this input. */
export const functionTakes = (fn: FunctionName, input: Subject) => (functionInfo(fn).inputs ?? SUBJECTS).includes(input);
