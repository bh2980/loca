import { and, asc, eq } from 'drizzle-orm';
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
  saveAnalysisParams,
  setListenerParams,
  setStatusParams,
  type AnalysisSection,
  needsListener,
  type FunctionName,
  type WorkflowDefinition,
  filtersByStatus,
} from '@tw/shared';
import type { Db } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import type { SecretStore } from '../../services/secrets.ts';
import { attachUnitTags } from '../../services/tag-scope.ts';
import { cleanListener, clampConfidence, setAiListener } from '../../services/listeners.ts';
import { upsertAiTerm } from '../../services/terms.ts';
import { runScript } from './sandbox.ts';
import { aiConfirmOf } from '../../services/status-by.ts';
import { knowledgeOf, speechMismatch, speechRuleIndex } from '../../services/speech.ts';
import type { IssueTagChange } from '../../services/issue-tags.ts';
import type { KnowledgeOutput } from '../prompts.ts';
import { saveDrafts, type Analysis } from '../../services/analysis.ts';
import { personOwns } from '../apply-candidate.ts';

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
  /** Problem-type tags this check puts on the line or takes off (services/issue-tags.ts). */
  issueTags?: IssueTagChange;
}

export interface FunctionInput {
  unit: Unit;
  item: Item;
  tagIds: string[];
  projectId: string;
  runId: string;
}

const NEEDS_CANDIDATE = '검사할 번역 후보가 없습니다.';
/** A person's saved translation a status-filtered run does not replace (#51); the same text the runner notes. */
export const HUMAN_OWNED_NOTE = '사람이 저장한 번역이 있어 바꾸지 않았습니다. AI 번역은 후보로 남겨 두었습니다.';
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

  speechCheck(tx, _raw, input) {
    const text = candidateOf(input);
    if (text === null) return { port: 'fail', issues: [NEEDS_CANDIDATE], output: { passed: false, issues: [NEEDS_CANDIDATE] } };
    const found = speechRuleIndex(tx as unknown as Db, input.projectId).resolve([input.unit]).get(input.unit.key);
    const issue = found ? speechMismatch(found.rule, text) : null;
    const issues = issue ? [issue] : [];
    // Only a line with a speech rule is checked for it; without one, nothing is said either way.
    return { port: issues.length ? 'fail' : 'pass', issues, output: { passed: !issues.length, issues }, ...(found && { issueTags: issues.length ? { add: ['speech'] } : { clear: ['speech'] } }) };
  },

  setStatus(tx, raw, input) {
    const params = setStatusParams.parse(raw);
    // Translations now go into the line when a node produces them (engine/apply-candidate.ts, #42);
    // this node only sets the status and tags. A run sets the line's status, so AI set it
    // (docs/DESIGN.md 3.5); a person's change later makes it theirs. A run that picks lines by status
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

  addTerms(tx, raw, input) {
    const params = addTermsParams.parse(raw);
    const outputs = Object.entries(input.item.data.outputs ?? {});
    const source = params.fromNodeId ? input.item.data.outputs?.[params.fromNodeId] : outputs.reverse().find(([, output]) => Array.isArray(output.terms))?.[1];
    // Skip redundant database writes for non-leader lines in the same batch (H7).
    if (source && typeof source === 'object' && (source as { batchLeader?: boolean }).batchLeader === false) {
      return { port: 'out', output: { added: 0, filled: 0, batchSkipped: true } };
    }
    const found = (Array.isArray(source?.terms) ? source.terms : []) as { source?: string; target?: string; note?: string }[];
    // New terms land as AI › 사용 방식 says (one without a Korean form stays a candidate).
    const policy = aiConfirmOf(tx as unknown as Db, input.projectId);
    let added = 0;
    let filled = 0;
    for (const term of found) {
      if (!term.source?.trim()) continue;
      const result = upsertAiTerm(tx, input.projectId, { source: term.source, target: term.target, note: term.note }, { policy, runId: input.runId });
      if (result === 'added') added++;
      else if (result === 'filled') filled++;
    }
    return { port: 'out', output: { added, filled } };
  },

  applyKnowledge(tx, raw, input) {
    const params = applyKnowledgeParams.parse(raw);
    const outputs = Object.entries(input.item.data.outputs ?? {});
    const source = params.fromNodeId ? input.item.data.outputs?.[params.fromNodeId] : outputs.reverse().find(([, output]) => 'knowledge' in output)?.[1];
    // Skip redundant database writes for non-leader lines in the same batch (H7).
    if (source && typeof source === 'object' && (source as { batchLeader?: boolean }).batchLeader === false) {
      return { port: 'out', output: { added: 0, proposed: 0, batchSkipped: true } };
    }
    const found = (source?.knowledge ?? null) as KnowledgeOutput | null;
    if (!found) return { port: 'out', output: { added: 0, proposed: 0, reason: '자료 변경 출력이 없습니다.' } };
    const projectId = input.projectId;
    // Each kind lands as AI › 사용 방식 says; AI set the status either way.
    const policy = aiConfirmOf(tx as unknown as Db, projectId);
    const ai = (kind: AiConfirmKind) => ({ origin: 'ai' as const, statusBy: 'ai' as const, status: aiStatus(policy, kind) });
    const lower = (value: string) => value.trim().toLowerCase();
    let added = 0;
    let proposed = 0;

    // The batch's lines all carry the same change set; only the batch leader writes to the database (H7).
    const know = knowledgeOf(tx as unknown as Db, projectId);
    const people = know.allCharacters();
    const idOf = new Map(people.flatMap((c) => [c.name, ...c.aliases].map((name) => [lower(name), c.id] as const)));
    for (const person of found.characters) {
      if ([person.name, ...person.aliases].some((name) => idOf.has(lower(name)))) continue;
      const evidence = (person as { evidence?: string[] }).evidence?.length ? (person as { evidence?: string[] }).evidence! : [input.unit.key];
      const row = tx.insert(s.characters).values({ projectId, name: person.name, aliases: person.aliases, profile: person.profile, evidence, ...ai('characters') }).returning({ id: s.characters.id }).get();
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
      const relEvidence = change?.at ? [change.at] : ((rel as { evidence?: string[] }).evidence?.length ? (rel as { evidence?: string[] }).evidence! : [input.unit.key]);
      if (!same.length) {
        rels.push(tx.insert(s.relationships).values({ projectId, fromId, toId, kind: rel.kind, description: rel.description, changes: change ? [change] : [], evidence: relEvidence, ...ai('relationships') }).returning().get());
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
      const ruleEvidence = (rule as { evidence?: string[] }).evidence?.length ? (rule as { evidence?: string[] }).evidence! : rule.start ? [rule.start] : [input.unit.key];
      rules.push(
        tx.insert(s.speechRules)
          .values({ projectId, fromName: rule.from, toName: rule.to, level: rule.level, address: rule.address, note: rule.note, startKey: rule.start, evidence: ruleEvidence, ...ai('speechRules'), ...(disagrees && { status: 'candidate' as const }) })
          .returning()
          .get(),
      );
      if (disagrees) proposed++;
      else added++;
    }
    return { port: 'out', output: { added, proposed } };
  },

  saveAnalysis(tx, raw, input) {
    const params = saveAnalysisParams.parse(raw);
    const outputs = Object.entries(input.item.data.outputs ?? {});
    const source = params.fromNodeId ? input.item.data.outputs?.[params.fromNodeId] : outputs.reverse().find(([, output]) => 'analysis' in output)?.[1];
    // One answer per request, carried by its first line (H7): the others have nothing to store.
    if (source && (source as { batchLeader?: boolean }).batchLeader === false) return { port: 'out', output: { batchSkipped: true } };
    const found = (source?.analysis ?? null) as Partial<Analysis> | null;
    if (!found) return { port: 'out', output: { saved: false, reason: '작품 분석 출력이 없습니다.' } };
    // Only a read of the whole script replaces what earlier analyses drafted; a few scenes only add and fill.
    const run = tx.select({ scope: s.runs.scope, definition: s.runs.definition }).from(s.runs).where(eq(s.runs.id, input.runId)).get();
    const replace = !run || (!filtersByStatus(run.definition, run.scope) && !run.scope.groupIds?.length && !run.scope.unitIds?.length && !run.scope.tagIds?.length && !run.scope.marks?.length);
    // The answer already names lines by key (the runner mapped the prompt's ids).
    const keyOf = new Map(tx.select({ key: s.units.key }).from(s.units).where(eq(s.units.projectId, input.projectId)).all().map((unit) => [unit.key, unit.key]));
    const sections = Array.isArray(source?.sections) ? (source.sections as AnalysisSection[]) : undefined;
    const counts = saveDrafts(tx as unknown as Db, input.projectId, input.runId, found, keyOf, aiConfirmOf(tx as unknown as Db, input.projectId), { sections, replace });
    return { port: 'out', output: { saved: true, replaced: replace, counts } };
  },

  setListener(tx, raw, input) {
    const params = setListenerParams.parse(raw);
    const outputs = Object.entries(input.item.data.outputs ?? {});
    const source = params.fromNodeId ? input.item.data.outputs?.[params.fromNodeId] : outputs.reverse().find(([, output]) => 'confidence' in output && 'listener' in output)?.[1];
    if (!source || !('listener' in source)) return { port: 'out', output: { recorded: false, reason: '청자 출력이 없습니다.' } };
    // Only lines said to someone have a listener (needsListener: not narration, not format tokens
    // only), so none is made up for the rest; what the import or a person set is never overwritten by the AI.
    const rules = tx.select({ formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, input.projectId)).get()?.formatRules;
    if (!needsListener(input.unit, rules)) return { port: 'out', output: { recorded: false, reason: input.unit.kind !== 'dialogue' ? '대사가 아니라 청자가 필요 없습니다.' : !input.unit.speaker?.trim() ? '화자가 없는 지문이라 청자가 필요 없습니다.' : '서식만 있는 줄이라 청자가 필요 없습니다.' } };
    if (input.unit.listenerOrigin === 'human') return { port: 'out', output: { recorded: false, reason: '사람이 정한 청자가 있습니다.' } };
    if (input.unit.listenerOrigin === 'import' && input.unit.listener) return { port: 'out', output: { recorded: false, reason: '가져온 청자가 있습니다.' } };
    const listener = cleanListener(typeof source.listener === 'string' ? source.listener : null);
    const confidence = clampConfidence(source.confidence);
    setAiListener(tx, input.unit, listener, confidence, 'ai', rules);
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
