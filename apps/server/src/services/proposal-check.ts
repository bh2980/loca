import { and, eq, inArray } from 'drizzle-orm';
import { batchChangeSchema, type BatchChange } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
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

export type Prepared = { ok: true; input: Record<string, unknown>; report: s.ProposalReport | null } | { ok: false; error: string };

/** Change tools that edit an existing row when given its id, and where that row lives. */
const BY_ID: Record<string, { field: string; what: string; exists: (db: Db, projectId: string, id: string) => boolean }> = {};
const scoped =
  (table: typeof s.characters | typeof s.relationships | typeof s.speechRules | typeof s.storyEvents | typeof s.documents | typeof s.workflows | typeof s.groups | typeof s.units) =>
  (db: Db, projectId: string, id: string) =>
    Boolean(db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.projectId, projectId))).get());
for (const [tool, field, what, exists] of [
  ['save_character', 'id', '인물', scoped(s.characters)],
  ['save_relationship', 'id', '관계', scoped(s.relationships)],
  ['save_speech_rule', 'id', '말투 규칙', scoped(s.speechRules)],
  ['save_event', 'id', '사건', scoped(s.storyEvents)],
  ['save_document', 'id', '문서', scoped(s.documents)],
  ['save_workflow', 'id', '워크플로', scoped(s.workflows)],
  ['start_run', 'workflowId', '워크플로', scoped(s.workflows)],
  ['propose_translation', 'unitId', '대사', scoped(s.units)],
  ['save_group_summary', 'groupId', '장면', scoped(s.groups)],
] as const)
  BY_ID[tool] = { field, what, exists };

/**
 * The one check every proposal goes through when it is made (CLI import and tool calls, pi and
 * CLI chats), so the user decides on something that can be applied:
 * - a change to a row that does not exist is refused at once, and the agent hears why;
 * - a batch of line changes keeps the lines that can change, fills in missing revs (so a line
 *   edited before acceptance is skipped, not overwritten) and reports what it left out and the
 *   warnings about the rest.
 */
export async function prepareProposal(db: Db, projectId: string, tool: string, input: Record<string, unknown>): Promise<Prepared> {
  const byId = BY_ID[tool];
  const id = byId && input[byId.field];
  if (byId && typeof id === 'string' && id && !byId.exists(db, projectId, id)) return { ok: false, error: `없는 ${byId.what}입니다 (${byId.field}=${id}). 목록 도구로 id를 확인하세요.` };
  if (tool === 'save_terms') {
    const ids = ((input.terms as { id?: string }[] | undefined) ?? []).flatMap((term) => (term.id ? [term.id] : []));
    const found = new Set(ids.length ? db.select({ id: s.terms.id }).from(s.terms).where(and(eq(s.terms.projectId, projectId), inArray(s.terms.id, ids))).all().map((row) => row.id) : []);
    const missing = ids.filter((termId) => !found.has(termId));
    if (missing.length) return { ok: false, error: `없는 용어 id가 있습니다: ${missing.slice(0, 5).join(', ')}` };
  }
  if (tool !== 'propose_changes') return { ok: true, input, report: null };

  const parsed = batchChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `입력이 맞지 않습니다: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
  const { batch, report: checked } = await checkBatch(db, projectId, parsed.data);
  if (!batch.changes.length && !checked.errors.length) return { ok: false, error: '바뀌는 내용이 없습니다(모두 지금과 같습니다).' };
  const dropped = [...checked.errors, ...checked.conflicts];
  const bad = new Set(dropped.map((entry) => entry.key));
  const changes = batch.changes.filter((change) => !bad.has(change.key));
  if (!changes.length) return { ok: false, error: `바꿀 수 있는 줄이 없습니다. 예: ${dropped[0].key} ${dropped[0].reason}` };
  const report = dropped.length || checked.warnings.length ? { dropped, warnings: checked.warnings } : null;
  return { ok: true, input: { ...batch, changes }, report };
}

/** What the agent is told about a proposal the check trimmed. */
export const reportText = (report: s.ProposalReport | null) =>
  report?.dropped.length ? ` 오류·충돌로 ${report.dropped.length}줄을 뺐습니다(예: ${report.dropped[0].key} ${report.dropped[0].reason}).` : '';
