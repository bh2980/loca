import { FORMAT_CHOICE, FORMAT_JSON_BATCH, FORMAT_JSON_LINE, FORMAT_TEXT, FORMAT_VERDICT_HEAD, INPUT_SCRIPT } from '../apps/server/src/engine/format-sentences.ts';

/**
 * The mock LLM's brain, free of HTTP: (system, user text, options) → response body + usage.
 * `scripts/mock-llm.ts` serves it; `apps/server/src/engine/mock-llm.test.ts` checks every structured
 * answer against the server's zod schemas so the mock cannot drift from them silently.
 */

export interface MockOptions {
  /** Added to prompt_tokens per request (agent CLIs add 13k-29k of their own). */
  fixedTokens: number;
  /** Reported as prompt_tokens_details.cached_tokens (inside prompt_tokens). */
  cachedTokens: number;
  /** Base latency in ms (jitter is added on top). undefined = today's per-kind defaults. */
  latencyMs?: number;
  dropRate: number;
  dupRate: number;
  emptyRate: number;
  badJsonRate: number;
  rate429: number;
  truncateRate: number;
  /** Answers to requests carrying more than this many characters of line text are cut short (0 = off). */
  truncateOverChars: number;
  seed: number;
}

export const DEFAULT_OPTIONS: MockOptions = { fixedTokens: 0, cachedTokens: 0, dropRate: 0, dupRate: 0, emptyRate: 0, badJsonRate: 0, rate429: 0, truncateRate: 0, truncateOverChars: 0, seed: 1 };

export const PROFILES: Record<string, Partial<MockOptions>> = {
  'cli-like': { fixedTokens: 20000, cachedTokens: 10000, latencyMs: 2000 },
  faulty: { dropRate: 0.05, rate429: 0.03, badJsonRate: 0.02, truncateRate: 0.01 },
};

/** Variable names without the MOCK_ prefix; the same names work as `x-mock-<name>` headers (underscores → dashes). */
const NUMBERS: Record<string, keyof MockOptions> = {
  FIXED_TOKENS: 'fixedTokens',
  CACHED_TOKENS: 'cachedTokens',
  LATENCY_MS: 'latencyMs',
  DROP_RATE: 'dropRate',
  DUP_RATE: 'dupRate',
  EMPTY_RATE: 'emptyRate',
  BAD_JSON_RATE: 'badJsonRate',
  '429_RATE': 'rate429',
  TRUNCATE_RATE: 'truncateRate',
  TRUNCATE_OVER_CHARS: 'truncateOverChars',
  SEED: 'seed',
};

/** Layers settings: defaults ← profile(s) ← explicit numbers. `get('FIXED_TOKENS')` returns one raw setting. */
export function resolveOptions(get: (name: string) => string | undefined, base: MockOptions = DEFAULT_OPTIONS): MockOptions {
  const options: MockOptions = { ...base };
  for (const name of (get('PROFILE') ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
    const preset = PROFILES[name];
    if (!preset) throw new Error(`unknown MOCK_PROFILE "${name}" (known: ${Object.keys(PROFILES).join(', ')})`);
    Object.assign(options, preset);
  }
  for (const [name, field] of Object.entries(NUMBERS)) {
    const raw = get(name);
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`MOCK_${name} must be a non-negative number, got "${raw}"`);
    (options as unknown as Record<string, number>)[field] = value;
  }
  return options;
}

export const envGetter = (env: Record<string, string | undefined>) => (name: string) => env[`MOCK_${name}`];
export const headerGetter = (headers: { get(name: string): string | null }) => (name: string) =>
  headers.get(`x-mock-${name.toLowerCase().replaceAll('_', '-')}`) ?? undefined;

/** Small seeded PRNG (mulberry32): same seed, same faults. */
export function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashString = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
};

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details: { cached_tokens: number };
}

/** Token-like usage: ceil(chars / 4) per side, plus the per-request fixed overhead on input. */
export function usageFor(promptChars: number, completionChars: number, options: Pick<MockOptions, 'fixedTokens' | 'cachedTokens'>): Usage {
  const prompt = options.fixedTokens + Math.ceil(promptChars / 4);
  const completion = Math.ceil(completionChars / 4);
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, prompt_tokens_details: { cached_tokens: Math.min(options.cachedTokens, prompt) } };
}

export type MockKind = 'complete' | 'test' | 'regex' | 'text' | 'revise' | 'refine' | 'verdict' | 'choice' | 'json' | 'jsonBatch';

/** Which answer the prompt asks for. The server's FORMAT sentences (engine/format-sentences.ts) name the output form; instructions tell translate from revise. */
export function detectKind(system: string): MockKind {
  if (system.startsWith('Translate the text into')) return 'test';
  if (system.includes('JavaScript 정규식 전문가')) return 'regex';
  if (system.includes('continue a Korean game translation')) return 'complete';
  // AI 다듬기 answers per line as json (text + changes): read before the generic json forms.
  if (system.includes('Do not rephrase what is already correct')) return 'refine';
  if (system.includes(FORMAT_JSON_BATCH)) return 'jsonBatch';
  if (system.includes(FORMAT_JSON_LINE)) return 'json';
  if (system.includes(FORMAT_CHOICE)) return 'choice';
  if (system.includes(FORMAT_VERDICT_HEAD)) return 'verdict';
  return system.includes('Revise each') ? 'revise' : 'text';
}

interface Row {
  id: string;
  source: string;
  speaker?: string;
  candidate?: string;
}

/** Lines of a whole-script request: "L<n> <Speaker>: <text>"; their ids are the script's. */
function scriptRows(user: string): Row[] {
  return [...user.matchAll(/^\s*(L\d+) ([^:[]+?|\[[^\]]+\]): (.*)$/gm)].map((match) => ({ id: match[1], speaker: match[2] === '-' || match[2].startsWith('[') ? undefined : match[2].trim(), source: match[3] }));
}

interface JsonDef {
  type?: string;
  description?: string;
  enum?: unknown[];
  anyOf?: JsonDef[];
  items?: JsonDef;
  properties?: Record<string, JsonDef>;
}
/** Names of people, for fields that look like they hold one. */
const NAME_FIELD = /^(name|from|to|speaker|listener|who|person|character|participants?|scene)/i;

/**
 * Fills a JSON-schema definition with plausible values by type, as a "json" node's fields are only
 * known from the response schema: nested lists get two items, evidence fields cite the request's
 * line ids, enums take their first value.
 */
function fillDef(def: JsonDef, name: string, ctx: { ids: string[]; speakers: string[]; source: number; at: number }): unknown {
  const options = def.anyOf?.filter((option) => option.type !== 'null');
  if (options?.length === 1 && def.anyOf!.length > options.length) return fillDef({ ...options[0], description: def.description ?? options[0].description }, name, ctx);
  if (def.enum?.length) return def.enum[0];
  switch (def.type) {
    case 'number':
    case 'integer': {
      // Bounds are described, not enforced, in the request schema ("Between 0 and 1.", "At most 5."): stay inside them.
      const between = def.description?.match(/Between (-?[\d.]+) and (-?[\d.]+)\./);
      if (between) return Number(between[1]) + (Number(between[2]) - Number(between[1])) * 0.9;
      const most = def.description?.match(/At most (-?[\d.]+)\./);
      const least = def.description?.match(/At least (-?[\d.]+)\./);
      if (most) return Math.min(ctx.source, Number(most[1]));
      if (least) return Math.max(ctx.source, Number(least[1]));
      return ctx.source;
    }
    case 'boolean':
      return ctx.source % 2 === 0;
    case 'array': {
      const item = def.items ?? {};
      if (item.type === 'object') return [0, 1].map((n) => fillObject(item, { ...ctx, at: ctx.at + n }));
      if (item.type === 'string' && /ids of the request's lines/.test(def.description ?? '')) return ctx.ids.slice(0, 2);
      return [fillDef(item, name, ctx)];
    }
    case 'object':
      return fillObject(def, ctx);
    default:
      return NAME_FIELD.test(name) && ctx.speakers.length ? ctx.speakers[ctx.at % ctx.speakers.length] : `모의 ${name}`;
  }
}
const fillObject = (def: JsonDef, ctx: { ids: string[]; speakers: string[]; source: number; at: number }): Record<string, unknown> =>
  Object.fromEntries(Object.entries(def.properties ?? {}).map(([name, property]) => [name, fillDef(property, name, ctx)]));

/** Lines mentioning "orders" never pass review, so they end up waiting for a person. */
const stubborn = (source: string) => /orders/i.test(source);

function structured(kind: Exclude<MockKind, 'test' | 'complete' | 'regex'>, rows: Row[], schema: unknown): { body: unknown; entries?: { key: string; textKey?: string } } {
  const properties = (schema as JsonDef | undefined)?.properties ?? {};
  switch (kind) {
    // The editor's 다듬기: a "[KO] " draft is marked checked (one reasoned change); anything else has nothing to fix.
    case 'refine':
      return {
        body: { results: rows.map((row) => (row.candidate?.startsWith('[KO] ') ? { id: row.id, text: row.candidate.replace('[KO] ', '[KO✓] '), changes: [{ kind: 'language', why: '모의: [KO]를 [KO✓]로' }] } : { id: row.id, text: row.candidate ?? '', changes: [] })) },
        entries: { key: 'results', textKey: 'text' },
      };
    case 'text':
    case 'revise':
      return { body: { results: rows.map((row) => ({ id: row.id, text: kind === 'revise' ? `[KO✓] ${row.source}` : `[KO] ${row.source}` })) }, entries: { key: 'results', textKey: 'text' } };
    case 'verdict':
      return {
        body: {
          results: rows.map((row) => {
            const failed = stubborn(row.source) || (row.source.trim().endsWith('?') && !!row.candidate?.startsWith('[KO]'));
            return { id: row.id, passed: !failed, issues: failed ? [stubborn(row.source) ? '“orders”의 대상(누구의 명령인지)이 번역에서 모호합니다.' : '의문문 어조가 자연스럽지 않습니다.'] : [], categories: failed ? [stubborn(row.source) ? 'meaning' : 'style'] : [] };
          }),
        },
        entries: { key: 'results' },
      };
    case 'choice': {
      // The options are in the schema's enum (or, with none given, any text). The next different speaker is
      // chosen when it is an option (a listener guess), else the first option; the first line is less sure.
      const value = (properties.results as JsonDef | undefined)?.items?.properties?.value;
      const options = ((value?.enum ?? value?.anyOf?.find((option) => option.enum)?.enum ?? []) as string[]).map(String);
      return {
        body: {
          results: rows.map((row, index) => {
            const other = rows.slice(index + 1).find((next) => next.speaker && next.speaker !== row.speaker) ?? rows.slice(0, index).reverse().find((previous) => previous.speaker && previous.speaker !== row.speaker);
            const chosen = other?.speaker && (!options.length || options.includes(other.speaker)) ? other.speaker : (options[0] ?? null);
            return { id: row.id, value: chosen, confidence: 0.9, reason: '모의 선택' };
          }),
        },
        entries: { key: 'results' },
      };
    }
    case 'json': {
      const item = (properties.results as JsonDef | undefined)?.items ?? {};
      const speakers = [...new Set(rows.flatMap((row) => (row.speaker ? [row.speaker] : [])))];
      return { body: { results: rows.map((row, at) => ({ ...fillObject(item, { ids: [row.id], speakers, source: row.source.length, at }), id: row.id })) }, entries: { key: 'results' } };
    }
    case 'jsonBatch': {
      // One object for the whole request; people are the speakers most often heard, evidence the request's first lines.
      const counts = Map.groupBy(rows.filter((row) => row.speaker), (row) => row.speaker!);
      const speakers = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([name]) => name);
      return { body: fillObject(schema as JsonDef, { ids: rows.map((row) => row.id), speakers, source: rows.length, at: 0 }) };
    }
  }
}

export interface MockRequest {
  system: string;
  /** The user message text (the server sends JSON for per-line nodes, a script for whole-script nodes). */
  user: string;
  /** The response_format JSON schema, when known (only used to fill "json" node fields). */
  schema?: unknown;
}

export interface MockOutcome {
  kind: MockKind;
  /** Lines in the request (0 when the answer is not about lines). */
  lines: number;
  status: 200 | 429;
  retryAfterSeconds?: number;
  finishReason: 'stop' | 'length';
  content: string;
  usage: Usage;
  delayMs: number;
  /** What was injected, for tests and logs. */
  faults: string[];
}

const DEFAULT_LATENCY: Record<'script' | 'other', number> = { script: 1500, other: 400 };

/** The whole decision for one structured request. `rand` drives every fault so a seed reproduces a run. */
export function respond(request: MockRequest, options: MockOptions, rand: () => number = makeRand(options.seed)): MockOutcome {
  const kind = detectKind(request.system);
  // A whole-script request carries the script as text (INPUT_SCRIPT explains it) instead of per-line JSON.
  const script = request.system.includes(INPUT_SCRIPT);
  const promptChars = request.system.length + request.user.length;
  const base = options.latencyMs ?? DEFAULT_LATENCY[script ? 'script' : 'other'];
  const delayMs = Math.round(base + rand() * base * 0.25);
  const faults: string[] = [];

  if (rand() < options.rate429) {
    const body = JSON.stringify({ error: { message: 'mock rate limit', type: 'rate_limit_exceeded', code: 'rate_limit_exceeded' } });
    return { kind, lines: 0, status: 429, retryAfterSeconds: 1, finishReason: 'stop', content: body, usage: usageFor(0, 0, { fixedTokens: 0, cachedTokens: 0 }), delayMs: Math.min(delayMs, 50), faults: ['429'] };
  }

  // The editor's continuation is plain text: the whole line, starting with what was typed.
  if (kind === 'complete') {
    const source = /^source: (.*)$/m.exec(request.user)?.[1] ?? '';
    const prefix = /<started>([\s\S]*)<\/started>/.exec(request.user)?.[1] ?? '';
    const text = `${prefix}${prefix ? ' ' : ''}[KO] ${source}. 두 번째 문장도 있어요.`;
    return { kind, lines: 1, status: 200, finishReason: 'stop', content: text, usage: usageFor(promptChars, text.length, options), delayMs, faults };
  }
  let rows: Row[] = [];
  let lines = 0;
  let body: unknown;
  if (kind === 'regex') {
    // 자연어로 정규식 만들기: a placeholder rule for token rules, a forbidden one for checks.
    body = request.user.includes('치환자(placeholder)')
      ? { label: '모의 이중 대괄호 변수', kind: 'placeholder', pattern: String.raw`\[\[[A-Z_]+\]\]`, example: '[[NAME]]' }
      : { label: '모의 영문 대문자 약어', kind: 'forbidden', pattern: String.raw`\b[A-Z]{2,}\b`, example: 'HP NPC' };
    lines = 1;
  } else if (kind === 'test') {
    // A model test (AI 연결 › 모델 시험): one plain sentence, not a JSON batch.
    body = { text: `[KO] ${request.user}` };
    lines = 1;
  } else {
    // The server groups a batch's lines by scene; a whole-script request is the script as text.
    if (script) rows = scriptRows(request.user);
    else {
      const input = JSON.parse(request.user) as { lines?: Row[]; scenes?: { lines: Row[] }[] };
      rows = input.scenes ? input.scenes.flatMap((scene) => scene.lines) : (input.lines ?? []);
    }
    lines = rows.length;
    const result = structured(kind, rows, request.schema);
    body = result.body;
    const list = result.entries && ((body as Record<string, Record<string, unknown>[]>)[result.entries.key] as Record<string, unknown>[]);
    if (list) {
      let kept = list.filter(() => {
        const drop = rand() < options.dropRate;
        if (drop) faults.push('drop');
        return !drop;
      });
      kept = kept.map((entry, index) => {
        if (index > 0 && rand() < options.dupRate) {
          faults.push('dup');
          return { ...entry, id: kept[index - 1].id };
        }
        if (result.entries?.textKey && rand() < options.emptyRate) {
          faults.push('empty');
          return { ...entry, [result.entries.textKey]: '' };
        }
        return entry;
      });
      (body as Record<string, unknown>)[result.entries!.key] = kept;
    }
  }

  let content = JSON.stringify(body);
  let finishReason: 'stop' | 'length' = 'stop';
  // Line text only (the sources the request carries), so a node's request size decides, not the prompt around it.
  const tooMuch = options.truncateOverChars > 0 && rows.reduce((sum, row) => sum + row.source.length, 0) > options.truncateOverChars;
  if (tooMuch || rand() < options.truncateRate) {
    content = content.slice(0, Math.max(1, Math.floor(content.length * 0.6)));
    finishReason = 'length';
    faults.push('truncate');
  } else if (rand() < options.badJsonRate) {
    content = `Here is the result:\n${content.slice(0, Math.max(1, Math.floor(content.length / 2)))} ... }}`;
    faults.push('badJson');
  }
  return { kind, lines, status: 200, finishReason, content, usage: usageFor(promptChars, content.length, options), delayMs, faults };
}
