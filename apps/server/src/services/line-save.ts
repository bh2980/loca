import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { eachChunk } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { applyIssueTags } from './issue-tags.ts';
import { addCandidate } from './candidates.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Unit = Pick<typeof s.units.$inferSelect, 'id' | 'projectId' | 'translation' | 'statusId'>;

/**
 * The one way a person's (or an accepted proposal's) change reaches a line's text and status
 * (docs/DESIGN.md 3.5). Text, the candidate it came from and the status are written together in
 * the caller's transaction, so a save can never leave the text in a candidate and the line empty.
 * The editor, the line pane, same-source apply, the CLI/agent batch and bulk status changes all
 * come here; there is no other writer of `units.translation` for people (workflows write through
 * engine/apply-candidate.ts).
 */
export interface LineSave {
  /** New text. An existing candidate with exactly this text is selected instead of adding one. */
  text?: string;
  /** Use this candidate of the line as the text. */
  candidateId?: string;
  statusId?: string;
  /** 확인함: a person looked; the status stays but is theirs now. */
  checked?: boolean;
  /**
   * The translation the change was made from (what the editor showed when typing began). When the
   * line has changed since and the new text is something else, the save is refused rather than
   * overwrite what another window, a run or an earlier save wrote.
   */
  base?: string | null;
  origin?: 'human' | 'ai' | 'import';
  model?: string | null;
  note?: string;
}

/** The line changed after the editor took its text; the save would overwrite it. */
export class LineConflict extends Error {
  constructor() {
    super('이 줄의 번역이 그사이 다른 곳에서 바뀌었습니다. 바뀐 내용을 확인하고 다시 저장하세요.');
  }
}

export function saveLine(tx: Tx, unit: Unit, save: LineSave): Partial<typeof s.units.$inferInsert> {
  const current = unit.translation ?? '';
  let text = save.text;
  let candidateId: string | undefined;
  if (save.candidateId) {
    const candidate = tx.select().from(s.candidates).where(and(eq(s.candidates.id, save.candidateId), eq(s.candidates.unitId, unit.id))).get();
    if (!candidate) throw new Error('후보를 찾을 수 없습니다.');
    text = candidate.text;
    candidateId = candidate.id;
  }
  const patch: Partial<typeof s.units.$inferInsert> = {};
  if (text !== undefined) {
    if (save.base !== undefined && (save.base ?? '') !== current && text !== current) throw new LineConflict();
    if (text !== current || candidateId) {
      // The same text twice (a double click, a resent save) is one candidate, not two.
      candidateId ??= addCandidate(tx, { unitId: unit.id, text, origin: save.origin ?? 'human', model: save.model ?? null, note: save.note, reuseSame: true });
      patch.translation = text;
      patch.candidateId = candidateId;
    }
  }
  const textChanged = patch.translation !== undefined && patch.translation !== current;
  if (save.statusId) patch.statusId = save.statusId;
  else if (textChanged && text!.trim()) {
    const started = startedStatus(tx, unit.projectId, unit.statusId);
    if (started) patch.statusId = started;
  }
  // The problem-type tags described the old text.
  if (textChanged) applyIssueTags(tx, unit.projectId, unit.id, { clear: 'all' });
  if (patch.statusId || textChanged || save.checked) Object.assign(patch, { statusBy: 'human', statusRunId: null });
  if (Object.keys(patch).length) tx.update(s.units).set(patch).where(eq(s.units.id, unit.id)).run();
  return patch;
}

/** A status (or 확인함) for many lines at once: the same rule as saveLine without text. */
export function saveStatuses(tx: Tx, projectId: string, unitIds: string[], save: { statusId?: string; checked?: boolean }) {
  if (!save.statusId && !save.checked) return;
  const patch = { ...(save.statusId && { statusId: save.statusId }), statusBy: 'human' as const, statusRunId: null };
  // Chunked: a selection can be a whole project, and SQLite caps bound variables per statement.
  eachChunk(unitIds, (slice) => tx.update(s.units).set(patch).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).run());
}

/**
 * A line that gets its first text while it is still in an initial status (미번역) has started:
 * it moves to the first ordinary status that is not a review inbox (초벌), so its badge and the
 * scene's progress say so. Null when the line is past its initial status or there is no such status.
 */
function startedStatus(tx: Tx, projectId: string, statusId: string): string | null {
  const current = tx.select({ kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.id, statusId)).get();
  if (current?.kind !== 'initial') return null;
  return tx.select({ id: s.statuses.id }).from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'normal'), eq(s.statuses.inReview, false))).orderBy(asc(s.statuses.sort)).get()?.id ?? null;
}
