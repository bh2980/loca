import { eq } from 'drizzle-orm';
import { get } from 'es-toolkit/compat';
import { AGE_BANDS, APPLY_FUNCTION_NAMES, APPLY_TARGETS, applyParams, DOCUMENT_KINDS, ISSUE_KIND_IDS, ISSUE_KINDS, issueKindOf, previousStepId, tagLinesParams, tagScope, type IssueKind, aiStatus, TERM_KIND_LABELS, TERM_KINDS, UNKNOWN_LISTENER, withMainTarget, withSourceEdges, withTargetCandidate, type ApplyField, type ApplyFunctionName, type ApplyParams } from '@tw/shared';
import type { Db } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import type { Topic } from '../../events.ts';
import { aiSaveCharacters, aiSaveDocument, aiSaveEvents, aiSaveRelationships, relationshipRows, aiSaveSpeechRules, aiSaveTerms, aiSaveUnresolvedPairs, aiSetLineListeners, type AiWrite } from '../../services/ai-knowledge.ts';
import { addCandidate } from '../../services/candidates.ts';
import { aiAutoConfirmOf } from '../../services/status-by.ts';
import { setKnowledgeTag } from '../../services/knowledge-tags.ts';
import { applyIssueTags } from '../../services/issue-tags.ts';
import { attachUnitTags } from '../../services/tag-scope.ts';
import { applyRunCandidate, HUMAN_OWNED_NOTE } from '../apply-candidate.ts';
import { lineOf, type FunctionInput, type FunctionResult } from './types.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Item = Record<string, unknown>;

/**
 * 반영 노드: put a node's output into the project now, through services/ai-knowledge.ts (AI origin;
 * nothing a person set is changed). Knowledge and terms land confirmed or as candidates as the
 * project's AI 문맥 switch says (aiAutoConfirm).
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

/** The entries of a list field read by its sub-fields, each taking `entry[map["<path>.<sub>"] ?? <sub>]` (deeper lists by the whole path). Entries missing a required sub-field are left out. */
function readEntries(field: ApplyField, entries: unknown, map: Record<string, string>, prefix: string): Item[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => (entry && typeof entry === 'object' ? [readSub(field.fields ?? [], map, entry as Item, prefix)] : [])).filter((sub): sub is Item => sub !== null);
}

/** An item of a nested list: null when a required sub-field is missing. */
function readSub(fields: ApplyField[], map: Record<string, string>, entry: Item, prefix: string): Item | null {
  const item: Item = {};
  for (const field of fields) {
    const source = get(entry, map[`${prefix}${field.name}`] ?? field.name);
    const value = field.type === 'list' ? readEntries(field, source, map, `${prefix}${field.name}.`) : coerce(field, source);
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
    const value = !source ? undefined : field.type === 'list' ? readEntries(field, get(record, source), map, `${field.name}.`) : coerce(field, get(record, source));
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
  /** The previous step's result the items were read from. */
  output: Item;
}

/** 관계 저장's "확인 못 한 쌍": the entries of the output's list that params.unresolved names. */
const unresolvedPairsOf = (params: ApplyParams, output: Item): { between: string[]; reason: string; kind: string }[] => {
  if (!params.unresolved) return [];
  const list = get(output, params.unresolved);
  return (Array.isArray(list) ? list : []).flatMap((entry) =>
    entry && typeof entry === 'object' ? [{ between: coerce({ name: 'between', label: '', type: 'strings' }, (entry as Item).between) as string[], reason: coerce({ name: 'reason', label: '', type: 'string' }, (entry as Item).reason) as string, kind: coerce({ name: 'kind', label: '', type: 'string' }, (entry as Item).kind) as string }] : [],
  );
};

/** 인물 저장's "사람이 아닌 이름": the entries of the output's list that params.notPeople names. */
const notPeopleOf = (params: ApplyParams, output: Item): { name: string; reason: string }[] => {
  if (!params.notPeople) return [];
  const list = get(output, params.notPeople);
  return (Array.isArray(list) ? list : []).flatMap((entry) =>
    entry && typeof entry === 'object' ? [{ name: coerce({ name: 'name', label: '', type: 'string' }, (entry as Item).name) as string, reason: coerce({ name: 'reason', label: '', type: 'string' }, (entry as Item).reason) as string }] : [],
  );
};

/** How each list target writes its items; the counts it reports. Line targets get one item. */
interface Handler {
  write(items: Item[], context: Context): Record<string, unknown>;
}

/** Targets that write the item itself (shape `line`): one item per visit. */
type ItemTarget = 'saveCandidate' | 'tagLines' | 'setListener';
const HANDLERS: Record<Exclude<ApplyFunctionName, ItemTarget>, Handler> = {
  saveTerms: {
    write: (items, { tx, write }) => aiSaveTerms(tx, write, items as never),
  },
  saveCharacters: {
    write: (items, { tx, write, params, output }) => aiSaveCharacters(tx, write, items as never, notPeopleOf(params, output)),
  },
  saveRelationships: {
    write: (items, { tx, write, params, output }) => {
      const pairs = items.map((item) => ({
        views: ((item.views as Item[]) ?? []).map((view) => ({ ...view, changes: ((view.changes as Item[]) ?? []).map((change) => ({ at: first(change.at), kind: change.kind as string, cause: change.cause as string })) })),
      }));
      const { unresolved, ...counts } = aiSaveRelationships(tx, write, relationshipRows(pairs as never));
      const without = unresolvedPairsOf(params, output);
      const noRelationship = without.length ? aiSaveUnresolvedPairs(tx, write, without) : null;
      return {
        ...counts,
        ...(unresolved.length ? { unresolved } : {}),
        ...(noRelationship && { unresolvedPairs: { added: noRelationship.added, kept: noRelationship.kept, ...(noRelationship.notPerson && { notPerson: noRelationship.notPerson }), dropped: noRelationship.dropped.length }, ...(noRelationship.dropped.length ? { droppedPairs: noRelationship.dropped } : {}) }),
      };
    },
  },
  saveSpeechRules: {
    write: (items, { tx, write }) => {
      const { skipped, ...counts } = aiSaveSpeechRules(tx, write, items.map((item) => ({ ...item, startKey: first(item.startKey) ?? null })) as never);
      return { ...counts, ...(skipped.length ? { skipped } : {}) };
    },
  },
  saveEvents: {
    write: (items, { tx, write }) => aiSaveEvents(tx, write, items as never),
  },
  saveDocument: {
    write: (items, { tx, write }) => ({ document: items[0] ? aiSaveDocument(tx, write, items[0] as never) : 'none' }),
  },
};

/** Topics an apply node's writes reach besides the run's own `units`, for the runner to notify. */
export const APPLY_TOPICS: Record<ApplyFunctionName, Topic[]> = {
  saveCandidate: ['terms'],
  setListener: [],
  tagLines: ['terms'],
  saveTerms: ['terms'],
  saveCharacters: ['knowledge'],
  saveRelationships: ['knowledge'],
  saveSpeechRules: ['knowledge'],
  saveEvents: ['knowledge'],
  saveDocument: ['knowledge'],
};

function run(fn: ApplyFunctionName, tx: Tx, raw: unknown, input: FunctionInput): FunctionResult {
  if (fn === 'tagLines') return runTags(tx, raw, input);
  const params = applyParams.parse(raw);
  const target = APPLY_TARGETS[fn];
  const missing = (target.fields as readonly ApplyField[]).filter((field) => field.required && !params.map[field.name]);
  if (missing.length || (target.shape === 'list' && !params.list)) throw new Error(`'${target.label}' 노드의 필드 연결이 비어 있습니다.`);
  const run = tx.select().from(s.runs).where(eq(s.runs.id, input.runId)).get();
  // The result of the step before this node on the item's way here (the AI or script node it is drawn after).
  const from = run && previousStepId(run.definition, input.item.data.path);
  const output = from ? input.item.data.outputs?.[from] : undefined;
  if (!output) return { port: 'out', output: { applied: false, reason: '앞 단계의 결과가 이 대사에 없습니다.' } };
  // A batch's answer rides on its first line; the others have nothing to apply (H7).
  if (target.shape !== 'line' && (output as { batchLeader?: boolean }).batchLeader === false) return { port: 'out', output: { batchSkipped: true } };

  const { items, skipped } = applyItems(fn, params, output);
  const hasUnresolved = (fn === 'saveRelationships' && unresolvedPairsOf(params, output).length > 0) || (fn === 'saveCharacters' && notPeopleOf(params, output).length > 0);
  if (!items.length && !hasUnresolved) return { port: 'out', output: { applied: false, items: 0, skipped, reason: skipped ? '필수 필드가 비어 있어 건너뛰었습니다.' : '반영할 항목이 없습니다.' } };
  const context: Context = {
    tx,
    input,
    params,
    run,
    write: { projectId: input.projectId, runId: input.runId, autoConfirm: aiAutoConfirmOf(tx as unknown as Db, input.projectId) },
    output,
  };
  const nodeId = input.item.nodeId;
  const base = { projectId: input.projectId, runId: input.runId, nodeId };

  if (input.subject === 'terms' && fn === 'saveCandidate') return runTerm(context, items[0]);
  if (fn === 'saveCandidate' || fn === 'setListener') return runLine(fn, context, items[0], base);

  return { port: 'out', output: { applied: true, items: items.length, ...(skipped ? { skipped } : {}), ...HANDLERS[fn].write(items, context) } };
}

/** The line targets: one line per visit. */
function runLine(fn: 'saveCandidate' | 'setListener', context: Context, item: Item, base: { projectId: string; runId: string; nodeId: string }): FunctionResult {
  const { tx, input, run: runRow } = context;
  const unit = lineOf(input);
  if (fn === 'saveCandidate') {
    // The model's text without its edges, with the source's: a lost trailing newline is not a format error.
    const text = withSourceEdges(unit.source, item.text as string);
    const candidateId = addCandidate(tx, { unitId: unit.id, text, origin: 'ai', runId: input.runId, nodeId: base.nodeId });
    if (!runRow) return { port: 'out', candidate: text, output: { applied: false, candidateId } };
    const { applied } = applyRunCandidate(tx, runRow, unit.id, candidateId, text);
    return { port: 'out', candidate: text, output: { applied, candidateId }, ...(!applied ? { issues: [HUMAN_OWNED_NOTE] } : {}) };
  }
  // setListener: "unknown" (or nothing) is the AI saying it cannot tell: the line stays 청자 미상.
  const listener = typeof item.listener === 'string' ? item.listener.trim() : '';
  if (!listener || listener === UNKNOWN_LISTENER) return { port: 'out', output: { recorded: false, reason: '청자 미상' } };
  const entry = { key: unit.key, listener, confidence: (item.confidence as number | undefined) ?? 1 };
  const result = aiSetLineListeners(tx, input.projectId, [entry]);
  return { port: 'out', output: { recorded: result.set === 1, listener: entry.listener, confidence: entry.confidence, ...(result.skipped[0] ? { reason: result.skipped[0].reason } : {}) } };
}

/**
 * 태그 붙이기 / 떼기, the only node that adds or removes tags in a workflow (checks and reviews only
 * judge). The tags: the ones picked in the pane, 문제 유형 picked or all of them, and the previous
 * step's result field `map.tag` (tag names, or problem-type ids/names such as a review's `categories`).
 * A problem type is created in the project the first time it is put on; any other name must match an
 * existing tag that can go on this kind of item. Terms take term tags only.
 */
function runTags(tx: Tx, raw: unknown, input: FunctionInput): FunctionResult {
  const params = tagLinesParams.parse(raw);
  const add = params.action === 'add';
  const scope = input.subject === 'lines' ? 'lines' : 'terms';
  const fixed = params.tagIds.length > 0 || params.kinds.length > 0 || params.allKinds;
  const names: string[] = [];
  if (params.map.tag) {
    const run = tx.select({ definition: s.runs.definition }).from(s.runs).where(eq(s.runs.id, input.runId)).get();
    const from = run && previousStepId(run.definition, input.item.data.path);
    const output = from ? input.item.data.outputs?.[from] : undefined;
    if (!output && !fixed) return { port: 'out', output: { tagged: false, reason: '앞 단계의 결과가 이 항목에 없습니다.' } };
    if (output) names.push(...(coerce({ name: 'tag', label: '', type: 'strings' }, get(output, params.map.tag)) as string[]));
  } else if (!fixed) throw new Error(`'태그 붙이기' 노드에 ${add ? '붙일' : '뗄'} 태그가 없습니다.`);

  const tags = tx.select({ id: s.tags.id, name: s.tags.name, role: s.tags.role, scope: s.tags.scope }).from(s.tags).where(eq(s.tags.projectId, input.projectId)).all().filter((tag) => tagScope(tag).includes(scope));
  const kinds = new Set<IssueKind>(input.subject === 'lines' ? [...params.kinds, ...(params.allKinds ? ISSUE_KIND_IDS : [])] : []);
  const tagIds = new Set(params.tagIds.filter((id) => tags.some((tag) => tag.id === id)));
  const unmatched: string[] = [];
  for (const name of names) {
    const kind = input.subject === 'lines' ? issueKindOf(name) : undefined;
    const tag = tags.find((candidate) => lower(candidate.name) === lower(name));
    if (kind) kinds.add(kind);
    else if (tag) tagIds.add(tag.id);
    else unmatched.push(name);
  }
  const named = [...[...kinds].map((kind) => ISSUE_KINDS[kind].name), ...tags.filter((tag) => tagIds.has(tag.id)).map((tag) => tag.name)];
  if (!named.length) return { port: 'out', output: { tagged: false, action: params.action, reason: unmatched.length ? `같은 이름의 ${scope === 'lines' ? '대사' : '용어'} 태그가 없습니다.` : `${add ? '붙일' : '뗄'} 태그가 없습니다.` } };

  if (input.subject === 'lines') {
    if (kinds.size) applyIssueTags(tx, input.projectId, input.unit.id, add ? { add: [...kinds] } : { clear: [...kinds] });
    if (tagIds.size) attachUnitTags(tx, input.projectId, [input.unit.id], add ? { add: [...tagIds] } : { remove: [...tagIds] }, { onMisplaced: 'skip' });
  } else for (const id of tagIds) setKnowledgeTag(tx, input.projectId, 'terms', [input.term.id], id, add);
  return { port: 'out', output: { tagged: true, action: params.action, tags: named } };
}

/** 번역 저장 on a term: its Korean form and note (a form a person saved is kept). */
function runTerm(context: Context, item: Item): FunctionResult {
  const { tx, input } = context;
  if (input.subject !== 'terms') throw new Error('용어 워크플로가 아닙니다.');
  const current = tx.select().from(s.terms).where(eq(s.terms.id, input.term.id)).get();
  if (!current) return { port: 'out', output: { applied: false, reason: '용어가 없습니다.' } };
  const target = typeof item.text === 'string' ? item.text.trim() : '';
  if (!target) return { port: 'out', output: { applied: false, reason: '번역이 비어 있습니다.' } };
  // A person's form stays the main one; the AI's is kept among the term's candidates.
  if (current.statusBy === 'human' && current.target.trim() && current.target !== target) {
    tx.update(s.terms).set({ targetCandidates: withTargetCandidate(current, target) }).where(eq(s.terms.id, current.id)).run();
    return { port: 'out', candidate: target, output: { applied: false }, issues: [HUMAN_OWNED_NOTE] };
  }
  const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim() : current.note;
  // A candidate that gets its form lands as the AI 문맥 switch says; a term already decided keeps its status.
  const status = current.status === 'candidate' ? aiStatus(context.write.autoConfirm) : current.status;
  tx.update(s.terms).set({ ...withMainTarget(current, target), note, status, origin: 'ai', statusBy: 'ai', runId: input.runId }).where(eq(s.terms.id, current.id)).run();
  return { port: 'out', candidate: target, output: { applied: true } };
}

export const applyFunctions = Object.fromEntries(APPLY_FUNCTION_NAMES.map((fn) => [fn, (tx: Tx, raw: unknown, input: FunctionInput) => run(fn, tx, raw, input)])) as Record<ApplyFunctionName, (tx: Tx, raw: unknown, input: FunctionInput) => FunctionResult>;
