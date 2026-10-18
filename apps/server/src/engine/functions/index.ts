import { and, asc, eq } from 'drizzle-orm';
import { get } from 'es-toolkit/compat';
import { checkFormat, formatCheckParams, httpParams, scriptParams, setStatusParams, type FunctionName, type JsonField, filtersByStatus } from '@tw/shared';
import type { Db } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import type { SecretStore } from '../../services/secrets.ts';
import { attachUnitTags } from '../../services/tag-scope.ts';
import { runScript } from './sandbox.ts';
import { knowledgeOf } from '../../services/speech.ts';
import type { IssueTagChange } from '../../services/issue-tags.ts';
import { HUMAN_OWNED_NOTE, personOwns } from '../apply-candidate.ts';
import { applyFunctions } from './apply.ts';
import type { FunctionInput, FunctionResult } from './types.ts';

export type { FunctionInput, FunctionResult };

export { HUMAN_OWNED_NOTE };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Unit = typeof s.units.$inferSelect;
type Item = typeof s.runItems.$inferSelect;

const NEEDS_CANDIDATE = '검사할 번역 후보가 없습니다.';
const candidateOf = (input: FunctionInput) => input.item.data.candidateText ?? input.unit.translation ?? null;

/** What a script or HTTP template can see about a line. */
export function lineView(input: FunctionInput) {
  return {
    unit: { key: input.unit.key, kind: input.unit.kind, speaker: input.unit.speaker, source: input.unit.source, translation: input.unit.translation },
    candidate: candidateOf(input),
    issues: input.item.data.issues ?? [],
    outputs: input.item.data.outputs ?? {},
    visits: input.item.visits,
  };
}

// ── instant functions (run inside the runner's transaction) ──────────

/** Whether a run picks its lines by the entry node's statuses (rather than lines named regardless of status). */
export const syncFunctions: Partial<Record<FunctionName, (tx: Tx, params: unknown, input: FunctionInput) => FunctionResult>> = {
  formatCheck(tx, raw, input) {
    const params = formatCheckParams.parse(raw);
    const text = candidateOf(input);
    const rules = tx.select({ formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, input.projectId)).get()?.formatRules;
    const issues = text === null ? [NEEDS_CANDIDATE] : checkFormat(input.unit.source, text, params, rules).map((issue) => issue.message);
    return { port: issues.length ? 'fail' : 'pass', issues, output: { passed: !issues.length, issues }, ...(text !== null && { issueTags: issues.length ? { add: ['format'] } : { clear: ['format'] } }) };
  },

  glossaryCheck(tx, _raw, input) {
    const text = candidateOf(input);
    if (text === null) return { port: 'fail', issues: [NEEDS_CANDIDATE], output: { passed: false, issues: [NEEDS_CANDIDATE] } };
    const issues = knowledgeOf(tx as unknown as Db, input.projectId)
      .glossary()
      .matcher.find(input.unit.source)
      .filter((term) => !text.toLowerCase().includes(term.target.toLowerCase()))
      .map((term) => `용어 "${term.source}"은(는) "${term.target}"(으)로 옮겨야 합니다.`);
    return { port: issues.length ? 'fail' : 'pass', issues, output: { passed: !issues.length, issues }, issueTags: issues.length ? { add: ['term'] } : { clear: ['term'] } };
  },

  setStatus(tx, raw, input) {
    const params = setStatusParams.parse(raw);
    // Translations now go into the line when a node produces them (engine/apply-candidate.ts, #42);
    // this node only sets the status and tags. A run sets the line's status, so AI set it;
    // a person's change later makes it theirs. A run that picks lines by status
    // never replaces a translation a person wrote (#51): its entry skips such lines, and one a person
    // saved while the run was on it keeps its status here. A run on lines named regardless of status
    // (말투만 고치기, '상태 무시') is asked to rewrite them, so its status change goes through.
    const current = tx.select({ translation: s.units.translation, statusBy: s.units.statusBy }).from(s.units).where(eq(s.units.id, input.unit.id)).get();
    const run = tx.select({ definition: s.runs.definition, scope: s.runs.scope }).from(s.runs).where(eq(s.runs.id, input.runId)).get();
    const humanOwns = personOwns(current, input.item.data.candidateText, !run || filtersByStatus(run.definition, run.scope));
    const patch: Partial<typeof s.units.$inferInsert> = {};
    const issues: string[] = [];
    if (humanOwns) {
      // Keep the person's translation and status; the run's text stays a candidate beside it.
      issues.push(HUMAN_OWNED_NOTE);
    } else {
      if (params.statusId) {
        const target = tx.select({ name: s.statuses.name, humanOnly: s.statuses.humanOnly }).from(s.statuses).where(eq(s.statuses.id, params.statusId)).get();
        if (target?.humanOnly) {
          // Only a person may set it: the line waits in the review inbox instead, saying why.
          const inbox = tx.select({ id: s.statuses.id }).from(s.statuses).where(and(eq(s.statuses.projectId, input.projectId), eq(s.statuses.inReview, true), eq(s.statuses.humanOnly, false))).orderBy(asc(s.statuses.sort)).get();
          if (inbox) {
            patch.statusId = inbox.id;
            issues.push(`‘${target.name}’은(는) 사람만 지정할 수 있어 검토함으로 보냈습니다.`);
          } else issues.push(`‘${target.name}’은(는) 사람만 지정할 수 있어 상태를 바꾸지 않았습니다(검토함에 표시하는 상태가 없음).`);
        } else patch.statusId = params.statusId;
        if (patch.statusId) Object.assign(patch, { statusBy: 'ai', statusRunId: input.runId });
      }
      if (Object.keys(patch).length) tx.update(s.units).set(patch).where(eq(s.units.id, input.unit.id)).run();
    }
    // A tag that no longer belongs on lines (its places were narrowed after the node was set up) is skipped, with a notice.
    const { skipped } = attachUnitTags(tx, input.projectId, [input.unit.id], { add: params.addTagIds, remove: params.removeTagIds }, { onMisplaced: 'skip' });
    for (const tag of skipped) issues.push(`‘${tag.name}’ 태그는 대사에 붙일 수 없어 붙이지 않았습니다.`);
    return issues.length ? { port: 'out', issues } : { port: 'out' };
  },

  ...applyFunctions,
};

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

// ── slow functions (dispatched like AI calls) ────────────────────────

/** Fill "{{path}}" placeholders; inside JSON strings the value is escaped so the body stays valid JSON. */
function render(template: string, view: unknown, json: boolean): string {
  return template.replace(/\{\{\s*([\w.[\]-]+)\s*\}\}/g, (_match, path: string) => {
    const value = get(view, path);
    const text = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    return json ? JSON.stringify(text).slice(1, -1) : encodeURIComponent(text);
  });
}

export async function runAsyncFunction(
  fn: FunctionName,
  raw: unknown,
  input: FunctionInput,
  deps: { db: Db; secrets: SecretStore; signal: AbortSignal },
): Promise<FunctionResult> {
  if (fn === 'script') {
    const params = scriptParams.parse(raw);
    const result = await runScript(params.code, lineView(input));
    const port = result.port ?? params.ports[0];
    if (!params.ports.includes(port)) throw new Error(`스크립트가 선언하지 않은 출구를 반환했습니다: ${port}`);
    return { port, candidate: result.candidate, output: validateScriptData(result.data, params.fields), issues: result.issues };
  }

  if (fn === 'http') {
    const params = httpParams.parse(raw);
    const view = lineView(input);
    const url = render(params.url.trim(), view, false);
    if (!/^https?:\/\//.test(url)) throw new Error('HTTP 호출 주소가 http(s)://로 시작하지 않습니다.');
    const headers: Record<string, string> = { Accept: 'application/json' };
    const connection = params.connectionId ? deps.db.select().from(s.connections).where(eq(s.connections.id, params.connectionId)).get() : undefined;
    if (params.connectionId && !connection) throw new Error('고른 API 키를 찾을 수 없습니다.');
    const key = connection ? deps.secrets.get(connection.id) : undefined;
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
      signal: AbortSignal.any([deps.signal, AbortSignal.timeout(params.timeoutSeconds * 1000)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} — ${(await response.text()).slice(0, 200)}`);
    const payload: unknown = (response.headers.get('content-type') ?? '').includes('json') ? await response.json() : await response.text();
    const result = params.resultPath ? get(payload, params.resultPath) : payload;
    if (params.mode === 'candidate') {
      if (typeof result !== 'string') throw new Error(`응답의 "${params.resultPath || '(전체)'}" 값이 문자열이 아닙니다.`);
      return { port: 'out', candidate: result, output: { text: result, changed: result !== view.candidate } };
    }
    if (params.mode === 'verdict') return { port: result ? 'pass' : 'fail', output: { passed: Boolean(result), result } };
    return { port: 'out', output: { result } };
  }

  throw new Error(`실행할 수 없는 함수입니다: ${fn}`);
}
