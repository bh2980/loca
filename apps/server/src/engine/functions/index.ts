import { and, asc, eq, sql } from 'drizzle-orm';
import { get } from 'es-toolkit/compat';
import {
  addTermsParams,
  aiStatus,
  applyKnowledgeParams,
  type AiConfirmKind,
  checkFormat,
  formatCheckParams,
  httpParams,
  scriptParams,
  setListenerParams,
  setStatusParams,
  type FunctionName,
} from '@tw/shared';
import type { Db } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import type { SecretStore } from '../../services/secrets.ts';
import { runScript } from './sandbox.ts';
import { aiConfirmOf } from '../../services/status-by.ts';
import { knowledgeOf, speechMismatch, speechRuleIndex } from '../../services/speech.ts';
import type { KnowledgeOutput } from '../prompts.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Unit = typeof s.units.$inferSelect;
type Item = typeof s.runItems.$inferSelect;

/** What a function hands back to the runner, which records it and routes the line. */
export interface FunctionResult {
  port: string;
  /** A new candidate text for the line (stored as a "tool" candidate). */
  candidate?: string;
  /** Stored as outputs[<node id>] for later nodes and conditions. */
  output?: Record<string, unknown>;
  /** Problems to hand to a later revise step. */
  issues?: string[];
}

export interface FunctionInput {
  unit: Unit;
  item: Item;
  tagIds: string[];
  projectId: string;
  runId: string;
}

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

export const syncFunctions: Partial<Record<FunctionName, (tx: Tx, params: unknown, input: FunctionInput) => FunctionResult>> = {
  formatCheck(tx, raw, input) {
    const params = formatCheckParams.parse(raw);
    const text = candidateOf(input);
    const rules = tx.select({ formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, input.projectId)).get()?.formatRules;
    const issues = text === null ? [NEEDS_CANDIDATE] : checkFormat(input.unit.source, text, params, rules).map((issue) => issue.message);
    return { port: issues.length ? 'fail' : 'pass', issues, output: { passed: !issues.length, issues } };
  },

  glossaryCheck(tx, _raw, input) {
    const text = candidateOf(input);
    if (text === null) return { port: 'fail', issues: [NEEDS_CANDIDATE], output: { passed: false, issues: [NEEDS_CANDIDATE] } };
    const issues = knowledgeOf(tx as unknown as Db, input.projectId)
      .glossary()
      .matcher.find(input.unit.source)
      .filter((term) => !text.toLowerCase().includes(term.target.toLowerCase()))
      .map((term) => `용어 "${term.source}"은(는) "${term.target}"(으)로 옮겨야 합니다.`);
    return { port: issues.length ? 'fail' : 'pass', issues, output: { passed: !issues.length, issues } };
  },

  speechCheck(tx, _raw, input) {
    const text = candidateOf(input);
    if (text === null) return { port: 'fail', issues: [NEEDS_CANDIDATE], output: { passed: false, issues: [NEEDS_CANDIDATE] } };
    const found = speechRuleIndex(tx as unknown as Db, input.projectId).resolve([input.unit]).get(input.unit.key);
    const issue = found ? speechMismatch(found.rule, text) : null;
    const issues = issue ? [issue] : [];
    return { port: issues.length ? 'fail' : 'pass', issues, output: { passed: !issues.length, issues } };
  },

  setStatus(tx, raw, input) {
    const params = setStatusParams.parse(raw);
    // A run sets the line's status, so AI set it (docs/DESIGN.md 3.5); a person's change later makes it theirs.
    const patch: Partial<typeof s.units.$inferInsert> = {};
    const issues: string[] = [];
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
    if (params.applyCandidate && input.item.data.candidateId) {
      patch.candidateId = input.item.data.candidateId;
      patch.translation = input.item.data.candidateText;
    }
    if (Object.keys(patch).length) tx.update(s.units).set(patch).where(eq(s.units.id, input.unit.id)).run();
    if (params.removeTagIds.length)
      for (const tagId of params.removeTagIds) tx.delete(s.unitTags).where(and(eq(s.unitTags.unitId, input.unit.id), eq(s.unitTags.tagId, tagId))).run();
    if (params.addTagIds.length) tx.insert(s.unitTags).values(params.addTagIds.map((tagId) => ({ unitId: input.unit.id, tagId }))).onConflictDoNothing().run();
    return issues.length ? { port: 'out', issues } : { port: 'out' };
  },

  addTerms(tx, raw, input) {
    const params = addTermsParams.parse(raw);
    const outputs = Object.entries(input.item.data.outputs ?? {});
    const source = params.fromNodeId ? input.item.data.outputs?.[params.fromNodeId] : outputs.reverse().find(([, output]) => Array.isArray(output.terms))?.[1];
    const found = (Array.isArray(source?.terms) ? source.terms : []) as { source?: string; target?: string; note?: string }[];
    // New terms land as 설정 › AI 확정 says (one without a Korean form stays a candidate).
    const policy = aiConfirmOf(tx as unknown as Db, input.projectId);
    // Candidates count too, so the whole table is read; cached until a term is written (including by this node).
    const existing = new Set(knowledgeOf(tx as unknown as Db, input.projectId).allTermSources().map((source) => source.toLowerCase()));
    let added = 0;
    let filled = 0;
    for (const term of found) {
      const key = term.source?.trim();
      if (!key) continue;
      if (existing.has(key.toLowerCase())) {
        // Like the work analysis: a term already in the glossary keeps what it has; only its empty
        // translation and note are filled. A rejected term stays as the person left it.
        const target = term.target?.trim() ?? '';
        const note = term.note?.trim() ?? '';
        if (!target && !note) continue;
        const known = tx.select({ id: s.terms.id, target: s.terms.target, note: s.terms.note, status: s.terms.status }).from(s.terms).where(and(eq(s.terms.projectId, input.projectId), sql`lower(${s.terms.source}) = ${key.toLowerCase()}`)).get();
        if (!known || known.status === 'rejected') continue;
        const fill = { ...(!known.target.trim() && target && { target }), ...(!known.note.trim() && note && { note }) };
        if (Object.keys(fill).length) {
          tx.update(s.terms).set(fill).where(eq(s.terms.id, known.id)).run();
          filled++;
        }
        continue;
      }
      existing.add(key.toLowerCase());
      tx.insert(s.terms)
        .values({ projectId: input.projectId, source: key, target: term.target?.trim() ?? '', note: term.note ?? '', status: term.target?.trim() ? aiStatus(policy, 'terms') : 'candidate', statusBy: 'ai', origin: 'ai', runId: input.runId })
        .run();
      added++;
    }
    return { port: 'out', output: { added, filled } };
  },

  applyKnowledge(tx, raw, input) {
    const params = applyKnowledgeParams.parse(raw);
    const outputs = Object.entries(input.item.data.outputs ?? {});
    const source = params.fromNodeId ? input.item.data.outputs?.[params.fromNodeId] : outputs.reverse().find(([, output]) => 'knowledge' in output)?.[1];
    const found = (source?.knowledge ?? null) as KnowledgeOutput | null;
    if (!found) return { port: 'out', output: { added: 0, proposed: 0, reason: '자료 변경 출력이 없습니다.' } };
    const projectId = input.projectId;
    // Each kind lands as 설정 › AI 확정 says; AI set the status either way.
    const policy = aiConfirmOf(tx as unknown as Db, projectId);
    const ai = (kind: AiConfirmKind) => ({ origin: 'ai' as const, statusBy: 'ai' as const, status: aiStatus(policy, kind) });
    const lower = (value: string) => value.trim().toLowerCase();
    let added = 0;
    let proposed = 0;

    // The batch's lines all carry the same change set; every insert checks first, so applying it again adds nothing.
    // Read from the snapshot (fresh: every write bumps its version) but copied, since this node edits what it reads.
    const know = knowledgeOf(tx as unknown as Db, projectId);
    const people = know.allCharacters();
    const idOf = new Map(people.flatMap((c) => [c.name, ...c.aliases].map((name) => [lower(name), c.id] as const)));
    for (const person of found.characters) {
      if ([person.name, ...person.aliases].some((name) => idOf.has(lower(name)))) continue;
      const row = tx.insert(s.characters).values({ projectId, name: person.name, aliases: person.aliases, profile: person.profile, evidence: [input.unit.key], ...ai('characters') }).returning({ id: s.characters.id }).get();
      for (const name of [person.name, ...person.aliases]) idOf.set(lower(name), row.id);
      added++;
    }

    const rels = know.allRelationships().map((rel) => ({ ...rel }));
    for (const rel of found.relationships) {
      const fromId = idOf.get(lower(rel.from));
      const toId = idOf.get(lower(rel.to));
      if (!fromId || !toId) continue;
      const change = rel.change && rel.at ? { at: rel.at, change: rel.change, cause: '' } : null;
      const same = rels.filter((existing) => existing.fromId === fromId && existing.toId === toId);
      if (!same.length) {
        rels.push(tx.insert(s.relationships).values({ projectId, fromId, toId, kind: rel.kind, description: rel.description, changes: change ? [change] : [], evidence: change ? [change.at] : [], ...ai('relationships') }).returning().get());
        added++;
        continue;
      }
      if (!change || same.some((existing) => existing.changes.some((known) => known.at === change.at))) continue;
      const open = same.find((existing) => existing.origin === 'ai' && existing.statusBy === 'ai');
      if (open) {
        // An unchecked AI relationship just gains the change.
        tx.update(s.relationships).set({ changes: [...open.changes, change], evidence: [...open.evidence, change.at] }).where(eq(s.relationships.id, open.id)).run();
        open.changes = [...open.changes, change];
        added++;
      } else {
        // Official knowledge is never edited by AI: the change waits as a candidate beside it.
        rels.push(tx.insert(s.relationships).values({ projectId, fromId, toId, kind: rel.kind, description: `변경 제안: ${rel.change}`, changes: [change], evidence: [change.at], origin: 'ai', statusBy: 'ai', status: 'candidate' }).returning().get());
        proposed++;
      }
    }

    const titles = new Set(know.eventTitles().map(lower));
    for (const event of found.events) {
      if (titles.has(lower(event.title))) continue;
      titles.add(lower(event.title));
      tx.insert(s.storyEvents).values({ projectId, title: event.title, summary: event.summary, outcome: event.outcome, participants: event.participants, evidence: event.evidence, ...ai('events') }).run();
      added++;
    }

    const rules = [...know.allSpeechRules()];
    for (const rule of found.speechRules) {
      const pair = rules.filter((existing) => lower(existing.fromName) === lower(rule.from) && lower(existing.toName) === lower(rule.to));
      if (pair.some((existing) => existing.startKey === rule.start && existing.level === rule.level)) continue;
      // A different level for a stretch a person already decided is a proposal, not a new rule.
      const disagrees = pair.some((existing) => existing.startKey === rule.start && existing.statusBy === 'human');
      rules.push(
        tx.insert(s.speechRules)
          .values({ projectId, fromName: rule.from, toName: rule.to, level: rule.level, address: rule.address, note: rule.note, startKey: rule.start, evidence: rule.start ? [rule.start] : [input.unit.key], ...ai('speechRules'), ...(disagrees && { status: 'candidate' as const }) })
          .returning()
          .get(),
      );
      if (disagrees) proposed++;
      else added++;
    }
    return { port: 'out', output: { added, proposed } };
  },

  setListener(tx, raw, input) {
    const params = setListenerParams.parse(raw);
    const outputs = Object.entries(input.item.data.outputs ?? {});
    const source = params.fromNodeId ? input.item.data.outputs?.[params.fromNodeId] : outputs.reverse().find(([, output]) => 'confidence' in output && 'listener' in output)?.[1];
    if (!source || !('listener' in source)) return { port: 'out', output: { recorded: false, reason: '청자 출력이 없습니다.' } };
    // Only dialogue has a listener; what the import or a person set is never overwritten by the AI.
    if (input.unit.kind !== 'dialogue') return { port: 'out', output: { recorded: false, reason: '대사가 아니라 청자가 필요 없습니다.' } };
    if (input.unit.listenerOrigin === 'human') return { port: 'out', output: { recorded: false, reason: '사람이 정한 청자가 있습니다.' } };
    if (input.unit.listenerOrigin === 'import' && input.unit.listener) return { port: 'out', output: { recorded: false, reason: '가져온 청자가 있습니다.' } };
    const listener = typeof source.listener === 'string' ? source.listener : null;
    const confidence = typeof source.confidence === 'number' ? source.confidence : 0;
    tx.update(s.units).set({ listener, listenerOrigin: 'ai', listenerConfidence: confidence }).where(eq(s.units.id, input.unit.id)).run();
    return { port: 'out', output: { recorded: true, listener, confidence } };
  },
};

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
    return { port, candidate: result.candidate, output: result.data ?? {}, issues: result.issues };
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
