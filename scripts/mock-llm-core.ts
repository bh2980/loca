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
  seed: number;
}

export const DEFAULT_OPTIONS: MockOptions = { fixedTokens: 0, cachedTokens: 0, dropRate: 0, dupRate: 0, emptyRate: 0, badJsonRate: 0, rate429: 0, truncateRate: 0, seed: 1 };

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

export type MockKind = 'analysis' | 'complete' | 'test' | 'candidate' | 'revise' | 'refine' | 'verdict' | 'terms' | 'glossary' | 'listener' | 'knowledge' | 'json';

/** Which answer the prompt asks for. The server's CONTRACT sentence names the output; instructions tell translate from revise. */
export function detectKind(system: string): MockKind {
  if (system.includes('complete script of a game') || system.includes('reading the script of a game')) return 'analysis';
  if (system.startsWith('Translate the text into')) return 'test';
  if (system.includes('continue a Korean game translation')) return 'complete';
  if (system.includes('Korean localization glossary')) return 'glossary';
  if (system.includes('"relationships" (with "change"')) return 'knowledge';
  if (system.includes('in "listeners"')) return 'listener';
  if (system.includes('in "terms"')) return 'terms';
  if (system.includes('in "results": passed')) return 'verdict';
  if (system.includes('with the requested fields')) return 'json';
  if (system.includes('Do not rephrase what is already correct')) return 'refine';
  return system.includes('Revise each') ? 'revise' : 'candidate';
}

interface Row {
  id: string;
  source: string;
  speaker?: string;
  candidate?: string;
}

/** Lines of a work-analysis script: "L<n> <Speaker>: <text>". */
function analysis(user: string) {
  const lines = [...user.matchAll(/^\s*(L\d+) ([^:[]+?): /gm)].map((match) => ({ id: match[1], speaker: match[2].trim() })).filter((line) => line.speaker !== '-');
  const counts = Map.groupBy(lines, (line) => line.speaker);
  const cast = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const pairs = new Map<string, { from: string; to: string; evidence: string[] }>();
  lines.forEach((line, index) => {
    const next = lines.slice(index + 1).find((other) => other.speaker !== line.speaker);
    if (!next || !cast.some(([name]) => name === line.speaker) || !cast.some(([name]) => name === next.speaker)) return;
    const key = `${line.speaker}|${next.speaker}`;
    const pair = pairs.get(key) ?? { from: line.speaker, to: next.speaker, evidence: [] };
    if (pair.evidence.length < 3) pair.evidence.push(line.id);
    pairs.set(key, pair);
  });
  const levels = ['hae', 'haeyo', 'hasipsio', 'haera'] as const;
  const list = [...pairs.values()];
  return {
    count: lines.length,
    body: {
      overview: { setting: '모의 분석: 대본에 나온 장소', mainConflict: '모의 갈등', plot: `모의 줄거리 (대사 ${lines.length}줄을 읽음)`, evidence: lines.slice(0, 3).map((line) => line.id) },
      characters: cast.map(([name, rows], index) => ({ name, aliases: [], profile: `대사 ${rows.length}줄`, speech: '모의 말투 설명', player: index === cast.length - 1, evidence: rows.slice(0, 3).map((row) => row.id) })),
      relationships: list.slice(0, 6).map((pair, index) => ({
        from: pair.from,
        to: pair.to,
        kind: '아는 사이',
        description: '모의 관계',
        changes: index === 0 ? [{ at: pair.evidence[0], change: '모의 변화', cause: '모의 원인' }] : [],
        evidence: pair.evidence,
      })),
      events: [{ title: '모의 사건', summary: '처음 장면의 일', cause: '', outcome: '', participants: cast.slice(0, 2).map(([name]) => name), evidence: lines.slice(0, 2).map((line) => line.id) }],
      speechRules: list.map((pair, index) => ({ from: pair.from, to: pair.to, level: levels[index % 4], address: '', note: '모의 규칙', start: null, evidence: pair.evidence })),
      // The speakers as terms, so a mock analysis fills the glossary like a real one.
      terms: cast.map(([name, rows]) => ({ source: name, kind: 'person', meaning: '모의 용어 설명', target: `[KO] ${name}`, evidence: rows.slice(0, 2).map((row) => row.id) })),
    },
  };
}

/** For a "json" node the field names are only in the response schema, so fill each property by its type. */
function jsonRows(rows: Row[], schema: unknown) {
  const properties = (schema as { properties?: { results?: { items?: { properties?: Record<string, { type?: string }> } } } } | undefined)?.properties?.results?.items?.properties ?? {};
  return rows.map((row) => ({
    id: row.id,
    ...Object.fromEntries(
      Object.entries(properties)
        .filter(([name]) => name !== 'id')
        .map(([name, def]) => [name, def.type === 'number' ? row.source.length : def.type === 'boolean' ? row.source.length % 2 === 0 : `모의 ${name}`]),
    ),
  }));
}

/** Lines mentioning "orders" never pass review, so they end up waiting for a person. */
const stubborn = (source: string) => /orders/i.test(source);

function structured(kind: Exclude<MockKind, 'analysis' | 'glossary' | 'test' | 'complete'>, system: string, rows: Row[], schema: unknown): { body: unknown; entries?: { key: string; textKey?: string } } {
  switch (kind) {
    // The editor's 다듬기: a "[KO] " draft is marked checked (one reasoned change); anything else has nothing to fix.
    case 'refine':
      return {
        body: { translations: rows.map((row) => (row.candidate?.startsWith('[KO] ') ? { id: row.id, text: row.candidate.replace('[KO] ', '[KO✓] '), changes: [{ kind: 'language', why: '모의: [KO]를 [KO✓]로' }] } : { id: row.id, text: row.candidate ?? '', changes: [] })) },
        entries: { key: 'translations', textKey: 'text' },
      };
    case 'candidate':
    case 'revise':
      return { body: { translations: rows.map((row) => ({ id: row.id, text: kind === 'revise' ? `[KO✓] ${row.source}` : `[KO] ${row.source}` })) }, entries: { key: 'translations', textKey: 'text' } };
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
    case 'terms': {
      // Capitalised words that are not sentence starts stand in for proper nouns.
      const words = new Set(rows.flatMap((row) => [...row.source.matchAll(/(?<=\s)([A-Z][a-z]{3,})/g)].map((match) => match[1])));
      return { body: { terms: [...words].map((source) => ({ source, target: `[${source}]`, note: '모의 추출' })) } };
    }
    case 'listener':
      // The listener is the next different speaker in the batch (else the previous one); the first line of a batch is unsure.
      return {
        body: {
          listeners: rows.map((row, index) => {
            const other = rows.slice(index + 1).find((next) => next.speaker && next.speaker !== row.speaker) ?? rows.slice(0, index).reverse().find((previous) => previous.speaker && previous.speaker !== row.speaker);
            return { id: row.id, listener: other?.speaker ?? null, confidence: index === 0 ? 0.6 : other ? 0.95 : 0.3 };
          }),
        },
        entries: { key: 'listeners' },
      };
    case 'knowledge': {
      // One event per scene, named after its first line; nothing else is new. Line ids are the prompt's.
      const first = rows[0];
      return {
        body: {
          characters: [],
          relationships: [],
          events: first ? [{ title: `모의 사건: ${first.source.slice(0, 30)}`, summary: '모의 요약', outcome: '', participants: [], evidence: [first.id] }] : [],
          speechRules: [],
        },
      };
    }
    case 'json':
      return { body: { results: jsonRows(rows, schema) }, entries: { key: 'results' } };
  }
}

export interface MockRequest {
  system: string;
  /** The user message text (the server sends JSON for per-line nodes, a script for analysis). */
  user: string;
  /** The response_format JSON schema, when known (only used to fill "json" node fields). */
  schema?: unknown;
}

export interface MockOutcome {
  kind: MockKind;
  /** Lines in the request (0 for analysis). */
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

const DEFAULT_LATENCY: Record<'analysis' | 'other', number> = { analysis: 1500, other: 400 };

/** The whole decision for one structured request. `rand` drives every fault so a seed reproduces a run. */
export function respond(request: MockRequest, options: MockOptions, rand: () => number = makeRand(options.seed)): MockOutcome {
  const kind = detectKind(request.system);
  const promptChars = request.system.length + request.user.length;
  const base = options.latencyMs ?? DEFAULT_LATENCY[kind === 'analysis' ? 'analysis' : 'other'];
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
  if (kind === 'analysis') {
    const result = analysis(request.user);
    body = result.body;
    lines = result.count;
  } else if (kind === 'test') {
    // A model test (AI 연결 › 모델 시험): one plain sentence, not a JSON batch.
    body = { text: `[KO] ${request.user}` };
    lines = 1;
  } else if (kind === 'glossary') {
    // "빈 번역 AI로 채우기": every candidate gets a form, except phrases opening with an ordinary word.
    const input = JSON.parse(request.user) as { candidates: { source: string }[] };
    lines = input.candidates.length;
    body = {
      terms: input.candidates.map(({ source }) => {
        const isTerm = !/^(This|Thank|That|Dear)\b/.test(source);
        return { source, isTerm, target: isTerm ? `[KO] ${source}` : '', note: isTerm ? '모의 용어' : '' };
      }),
    };
  } else {
    // The server groups a batch's lines by scene; older prompts listed them flat.
    const input = JSON.parse(request.user) as { lines?: Row[]; scenes?: { lines: Row[] }[] };
    rows = input.scenes ? input.scenes.flatMap((scene) => scene.lines) : (input.lines ?? []);
    lines = rows.length;
    const result = structured(kind, request.system, rows, request.schema);
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
  if (rand() < options.truncateRate) {
    content = content.slice(0, Math.max(1, Math.floor(content.length * 0.6)));
    finishReason = 'length';
    faults.push('truncate');
  } else if (rand() < options.badJsonRate) {
    content = `Here is the result:\n${content.slice(0, Math.max(1, Math.floor(content.length / 2)))} ... }}`;
    faults.push('badJson');
  }
  return { kind, lines, status: 200, finishReason, content, usage: usageFor(promptChars, content.length, options), delayMs, faults };
}
