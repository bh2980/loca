import { and, eq, inArray, ne } from 'drizzle-orm';
import { batchChangeSchema, type BatchChange, type RunCardPlan, INPUT_TYPES } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { DELETABLE, deletable, type DeletableKind } from './item-delete.ts';
import { inChunks } from '../db/chunk.ts';
import { preflight } from '../engine/preflight.ts';
import { planOf, type RunModelInput } from './run-plan.ts';
import { resolveRunStart } from './start-run.ts';
import { normalizeBatch, validateBatch, type BatchReport } from './script-query.ts';

/** Lines checked per step; the event loop is handed back in between (a 50k-line check takes about a second). */
const CHECK_CHUNK = 500;

/**
 * normalizeBatch + validateBatch over a whole batch, CHECK_CHUNK lines at a time, so checking a
 * whole game never holds up other requests. Revs are filled in. A key repeated anywhere is an error.
 */
export async function checkBatch(db: Db, projectId: string, input: BatchChange) {
  const changes: BatchChange['changes'] = [];
  const unchanged: string[] = [];
  const report: BatchReport = { total: input.changes.length, changes: 0, conflicts: [], errors: [], warnings: [] };
  const seen = new Set<string>();
  for (let start = 0; start < input.changes.length; start += CHECK_CHUNK) {
    const part = input.changes.slice(start, start + CHECK_CHUNK).filter((change) => {
      if (!seen.has(change.key)) return seen.add(change.key);
      report.errors.push({ key: change.key, reason: '같은 키가 두 번 나옵니다.' });
      return false;
    });
    const normalized = normalizeBatch(db, projectId, { ...input, changes: part }, { fillRev: true });
    unchanged.push(...normalized.unchanged);
    if (normalized.batch.changes.length) {
      const checked = validateBatch(db, projectId, normalized.batch);
      report.changes += checked.changes;
      report.conflicts.push(...checked.conflicts);
      report.errors.push(...checked.errors);
      report.warnings.push(...checked.warnings);
      changes.push(...normalized.batch.changes);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { batch: { ...input, changes }, unchanged, report };
}

/** What a batch of line changes came to when it was checked, as `loca import` reports it. */
export type BatchCheck = BatchReport & { unchanged: number };

/**
 * What a tool's check makes of a change before it becomes a proposal: the input to store (trimmed to
 * what can be applied) and what was left out, or why nothing can be proposed. `empty`: there is nothing
 * to change, which is not a mistake of the caller's. `batch`: a line batch's full report.
 */
export type Prepared =
  | { ok: true; input: Record<string, unknown>; report: s.ProposalReport | null; batch?: BatchCheck }
  | { ok: false; error: string; hint?: string; empty?: true; batch?: BatchCheck };
/** A tool definition's `check` member (agent-tools.ts). */
export type ToolCheck = (input: Record<string, unknown>) => Prepared | Promise<Prepared>;
/** A refusal as the agent reads it: what went wrong plus how to fix it (ids and tool names the person does not need to see). */
export const refusalText = (refused: { error: string; hint?: string }) => [refused.error, refused.hint].filter(Boolean).join(' ');
/** Nothing to check beyond the input's shape. */
export const unchecked = (input: Record<string, unknown>): Prepared => ({ ok: true, input, report: null });

type ScopedTable = typeof s.characters | typeof s.relationships | typeof s.speechRules | typeof s.storyEvents | typeof s.documents | typeof s.workflows | typeof s.groups | typeof s.units | typeof s.runs;
/** A change that names a row by id (`field`) is refused at once when the project has no such row, and the agent hears why. */
export const needsRow = (db: Db, projectId: string, table: ScopedTable, field: string, what: string): ToolCheck => (input) => {
  const id = input[field];
  if (typeof id === 'string' && id && !db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.projectId, projectId))).get()) return { ok: false, error: `없는 ${what}입니다.`, hint: `(${field}=${id}) 목록 도구로 id를 확인하세요.` };
  return unchecked(input);
};

/** A run is checked as it would start (unknown names, an empty scope), and its card gets what it would take in and cost. */
export async function checkStartRun(db: Db, projectId: string, input: Record<string, unknown>): Promise<Prepared> {
  const known = needsRow(db, projectId, s.workflows, 'workflowId', '워크플로')(input) as Prepared;
  if (!known.ok) return known;
  try {
    // The tool's input as start_run takes it: the workflow, this run's models by name and its caps apart from the scope as asked.
    const { workflowId, models, limits: _limits, ...asked } = input as { workflowId: string; models?: RunModelInput; limits?: unknown };
    const resolved = resolveRunStart(db, { workflowId, projectId, scope: { asked }, namedModels: models });
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const plan = planOf((await preflight(db, resolved.workflow, resolved.scope)) as unknown as RunCardPlan);
    return { ok: true, input, report: { dropped: [], warnings: [], run: { input: resolved.subject, plan } } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Ids that are not there are left out and reported; none left is a refusal. */
export function checkDeleteItems(db: Db, projectId: string, input: Record<string, unknown>): Prepared {
  const kind = input.kind as DeletableKind;
  if (!DELETABLE[kind]) return { ok: false, error: `지울 수 없는 종류입니다: ${String(input.kind)}` };
  const { ids, missing } = deletable(db, projectId, kind, (input.ids as string[] | undefined) ?? []);
  const dropped = missing.map((key) => ({ key, reason: `없는 ${DELETABLE[kind].what}입니다.` }));
  if (!ids.length) return { ok: false, error: `지울 수 있는 ${DELETABLE[kind].what}이(가) 없습니다.`, hint: dropped.length ? `예: ${dropped[0].key} ${dropped[0].reason} 목록 도구로 id를 확인하세요.` : undefined };
  return { ok: true, input: { ...input, ids }, report: dropped.length ? { dropped, warnings: [] } : null };
}

/** One missing item refuses the whole change. */
export function checkTagItems(db: Db, projectId: string, input: Record<string, unknown>): Prepared {
  const tables = { terms: s.terms, characters: s.characters, relationships: s.relationships, speechRules: s.speechRules, events: s.storyEvents, documents: s.documents } as const;
  const table = tables[input.kind as keyof typeof tables];
  const ids = (input.ids as string[] | undefined) ?? [];
  if (!table) return { ok: false, error: `태그를 붙일 수 없는 종류입니다: ${String(input.kind)}` };
  const found = new Set(inChunks(ids, (slice) => db.select({ id: table.id }).from(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).all()).map((row) => row.id));
  const missing = ids.filter((itemId) => !found.has(itemId));
  if (missing.length) return { ok: false, error: `없는 항목이 ${missing.length}개 있습니다.`, hint: `없는 id: ${missing.slice(0, 5).join(', ')}. 목록 도구로 id를 확인하세요.` };
  return unchecked(input);
}

/** A missing id refuses the change; a source already in the glossary is left out and reported. */
export function checkSaveTerms(db: Db, projectId: string, input: Record<string, unknown>): Prepared {
  const ids = ((input.terms as { id?: string }[] | undefined) ?? []).flatMap((term) => (term.id ? [term.id] : []));
  const found = new Set(ids.length ? db.select({ id: s.terms.id }).from(s.terms).where(and(eq(s.terms.projectId, projectId), inArray(s.terms.id, ids))).all().map((row) => row.id) : []);
  const missing = ids.filter((termId) => !found.has(termId));
  if (missing.length) return { ok: false, error: `없는 용어가 ${missing.length}개 있습니다.`, hint: `없는 id: ${missing.slice(0, 5).join(', ')}. list_terms로 id를 확인하세요.` };
  // A source already in the glossary (or twice in this call) is refused here, as saveTerm would on acceptance; the rest go on.
  const taken = new Map(db.select({ id: s.terms.id, source: s.terms.source, target: s.terms.target }).from(s.terms).where(and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'))).all().map((term) => [term.source.toLowerCase(), term] as const));
  const inputTerms = (input.terms as { id?: string; source?: string }[] | undefined) ?? [];
  const dropped: { key: string; reason: string }[] = [];
  const kept = inputTerms.filter((term) => {
    // An edit that leaves the source as it is has nothing to collide with.
    if (term.source === undefined) return true;
    const holder = taken.get(term.source.trim().toLowerCase());
    if (holder && holder.id !== term.id) {
      dropped.push({ key: term.source, reason: holder.id.startsWith('new:') ? '같은 요청에 두 번 나옵니다.' : `이미 있는 용어입니다: ${holder.source}${holder.target ? ` → ${holder.target}` : ''}` });
      return false;
    }
    taken.set(term.source.trim().toLowerCase(), { id: term.id ?? `new:${term.source}`, source: term.source, target: '' });
    return true;
  });
  if (!kept.length) return { ok: false, error: `저장할 수 있는 용어가 없습니다. 예: ${dropped[0]!.key} ${dropped[0]!.reason}` };
  return { ok: true, input: { ...input, terms: kept }, report: dropped.length ? { dropped, warnings: [] } : null };
}

/**
 * A batch of line changes keeps the lines that can change, fills in missing revs (so a line edited
 * before acceptance is skipped, not overwritten) and reports what it left out and the warnings about the rest.
 */
export async function checkLineBatch(db: Db, projectId: string, input: Record<string, unknown>): Promise<Prepared> {
  const parsed = batchChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `입력이 맞지 않습니다: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
  const { batch, unchanged, report: checked } = await checkBatch(db, projectId, parsed.data);
  const full: BatchCheck = { ...checked, total: parsed.data.changes.length, unchanged: unchanged.length };
  if (!batch.changes.length && !checked.errors.length) return { ok: false, error: '바뀌는 내용이 없습니다(모두 지금과 같습니다).', empty: true, batch: full };
  const dropped = [...checked.errors, ...checked.conflicts];
  const bad = new Set(dropped.map((entry) => entry.key));
  const changes = batch.changes.filter((change) => !bad.has(change.key));
  if (!changes.length) return { ok: false, error: `바꿀 수 있는 줄이 없습니다. 예: ${dropped[0].key} ${dropped[0].reason}`, empty: true, batch: full };
  const report = dropped.length || checked.warnings.length ? { dropped, warnings: checked.warnings } : null;
  return { ok: true, input: { ...batch, changes }, report, batch: full };
}

/** What the agent is told about a proposal the check trimmed. */
export const reportText = (report: s.ProposalReport | null) =>
  (report?.dropped.length ? ` 오류·충돌로 ${report.dropped.length}줄을 뺐습니다(예: ${report.dropped[0].key} ${report.dropped[0].reason}).` : '') +
  (report?.run ? ` 대상은 ${report.run.plan.lines.total.toLocaleString()}${INPUT_TYPES[report.run.input].unit}입니다.` : '');
