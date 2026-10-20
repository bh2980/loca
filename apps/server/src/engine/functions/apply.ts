import { eq } from 'drizzle-orm';
import { get } from 'es-toolkit/compat';
import { AGE_BANDS, APPLY_FUNCTION_NAMES, APPLY_TARGETS, applyParams, CHARACTER_ROLES, DOCUMENT_KINDS, GENDERS, SPEECH_LEVELS, tagScope, TERM_KIND_LABELS, TERM_KINDS, UNKNOWN_LISTENER, type AiConfirm, type ApplyField, type ApplyFunctionName, type ApplyParams } from '@tw/shared';
import type { Db } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import type { Topic } from '../../events.ts';
import { aiSaveCharacters, aiSaveDocument, aiSaveEvents, aiSaveRelationships, aiSaveSpeechRules, aiSaveTerms, aiSetLineListeners, aiSetSceneListeners, type AiWrite } from '../../services/ai-knowledge.ts';
import { addCandidate } from '../../services/candidates.ts';
import { addToRunProposal, fileRunProposal } from '../../services/proposals.ts';
import { aiConfirmOf } from '../../services/status-by.ts';
import { attachUnitTags } from '../../services/tag-scope.ts';
import { applyRunCandidate, HUMAN_OWNED_NOTE } from '../apply-candidate.ts';
import { lineOf, type FunctionInput, type FunctionResult } from './types.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Item = Record<string, unknown>;

/**
 * 반영 노드: put a node's output into the project, through the same services as the chat/CLI write
 * tools (APPLY_TARGETS names each one's tool). With "제안으로 남기기" (the default) nothing is written:
 * the tool's input is filed as a proposal (source 'run') a person accepts in the app, and accepting
 * runs that very tool. Without it the result is written now by services/ai-knowledge.ts (AI origin;
 * nothing a person set is changed).
 */

const BLANK = new Set<unknown>([undefined, null, '']);
/** Nothing there: no value, an empty text or an empty list. */
const blank = (value: unknown) => BLANK.has(value) || (Array.isArray(value) && value.length === 0);


/** A source value as the target field's type, or undefined when it is not one. */
function coerce(field: ApplyField, value: unknown): unknown {
  switch (field.type) {
    case 'string':
      return typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
    case 'number': {
      const number = typeof value === 'string' && value.trim() ? Number(value) : value;
      return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined;
    case 'strings':
    case 'lines': {
      const list = Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : [];
      return list.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
    }
    case 'list':
      return undefined;
  }
}

/** An item of a nested list: each sub-field takes `entry[map["<list>.<sub>"] ?? <sub>]`. Null when a required one is missing. */
function readSub(fields: ApplyField[], map: Record<string, string>, entry: Item, prefix: string): Item | null {
  const item: Item = {};
  for (const field of fields) {
    const value = coerce(field, get(entry, map[`${prefix}${field.name}`] ?? field.name));
    if (blank(value)) {
      if (field.required) return null;
    } else item[field.name] = value;
  }
  return item;
}

/** One item of a target from a source record: field → `record[map[field]]` (a list field: the source list, its items read by sub-field). Null when a required field is missing. */
function readItem(fields: ApplyField[], map: Record<string, string>, record: Item): Item | null {
  const item: Item = {};
  for (const field of fields) {
    const source = map[field.name];
    let value: unknown;
    if (!source) value = undefined;
    else if (field.type === 'list') {
      const entries = get(record, source);
      value = Array.isArray(entries) ? entries.flatMap((entry) => (entry && typeof entry === 'object' ? [readSub(field.fields ?? [], map, entry as Item, `${field.name}.`)] : [])).filter((sub) => sub !== null) : [];
    } else value = coerce(field, get(record, source));
    if (blank(value)) {
      if (field.required) return null;
    } else item[field.name] = value;
  }
  return item;
}

/** Items to apply from a node output, by the target's shape; `skipped` counts items missing a required field. */
export function applyItems(fn: ApplyFunctionName, params: ApplyParams, output: Item): { items: Item[]; skipped: number } {
  const target = APPLY_TARGETS[fn];
  const fields = target.fields as readonly ApplyField[] as ApplyField[];
  const records: Item[] = target.shape === 'list' ? ((get(output, params.list) as unknown[]) ?? []).filter((entry): entry is Item => !!entry && typeof entry === 'object' && !Array.isArray(entry)) : [output];
  const items: Item[] = [];
  let skipped = 0;
  for (const record of records) {
    const item = readItem(fields, params.map, record);
    if (item) items.push(item);
    else skipped++;
  }
  return { items, skipped };
}

const first = (value: unknown) => (Array.isArray(value) ? (value[0] as string | undefined) : (value as string | undefined));
const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();

interface Context {
  tx: Tx;
  input: FunctionInput;
  params: ApplyParams;
  run: typeof s.runs.$inferSelect | undefined;
  write: AiWrite;
}

/** A proposal's input item for a knowledge list: the item without fields the tool does not take. */
const without = (item: Item, ...names: string[]): Item => Object.fromEntries(Object.entries(item).filter(([key]) => !names.includes(key)));

/** What each target does: the tool input it files, and how it writes now. Line targets get one item. */
interface Handler {
  /** The tool's input for these items, or null when nothing is left to propose. For a `line` target it is one entry of `list`. */
  propose(items: Item[], context: Context): { input: Record<string, unknown>; kept?: number } | null;
  /** Written now; the counts it reports. */
  write(items: Item[], context: Context): Record<string, unknown>;
}

const knowledgeOf = (tx: Tx, projectId: string) => ({
  characters: tx.select({ name: s.characters.name, aliases: s.characters.aliases, status: s.characters.status }).from(s.characters).where(eq(s.characters.projectId, projectId)).all(),
});

/** Targets that write the item itself (shape `line`): one item per visit. */
type ItemTarget = 'saveCandidate' | 'tagLines' | 'setListener' | 'saveTermEntry';
const HANDLERS: Record<Exclude<ApplyFunctionName, ItemTarget>, Handler> = {
  saveTerms: {
    propose: (items) => ({
      input: {
        terms: items.map((item) => {
          const kind = TERM_KINDS.includes(item.kind as never) ? TERM_KIND_LABELS[item.kind as keyof typeof TERM_KIND_LABELS] : '';
          const label = [kind, item.meaning, item.note].filter((part) => typeof part === 'string' && part).join(' · ');
          return { source: item.source, target: item.target ?? '', note: label, status: item.target ? 'confirmed' : 'candidate' };
        }),
      },
    }),
    write: (items, { tx, write }) => aiSaveTerms(tx, write, items as never),
  },
  saveCharacters: {
    propose(items, { tx, input }) {
      // Creating a name that is already stored is refused by the tool (and would undo the whole batch): they are left out.
      const known = new Set(knowledgeOf(tx, input.projectId).characters.flatMap((c) => [c.name, ...c.aliases].map(lower)));
      const fresh = items.filter((item) => ![item.name, ...((item.aliases as string[]) ?? [])].some((name) => known.has(lower(name))));
      return fresh.length ? { input: { characters: fresh.map((item) => characterInput(item)) }, kept: items.length - fresh.length } : null;
    },
    write: (items, { tx, write }) => aiSaveCharacters(tx, write, items as never),
  },
  saveRelationships: {
    propose(items, { tx, input }) {
      const people = tx.select().from(s.characters).where(eq(s.characters.projectId, input.projectId)).all();
      const idOf = (name: unknown) => people.find((c) => [c.name, ...c.aliases].some((alias) => lower(alias) === lower(name)))?.id;
      const stored = tx.select().from(s.relationships).where(eq(s.relationships.projectId, input.projectId)).all();
      const out: Item[] = [];
      for (const item of items) {
        const fromId = idOf(item.from);
        const toId = idOf(item.to);
        const pair = fromId && toId ? stored.filter((rel) => rel.fromId === fromId && rel.toId === toId && rel.status !== 'rejected') : [];
        const changes = ((item.changes as Item[]) ?? []).map((change) => ({ at: first(change.at), change: change.change, cause: change.cause ?? '' })).filter((change) => change.at && change.change);
        // A pair already stored: new changes are added to it; otherwise nothing is proposed. (An unresolved name is still proposed: accept the characters first.)
        if (pair.length) {
          const fresh = changes.filter((change) => !pair.some((rel) => rel.changes.some((known) => known.at === change.at)));
          if (fresh.length) out.push({ id: pair[0].id, changes: [...pair[0].changes, ...fresh] });
          continue;
        }
        out.push({ ...without(item, 'changes'), ...(changes.length ? { changes } : {}) });
      }
      return out.length ? { input: { relationships: out } } : null;
    },
    write: (items, { tx, write }) => {
      const mapped = items.map((item) => ({ ...item, changes: ((item.changes as Item[]) ?? []).map((change) => ({ at: first(change.at), change: change.change as string, cause: change.cause as string })) }));
      const { unresolved, ...counts } = aiSaveRelationships(tx, write, mapped as never);
      return { ...counts, ...(unresolved.length ? { unresolved } : {}) };
    },
  },
  saveSpeechRules: {
    propose(items, { tx, input }) {
      const stored = tx.select().from(s.speechRules).where(eq(s.speechRules.projectId, input.projectId)).all();
      const fresh = items
        .map((item): Item => ({ ...without(item, 'startKey'), startKey: first(item.startKey) ?? null }))
        .filter((item) => (SPEECH_LEVELS as readonly string[]).includes(item.level as string))
        .filter((item) => !stored.some((rule) => lower(rule.fromName) === lower(item.fromName) && lower(rule.toName) === lower(item.toName) && rule.startKey === item.startKey && rule.level === item.level));
      return fresh.length ? { input: { speechRules: fresh }, kept: items.length - fresh.length } : null; // a level the tool does not know is left out too
    },
    write: (items, { tx, write }) => {
      const { skipped, ...counts } = aiSaveSpeechRules(tx, write, items.map((item) => ({ ...item, startKey: first(item.startKey) ?? null })) as never);
      return { ...counts, ...(skipped.length ? { skipped } : {}) };
    },
  },
  saveEvents: {
    propose(items, { tx, input }) {
      const titles = new Set(tx.select({ title: s.storyEvents.title }).from(s.storyEvents).where(eq(s.storyEvents.projectId, input.projectId)).all().map((event) => lower(event.title)));
      const fresh = items.filter((item) => !titles.has(lower(item.title)));
      return fresh.length ? { input: { events: fresh }, kept: items.length - fresh.length } : null;
    },
    write: (items, { tx, write }) => aiSaveEvents(tx, write, items as never),
  },
  saveDocument: {
    propose(items, { tx, input }) {
      const [item] = items;
      if (!item) return null;
      // Same title: the proposal changes that document (the tool updates by id), as the write does for AI drafts.
      const old = tx.select({ id: s.documents.id, title: s.documents.title, status: s.documents.status }).from(s.documents).where(eq(s.documents.projectId, input.projectId)).all().find((doc) => lower(doc.title) === lower(item.title) && doc.status !== 'rejected');
      const kind = DOCUMENT_KINDS.includes(item.kind as never) ? item.kind : undefined;
      return { input: { ...(old ? { id: old.id } : {}), title: item.title, body: item.body, ...(kind ? { kind } : {}), ...(item.evidence ? { evidence: item.evidence } : {}) } };
    },
    write: (items, { tx, write }) => ({ document: items[0] ? aiSaveDocument(tx, write, items[0] as never) : 'none' }),
  },
  saveSceneListeners: {
    propose: (items) => ({
      input: {
        scenes: items.map((item) => ({
          ...item,
          exceptions: ((item.exceptions as Item[]) ?? []).map((exception) => ({ ...exception, line: first(exception.line) })).filter((exception) => exception.line),
        })),
      },
    }),
    write: (items, { tx, input }) =>
      aiSetSceneListeners(tx, input.projectId, items.map((item) => ({ ...item, exceptions: ((item.exceptions as Item[]) ?? []).map((exception) => ({ ...exception, line: first(exception.line) ?? '' })) })) as never),
  },
};

/** A character as the save tool takes it: an enum value it does not know is left out (the tool's default 'unknown' stays), so one odd answer does not undo the batch. */
function characterInput(item: Item) {
  const known = (values: readonly string[], value: unknown) => (values.includes(value as string) ? value : undefined);
  const { gender, ageBand, role, ...rest } = item;
  return { ...rest, ...(known(GENDERS, gender) ? { gender } : {}), ...(known(AGE_BANDS, ageBand) ? { ageBand } : {}), ...(known(CHARACTER_ROLES, role) ? { role } : {}) };
}

/** The apply node's run row and AI-confirm policy for direct writes (as candidates when asked: ✦). */
const policyOf = (tx: Tx, projectId: string, asCandidate: boolean): AiConfirm =>
  asCandidate ? { terms: 'candidate', documents: 'candidate', characters: 'candidate', relationships: 'candidate', events: 'candidate', speechRules: 'candidate' } : aiConfirmOf(tx as unknown as Db, projectId);

/**
 * Topics an apply node's writes reach, for the runner to notify (it does not know the node's `propose`
 * setting there, so each lists both the proposal and the direct write). The run's own `units` come anyway.
 */
export const APPLY_TOPICS: Record<ApplyFunctionName, Topic[]> = {
  saveCandidate: ['proposals'],
  setListener: ['proposals'],
  tagLines: ['proposals'],
  saveTermEntry: ['proposals', 'terms'],
  saveTerms: ['proposals', 'terms'],
  saveCharacters: ['proposals', 'knowledge'],
  saveRelationships: ['proposals', 'knowledge'],
  saveSpeechRules: ['proposals', 'knowledge'],
  saveEvents: ['proposals', 'knowledge'],
  saveDocument: ['proposals', 'knowledge'],
  saveSceneListeners: ['proposals'],
};

function run(fn: ApplyFunctionName, tx: Tx, raw: unknown, input: FunctionInput): FunctionResult {
  const params = applyParams.parse(raw);
  const target = APPLY_TARGETS[fn];
  const missing = (target.fields as readonly ApplyField[]).filter((field) => field.required && !params.map[field.name]);
  if (!params.fromNodeId || missing.length || (target.shape === 'list' && !params.list))
    throw new Error(`'${target.label}' 노드의 가져올 노드와 필드 연결이 비어 있습니다.`);
  const output = input.item.data.outputs?.[params.fromNodeId];
  if (!output) return { port: 'out', output: { applied: false, reason: '가져올 노드의 결과가 이 대사에 없습니다.' } };
  // A batch's answer rides on its first line; the others have nothing to apply (H7).
  if (target.shape !== 'line' && (output as { batchLeader?: boolean }).batchLeader === false) return { port: 'out', output: { batchSkipped: true } };

  const { items, skipped } = applyItems(fn, params, output);
  if (!items.length) return { port: 'out', output: { applied: false, items: 0, skipped, reason: skipped ? '필수 필드가 비어 있어 건너뛰었습니다.' : '반영할 항목이 없습니다.' } };
  const context: Context = {
    tx,
    input,
    params,
    run: tx.select().from(s.runs).where(eq(s.runs.id, input.runId)).get(),
    write: { projectId: input.projectId, runId: input.runId, policy: policyOf(tx, input.projectId, params.asCandidate) },
  };
  const nodeId = input.item.nodeId;
  const base = { projectId: input.projectId, runId: input.runId, nodeId };

  if (fn === 'saveTermEntry') return runTerm(context, items[0], base);
  if (fn === 'saveCandidate' || fn === 'setListener' || fn === 'tagLines') return runLine(fn, context, items[0], base);

  const handler = HANDLERS[fn];
  if (params.propose) {
    const proposal = handler.propose(items, context);
    if (!proposal) return { port: 'out', output: { proposed: false, items: items.length, reason: '이미 있는 항목이라 제안할 것이 없습니다.' } };
    const filed = fileRunProposal(tx, { ...base, tool: target.tool, input: proposal.input });
    return { port: 'out', output: { proposed: true, proposalId: filed.id, items: items.length, ...(skipped ? { skipped } : {}), ...(proposal.kept ? { alreadyStored: proposal.kept } : {}) } };
  }
  return { port: 'out', output: { applied: true, items: items.length, ...(skipped ? { skipped } : {}), ...handler.write(items, context) } };
}

/** The line targets: one line per visit, so a proposal collects the run's lines (services/proposals.ts addToRunProposal). */
function runLine(fn: 'saveCandidate' | 'setListener' | 'tagLines', context: Context, item: Item, base: { projectId: string; runId: string; nodeId: string }): FunctionResult {
  const { tx, input, params, run: runRow } = context;
  const target = APPLY_TARGETS[fn];
  const unit = lineOf(input);
  if (fn === 'saveCandidate') {
    const text = item.text as string;
    if (params.propose) {
      addToRunProposal(tx, { ...base, tool: target.tool, input: { origin: 'ai' } }, 'changes', { key: unit.key, translation: text });
      return { port: 'out', candidate: text, output: { proposed: true } };
    }
    const candidateId = addCandidate(tx, { unitId: unit.id, text, origin: 'ai', runId: input.runId, nodeId: base.nodeId });
    // 후보(✦)로 넣기: the candidate only; the translation column stays.
    if (params.asCandidate || !runRow) return { port: 'out', candidate: text, output: { applied: false, candidateId, asCandidate: true } };
    const { applied } = applyRunCandidate(tx, runRow, unit.id, candidateId, text);
    return { port: 'out', candidate: text, output: { applied, candidateId }, ...(!applied ? { issues: [HUMAN_OWNED_NOTE] } : {}) };
  }
  if (fn === 'setListener') {
    // "unknown" (or nothing) is the AI saying it cannot tell: the line stays 청자 미상.
    const listener = typeof item.listener === 'string' ? item.listener.trim() : '';
    if (!listener || listener === UNKNOWN_LISTENER) return { port: 'out', output: { recorded: false, reason: '청자 미상' } };
    const entry = { key: unit.key, listener, confidence: (item.confidence as number | undefined) ?? 1 };
    if (params.propose) {
      addToRunProposal(tx, { ...base, tool: target.tool, input: {} }, 'lines', entry);
      return { port: 'out', output: { proposed: true } };
    }
    const result = aiSetLineListeners(tx, input.projectId, [entry]);
    return { port: 'out', output: { recorded: result.set === 1, listener: entry.listener, confidence: entry.confidence, ...(result.skipped[0] ? { reason: result.skipped[0].reason } : {}) } };
  }
  // tagLines: the line tag named like the value; a name that is no line tag does nothing, tags are never created here.
  const name = item.tag as string;
  if (params.propose) {
    addToRunProposal(tx, { ...base, tool: target.tool, input: { origin: 'ai' } }, 'changes', { key: unit.key, addTags: [name] });
    return { port: 'out', output: { proposed: true } };
  }
  const tag = tx.select({ id: s.tags.id, name: s.tags.name, role: s.tags.role, scope: s.tags.scope }).from(s.tags).where(eq(s.tags.projectId, input.projectId)).all().find((candidate) => lower(candidate.name) === lower(name) && tagScope(candidate).includes('lines'));
  if (!tag) return { port: 'out', output: { tagged: false, reason: '같은 이름의 대사 태그가 없습니다.' } };
  attachUnitTags(tx, input.projectId, [unit.id], { add: [tag.id] }, { onMisplaced: 'skip' });
  return { port: 'out', output: { tagged: true, tag: tag.name } };
}

/**
 * 용어 표기 저장: the term's Korean form and note from the answer. With onlyEmpty (default) a term a
 * person (or an earlier answer) already gave a form is left as it is; a proposal collects the run's terms.
 */
function runTerm(context: Context, item: Item, base: { projectId: string; runId: string; nodeId: string }): FunctionResult {
  const { tx, input, params } = context;
  if (input.subject !== 'terms') throw new Error('용어 표기 저장은 용어 워크플로에서만 쓸 수 있습니다.');
  const current = tx.select().from(s.terms).where(eq(s.terms.id, input.term.id)).get();
  if (!current) return { port: 'out', output: { applied: false, reason: '용어가 없습니다.' } };
  const target = typeof item.target === 'string' ? item.target.trim() : '';
  if (!target) return { port: 'out', output: { applied: false, reason: '표기가 비어 있습니다.' } };
  if (params.onlyEmpty && current.target.trim()) return { port: 'out', output: { applied: false, reason: '이미 표기가 있습니다.' } };
  const kind = typeof item.kind === 'string' && (TERM_KINDS as readonly string[]).includes(item.kind) ? TERM_KIND_LABELS[item.kind as (typeof TERM_KINDS)[number]] : '';
  const note = [kind, item.meaning, item.note].filter((part): part is string => typeof part === 'string' && Boolean(part.trim())).join(' · ') || current.note;
  if (params.propose) {
    addToRunProposal(tx, { ...base, tool: APPLY_TARGETS.saveTermEntry.tool, input: {} }, 'terms', { id: current.id, target, note });
    return { port: 'out', candidate: target, output: { proposed: true } };
  }
  tx.update(s.terms).set({ target, note, origin: 'ai', statusBy: 'ai', runId: input.runId }).where(eq(s.terms.id, current.id)).run();
  return { port: 'out', candidate: target, output: { applied: true } };
}

export const applyFunctions = Object.fromEntries(APPLY_FUNCTION_NAMES.map((fn) => [fn, (tx: Tx, raw: unknown, input: FunctionInput) => run(fn, tx, raw, input)])) as Record<ApplyFunctionName, (tx: Tx, raw: unknown, input: FunctionInput) => FunctionResult>;
