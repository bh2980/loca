import type { z } from 'zod';
import { eq } from 'drizzle-orm';
import { get } from 'es-toolkit/compat';
import { checkFormat, type FunctionConfig, type FunctionName, type FunctionParams, type httpParams, type JsonField } from '@tw/shared';
import type { Db } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import { connectionKey } from '../../services/app-defaults.ts';
import type { SecretStore } from '../../services/secrets.ts';
import { runScript } from './sandbox.ts';
import { knowledgeOf } from '../../services/speech.ts';
import { HUMAN_OWNED_NOTE } from '../apply-candidate.ts';
import { applyFunctions } from './apply.ts';
import { byInput, type FunctionInput, type FunctionResult } from './types.ts';

export type { FunctionInput, FunctionResult };

export { HUMAN_OWNED_NOTE };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const NEEDS_CANDIDATE = '검사할 번역 후보가 없습니다.';
/** The item's source text: a line's, or a term's. */
const sourceOf = (input: FunctionInput) => byInput(input, { lines: ({ unit }) => unit.source, terms: ({ term }) => term.source });
/** The text a check reads: the run's working text, else what the item has stored. */
const candidateOf = (input: FunctionInput) => input.item.data.candidateText ?? byInput(input, { lines: ({ unit }) => unit.translation, terms: ({ term }) => term.target || null }) ?? null;

/** What a script or HTTP template can see about an item: `unit` for a line, `term` for a term. */
export function lineView(input: FunctionInput) {
  return {
    ...byInput<{ unit: object } | { term: object }>(input, {
      lines: ({ unit }) => ({ unit: { key: unit.key, kind: unit.kind, speaker: unit.speaker, source: unit.source, translation: unit.translation } }),
      terms: ({ term }) => ({ term: { source: term.source, target: term.target, note: term.note, status: term.status, lines: term.lines } }),
    }),
    candidate: candidateOf(input),
    previous: input.previous ?? null,
    issues: input.item.data.issues ?? [],
    outputs: input.item.data.outputs ?? {},
    visits: input.item.visits,
    error: input.item.data.error ?? null,
  };
}

/**
 * A script's `data` held to the fields its node declares: a missing field gets its type's empty
 * value, numbers and booleans are coerced, and a value that cannot be a number is an error naming the field.
 */
export function validateScriptData(raw: Record<string, unknown> | undefined, fields: readonly JsonField[]): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(raw ?? {}) };
  for (const field of fields) {
    const value = data[field.name];
    if (field.type === 'strings' || field.type === 'lines') {
      data[field.name] = Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined).map(String) : typeof value === 'string' && value ? [value] : [];
    } else if (field.type === 'list') {
      data[field.name] = (Array.isArray(value) ? value : []).filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry)).map((entry) => validateScriptData(entry, field.fields ?? []));
    } else if (value === undefined || value === null) {
      data[field.name] = field.type === 'number' ? 0 : field.type === 'boolean' ? false : '';
    } else if (field.type === 'number' && typeof value !== 'number') {
      const number = typeof value === 'string' && !value.trim() ? Number.NaN : Number(value);
      if (!Number.isFinite(number)) throw new Error(`스크립트 출력 필드 '${field.name}'의 값이 숫자가 아닙니다: ${String(value)}`);
      data[field.name] = number;
    } else if (field.type === 'boolean' && typeof value !== 'boolean') {
      data[field.name] = value === 'false' || value === '0' ? false : Boolean(value);
    } else if (field.type === 'string' && typeof value !== 'string') {
      data[field.name] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  }
  return data;
}

// ── what the functions that call out are made of ────────────────────

/** Fill "{{path}}" placeholders; inside JSON strings the value is escaped so the body stays valid JSON. */
function render(template: string, view: unknown, json: boolean): string {
  return template.replace(/\{\{\s*([\w.[\]-]+)\s*\}\}/g, (_match, path: string) => {
    const value = get(view, path);
    const text = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    return json ? JSON.stringify(text).slice(1, -1) : encodeURIComponent(text);
  });
}

/** One HTTP call for an item's view (url, body and the key header as the node sets them): the parsed response. */
export async function callHttp(params: z.infer<typeof httpParams>, view: unknown, { db, secrets, signal }: { db: Db; secrets: SecretStore; signal: AbortSignal }): Promise<unknown> {
    const url = render(params.url.trim(), view, false);
    if (!/^https?:\/\//.test(url)) throw new Error('HTTP 호출 주소가 http(s)://로 시작하지 않습니다.');
    const headers: Record<string, string> = { Accept: 'application/json' };
    const connection = params.connectionId ? db.select().from(s.connections).where(eq(s.connections.id, params.connectionId)).get() : undefined;
    if (params.connectionId && !connection) throw new Error('고른 API 키를 찾을 수 없습니다.');
    const key = connection ? connectionKey(db, secrets, connection.id) : undefined;
    if (connection && key && connection.headerTemplate) {
      const [name, ...rest] = connection.headerTemplate.split(':');
      headers[name.trim()] = rest.join(':').trim().replace('{key}', key);
    }
    let body: string | undefined;
    if (params.method === 'POST') {
      body = render(params.body, view, true);
      try {
        JSON.parse(body);
      } catch {
        throw new Error('요청 본문이 올바른 JSON이 아닙니다. 템플릿을 확인하세요.');
      }
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, {
      method: params.method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(params.timeoutSeconds * 1000)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} — ${(await response.text()).slice(0, 200)}`);
    return (response.headers.get('content-type') ?? '').includes('json') ? await response.json() : await response.text();
}

/** The declared fields of an HTTP call's result, each from its place in the response (its path, else its own name), held to the declaration like a script's data. */
export const httpOutput = (params: z.infer<typeof httpParams>, payload: unknown) =>
  validateScriptData(Object.fromEntries(params.fields.map((field) => [field.name, get(payload, params.paths[field.name]?.trim() || field.name)])), params.fields);

type Deps = { db: Db; secrets: SecretStore; signal: AbortSignal };
/** A function that finishes at once, inside the runner's transaction. */
type Instant<F extends FunctionName> = (tx: Tx, params: FunctionParams<F>, input: FunctionInput) => FunctionResult;
/** A function that calls out (network, sandbox): dispatched like an AI call. */
type CallOut<F extends FunctionName> = (params: FunctionParams<F>, input: FunctionInput, deps: Deps) => Promise<FunctionResult>;

/**
 * Every function's implementation, by the name it has in FUNCTIONS and with that function's own settings: one that
 * is missing does not compile. `instant` or `callsOut` must be what FUNCTIONS[fn].callsOut says (functions.test.ts).
 */
export const FUNCTION_IMPLEMENTATIONS: { [F in FunctionName]: { instant: Instant<F> } | { callsOut: CallOut<F> } } = {
  formatCheck: {
    instant(tx, params, input) {
      const text = candidateOf(input);
      const rules = knowledgeOf(tx as unknown as Db, input.projectId).settings()?.formatRules;
      const issues = text === null ? [NEEDS_CANDIDATE] : checkFormat(sourceOf(input), text, params, rules).map((issue) => issue.message);
      return { port: issues.length ? 'fail' : 'pass', issues, output: { text, passed: !issues.length, issues, kind: 'format' } };
    },
  },
  glossaryCheck: {
    instant(tx, _params, input) {
      const text = candidateOf(input);
      if (text === null) return { port: 'fail', issues: [NEEDS_CANDIDATE], output: { text, passed: false, issues: [NEEDS_CANDIDATE], kind: 'term' } };
      const issues = knowledgeOf(tx as unknown as Db, input.projectId)
        .glossary()
        .matcher.find(sourceOf(input), byInput(input, { lines: ({ unit }) => unit.kind, terms: () => undefined }))
        .filter((term) => !text.toLowerCase().includes(term.target.toLowerCase()))
        .map((term) => `용어 "${term.source}"은(는) "${term.target}"(으)로 옮겨야 합니다.`);
      return { port: issues.length ? 'fail' : 'pass', issues, output: { text, passed: !issues.length, issues, kind: 'term' } };
    },
  },
  script: {
    async callsOut(params, input) {
      const result = await runScript(params.code, lineView(input));
      const port = result.port ?? params.ports[0];
      if (!port || !params.ports.includes(port)) throw new Error(`스크립트가 선언하지 않은 출구를 반환했습니다: ${port}`);
      return { port, candidate: result.candidate, output: validateScriptData(result.data, params.fields), issues: result.issues };
    },
  },
  http: {
    callsOut: async (params, input, deps) => ({ port: 'out', output: httpOutput(params, await callHttp(params, lineView(input), deps)) }),
  },
  ...applyFunctions,
};

/** Runs an instant function node for one item, inside the runner's transaction. */
export function runInstantFunction(tx: Tx, config: FunctionConfig, input: FunctionInput): FunctionResult {
  const implementation = FUNCTION_IMPLEMENTATIONS[config.fn];
  if (!('instant' in implementation)) throw new Error(`즉시 실행할 수 없는 함수입니다: ${config.fn}`);
  return (implementation.instant as Instant<FunctionName>)(tx, config.params, input);
}

/** Runs a function node that calls out for one item. */
export function runAsyncFunction(config: FunctionConfig, input: FunctionInput, deps: Deps): Promise<FunctionResult> {
  const implementation = FUNCTION_IMPLEMENTATIONS[config.fn];
  if (!('callsOut' in implementation)) throw new Error(`실행할 수 없는 함수입니다: ${config.fn}`);
  return (implementation.callsOut as CallOut<FunctionName>)(config.params, input, deps);
}
