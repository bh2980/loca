import { eq } from 'drizzle-orm';
import { get } from 'es-toolkit/compat';
import { AGE_BANDS, APPLY_FUNCTION_NAMES, APPLY_TARGETS, applyParams, DOCUMENT_KINDS, previousStepId, tagScope, aiStatus, TERM_KIND_LABELS, TERM_KINDS, UNKNOWN_LISTENER, type ApplyField, type ApplyFunctionName, type ApplyParams } from '@tw/shared';
import type { Db } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import type { Topic } from '../../events.ts';
import { aiSaveCharacters, aiSaveDocument, aiSaveEvents, aiSaveRelationships, aiSaveSpeechRules, aiSaveTerms, aiSetLineListeners, aiSetSceneListeners, type AiWrite } from '../../services/ai-knowledge.ts';
import { addCandidate } from '../../services/candidates.ts';
import { aiAutoConfirmOf } from '../../services/status-by.ts';
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

/** How each list target writes its items; the counts it reports. Line targets get one item. */
interface Handler {
  write(items: Item[], context: Context): Record<string, unknown>;
}

/** Targets that write the item itself (shape `line`): one item per visit. */
type ItemTarget = 'saveCandidate' | 'tagLines' | 'setListener' | 'saveTermEntry';
const HANDLERS: Record<Exclude<ApplyFunctionName, ItemTarget>, Handler> = {
  saveTerms: {
    write: (items, { tx, write }) => aiSaveTerms(tx, write, items as never),
  },
  saveCharacters: {
    write: (items, { tx, write }) => aiSaveCharacters(tx, write, items as never),
  },
  saveRelationships: {
    write: (items, { tx, write }) => {
      const mapped = items.map((item) => ({ ...item, changes: ((item.changes as Item[]) ?? []).map((change) => ({ at: first(change.at), change: change.change as string, cause: change.cause as string })) }));
      const { unresolved, ...counts } = aiSaveRelationships(tx, write, mapped as never);
      return { ...counts, ...(unresolved.length ? { unresolved } : {}) };
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
  saveCandidate: [],
  setListener: [],
  tagLines: [],
  saveTermEntry: ['terms'],
  saveTerms: ['terms'],
  saveCharacters: ['knowledge'],
  saveRelationships: ['knowledge'],
  saveSpeechRules: ['knowledge'],
  saveEvents: ['knowledge'],
  saveDocument: ['knowledge'],
};

function run(fn: ApplyFunctionName, tx: Tx, raw: unknown, input: FunctionInput): FunctionResult {
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
  if (!items.length) return { port: 'out', output: { applied: false, items: 0, skipped, reason: skipped ? '필수 필드가 비어 있어 건너뛰었습니다.' : '반영할 항목이 없습니다.' } };
  const context: Context = {
    tx,
    input,
    params,
    run,
    write: { projectId: input.projectId, runId: input.runId, autoConfirm: aiAutoConfirmOf(tx as unknown as Db, input.projectId) },
  };
  const nodeId = input.item.nodeId;
  const base = { projectId: input.projectId, runId: input.runId, nodeId };

  if (fn === 'saveTermEntry') return runTerm(context, items[0], base);
  if (fn === 'saveCandidate' || fn === 'setListener' || fn === 'tagLines') return runLine(fn, context, items[0], base);

  return { port: 'out', output: { applied: true, items: items.length, ...(skipped ? { skipped } : {}), ...HANDLERS[fn].write(items, context) } };
}

/** The line targets: one line per visit. */
function runLine(fn: 'saveCandidate' | 'setListener' | 'tagLines', context: Context, item: Item, base: { projectId: string; runId: string; nodeId: string }): FunctionResult {
  const { tx, input, params, run: runRow } = context;
  const target = APPLY_TARGETS[fn];
  const unit = lineOf(input);
  if (fn === 'saveCandidate') {
    const text = item.text as string;
    const candidateId = addCandidate(tx, { unitId: unit.id, text, origin: 'ai', runId: input.runId, nodeId: base.nodeId });
    if (!runRow) return { port: 'out', candidate: text, output: { applied: false, candidateId } };
    const { applied } = applyRunCandidate(tx, runRow, unit.id, candidateId, text);
    return { port: 'out', candidate: text, output: { applied, candidateId }, ...(!applied ? { issues: [HUMAN_OWNED_NOTE] } : {}) };
  }
  if (fn === 'setListener') {
    // "unknown" (or nothing) is the AI saying it cannot tell: the line stays 청자 미상.
    const listener = typeof item.listener === 'string' ? item.listener.trim() : '';
    if (!listener || listener === UNKNOWN_LISTENER) return { port: 'out', output: { recorded: false, reason: '청자 미상' } };
    const entry = { key: unit.key, listener, confidence: (item.confidence as number | undefined) ?? 1 };
    const result = aiSetLineListeners(tx, input.projectId, [entry]);
    return { port: 'out', output: { recorded: result.set === 1, listener: entry.listener, confidence: entry.confidence, ...(result.skipped[0] ? { reason: result.skipped[0].reason } : {}) } };
  }
  // tagLines: the line tag named like the value; a name that is no line tag does nothing, tags are never created here.
  const name = item.tag as string;
  const tag = tx.select({ id: s.tags.id, name: s.tags.name, role: s.tags.role, scope: s.tags.scope }).from(s.tags).where(eq(s.tags.projectId, input.projectId)).all().find((candidate) => lower(candidate.name) === lower(name) && tagScope(candidate).includes('lines'));
  if (!tag) return { port: 'out', output: { tagged: false, reason: '같은 이름의 대사 태그가 없습니다.' } };
  attachUnitTags(tx, input.projectId, [unit.id], { add: [tag.id] }, { onMisplaced: 'skip' });
  return { port: 'out', output: { tagged: true, tag: tag.name } };
}

/**
 * 용어 표기 저장: the term's Korean form and note from the answer. With onlyEmpty (default) a term a
 * person (or an earlier answer) already gave a form is left as it is.
 */
function runTerm(context: Context, item: Item, base: { projectId: string; runId: string; nodeId: string }): FunctionResult {
  const { tx, input, params } = context;
  if (input.subject !== 'terms') throw new Error('용어 표기 저장은 용어에만 쓸 수 있습니다.');
  const current = tx.select().from(s.terms).where(eq(s.terms.id, input.term.id)).get();
  if (!current) return { port: 'out', output: { applied: false, reason: '용어가 없습니다.' } };
  const target = typeof item.target === 'string' ? item.target.trim() : '';
  if (!target) return { port: 'out', output: { applied: false, reason: '표기가 비어 있습니다.' } };
  if (params.onlyEmpty && current.target.trim()) return { port: 'out', output: { applied: false, reason: '이미 표기가 있습니다.' } };
  const kind = typeof item.kind === 'string' && (TERM_KINDS as readonly string[]).includes(item.kind) ? TERM_KIND_LABELS[item.kind as (typeof TERM_KINDS)[number]] : '';
  const note = [kind, item.meaning, item.note].filter((part): part is string => typeof part === 'string' && Boolean(part.trim())).join(' · ') || current.note;
  // A candidate that gets its form lands as the AI 문맥 switch says; a term already decided keeps its status.
  const status = current.status === 'candidate' ? aiStatus(context.write.autoConfirm) : current.status;
  tx.update(s.terms).set({ target, note, status, origin: 'ai', statusBy: 'ai', runId: input.runId }).where(eq(s.terms.id, current.id)).run();
  return { port: 'out', candidate: target, output: { applied: true } };
}

export const applyFunctions = Object.fromEntries(APPLY_FUNCTION_NAMES.map((fn) => [fn, (tx: Tx, raw: unknown, input: FunctionInput) => run(fn, tx, raw, input)])) as Record<ApplyFunctionName, (tx: Tx, raw: unknown, input: FunctionInput) => FunctionResult>;
