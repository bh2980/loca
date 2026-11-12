import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { eachChunk, inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { addCandidate } from './candidates.ts';
import { assertProjectRefs } from './project-refs.ts';
import { badRequest, found } from '../http-errors.ts';
import { sameTranslation, withSourceWhitespace, type LineTranslate } from '@tw/shared';
import { cleanListener, setHumanListener } from './listeners.ts';
import { attachUnitTags } from './tag-scope.ts';
import { sameSource } from './line-marks.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'>;
type Unit = Pick<typeof s.units.$inferSelect, 'id' | 'projectId' | 'source' | 'translation' | 'statusId' | 'candidateId' | 'updatedAt'>;

// ── rev: the one concurrency convention ─────────────────────────────────────────

/**
 * A line's rev: its row's updated_at in ms, raised by every write to the row. Every reader hands it out (the browser's
 * row, find_lines, export) and every write made from a view of the line sends it back (the editor's save, same-source
 * apply, a batch, decide_suggestion): a different rev now means the line changed since it was read.
 */
export const revOf = (unit: { updatedAt: Date }) => unit.updatedAt.getTime();
/** Whether the line changed after `rev` was read. Without a rev the write was not made from a view of the line. */
export const isStale = (unit: { updatedAt: Date }, rev: number | undefined) => rev !== undefined && rev !== revOf(unit);
/** What every surface says when it refuses to write over a line changed since it was read. */
export const LINE_CHANGED = '읽은 뒤에 다른 곳에서 바뀐 줄입니다. 바뀐 내용을 확인하고 다시 저장하세요.';
/** The line changed after the writer read it; the write would overwrite that change. */
export class LineConflict extends Error {
  constructor() {
    super(LINE_CHANGED);
  }
}

// ── status: the one writer ──────────────────────────────────────────────────────

/** Who sets a status: a person, an agent's change a permission mode applied (ai), or a run (ai, by that run). */
export interface StatusSetter {
  statusBy: 'human' | 'ai';
  runId?: string | null;
}
export const FINAL_NEEDS_TEXT = '완료 상태에는 번역이 있어야 합니다.';
const blank = (translation: string | null | undefined) => !(translation ?? '').trim();
const statusKind = (db: Reader, projectId: string, statusId: string) => db.select({ kind: s.statuses.kind }).from(s.statuses).where(and(eq(s.statuses.id, statusId), eq(s.statuses.projectId, projectId))).get()?.kind;

/**
 * Why a line with this translation may not be in the status, or null. The rules of a line's status, said once: it is
 * one of the project's statuses, and a final status needs a translation. setLineStatus refuses with it; a check that
 * reports per line (a batch) asks it directly.
 */
export function statusRefusal(db: Reader, projectId: string, statusId: string, translation: string | null | undefined): string | null {
  const kind = statusKind(db, projectId, statusId);
  if (!kind) return '이 프로젝트에 없는 상태입니다.';
  return kind === 'final' && blank(translation) ? FINAL_NEEDS_TEXT : null;
}

/**
 * The one writer of a line's status: a person's save, a bulk change, an accepted proposal and a run's exit action all
 * set it here, so the rules (statusRefusal) hold whoever asks. Refused (400) for all the lines when one of them may
 * not be in the status; nothing is written then. `writing`: the translation the same save gives the line (one line),
 * which the rule reads instead of the stored one.
 */
export function setLineStatus(tx: Tx, projectId: string, unitIds: readonly string[], statusId: string, by: StatusSetter, writing?: { text: string }) {
  const kind = statusKind(tx, projectId, statusId);
  if (!kind) badRequest('이 프로젝트에 없는 상태입니다.');
  if (kind === 'final') {
    const empty = writing ? blank(writing.text) : inChunks(unitIds, (slice) => tx.select({ translation: s.units.translation }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).all()).some((line) => blank(line.translation));
    if (empty) badRequest(FINAL_NEEDS_TEXT);
  }
  // Chunked: a selection can be a whole project, and SQLite caps bound variables per statement.
  eachChunk(unitIds, (slice) => tx.update(s.units).set({ statusId, statusBy: by.statusBy, statusRunId: by.runId ?? null }).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).run());
}

/** 확인함: a person looked at the lines; their statuses stay, and are theirs now. */
function markChecked(tx: Tx, projectId: string, unitIds: readonly string[], by: StatusSetter) {
  eachChunk(unitIds, (slice) => tx.update(s.units).set({ statusBy: by.statusBy, statusRunId: by.runId ?? null }).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).run());
}

// ── text and status of one line ─────────────────────────────────────────────────

/**
 * The one way a person's (or an accepted proposal's) change reaches a line's text and status.
 * Text, the candidate it came from and the status are written together in
 * the caller's transaction, so a save can never leave the text in a candidate and the line empty.
 * The editor, the line pane, same-source apply, the CLI/agent batch and decide_suggestion all
 * come here; there is no other writer of `units.translation` for people (workflows write through
 * engine/apply-candidate.ts).
 */
export interface LineSave {
  /** New text. An existing candidate with exactly this text is selected instead of adding one. */
  text?: string;
  /** Use this candidate of the line as the text. */
  candidateId?: string;
  statusId?: string;
  /** The line's rev when the change was made from it (revOf). A save that would change a line changed since is refused (LineConflict). */
  rev?: number;
  /** The person chose their own text over a change made meanwhile (내 수정 유지): the saved text's note says what it was kept over. */
  keepMine?: boolean;
  origin?: 'human' | 'ai' | 'import';
  /** Who decided the text or status: a person (default), or AI for a change the terminal's permission mode applied. */
  statusBy?: 'human' | 'ai';
  model?: string | null;
  note?: string;
}

/** What a 내 수정 유지 save kept the person's text over: the run that changed the line, or a change made meanwhile. */
function keptNote(db: Reader, candidateId: string | null) {
  const replaced = candidateId ? db.select({ runId: s.candidates.runId }).from(s.candidates).where(eq(s.candidates.id, candidateId)).get() : undefined;
  const run = replaced?.runId ? db.select({ name: s.runs.workflowName }).from(s.runs).where(eq(s.runs.id, replaced.runId)).get() : undefined;
  return run ? `실행 '${run.name}'에서 바뀐 번역 대신 내 수정을 유지함` : '그사이 바뀐 번역 대신 내 수정을 유지함';
}

/** `unit` must be the row as it is now (read in this transaction, or just before it). */
export function saveLine(tx: Tx, unit: Unit, save: LineSave): void {
  assertProjectRefs(tx, unit.projectId, { statusId: save.statusId, candidateId: save.candidateId });
  const current = unit.translation ?? '';
  let text = save.text;
  let candidateId: string | undefined;
  if (save.candidateId) {
    const candidate = tx.select().from(s.candidates).where(and(eq(s.candidates.id, save.candidateId), eq(s.candidates.unitId, unit.id))).get();
    if (!candidate) throw new Error('후보를 찾을 수 없습니다.');
    text = candidate.text;
    candidateId = candidate.id;
  }
  // The source's leading and trailing whitespace, whatever the editor, an import or a candidate brought.
  if (text !== undefined) text = withSourceWhitespace(unit.source, text);
  // Another candidate with the same text is still a change of which text the line shows.
  const writesText = text !== undefined && (text !== current || (candidateId !== undefined && candidateId !== unit.candidateId));
  const textChanged = text !== undefined && text !== current;
  // A line that gets its first text while still in an initial status has started (startedStatus).
  const statusId = save.statusId ?? (textChanged && text!.trim() ? startedStatus(tx, unit.projectId, unit.statusId) : null) ?? undefined;
  // A new text is decided by whoever saved it, so the status it stands in is theirs too, set or not.
  const setsStatus = Boolean(statusId) || textChanged;
  if (!writesText && !setsStatus) return;
  if (isStale(unit, save.rev)) throw new LineConflict();
  const by: StatusSetter = { statusBy: save.statusBy ?? 'human' };
  // The status first: its rule is checked against the text this save gives the line, before anything is written.
  if (setsStatus) setLineStatus(tx, unit.projectId, [unit.id], statusId ?? unit.statusId, by, { text: text ?? current });
  if (writesText) {
    // The same text twice (a double click, a resent save) is one candidate, not two.
    candidateId ??= addCandidate(tx, { unitId: unit.id, text: text!, origin: save.origin ?? 'human', model: save.model ?? null, note: save.keepMine ? keptNote(tx, unit.candidateId) : save.note, reuseSame: true });
    tx.update(s.units).set({ translation: text, candidateId }).where(eq(s.units.id, unit.id)).run();
    // Taken: a suggestion that becomes the line's text is decided (and a declined one taken back is history again), and so is
    // one waiting with the same text (a person who put an AI 제안 into the box and saved it).
    const settled = [candidateId, ...tx.select({ id: s.candidates.id, text: s.candidates.text }).from(s.candidates).where(and(eq(s.candidates.unitId, unit.id), eq(s.candidates.state, 'pending'))).all().filter((row) => sameTranslation(row.text, text!)).map((row) => row.id)];
    tx.update(s.candidates).set({ state: 'history' }).where(inArray(s.candidates.id, settled)).run();
  }
}

/** A line of any project by id, saved in its own transaction (the app's editor); answers with what the line holds now. */
export function saveLineById(db: Db, unitId: string, save: LineSave) {
  const unit = found(db.select().from(s.units).where(eq(s.units.id, unitId)).get(), '대사');
  db.transaction((tx) => saveLine(tx, unit, save));
  return db.select({ translation: s.units.translation, statusId: s.units.statusId, candidateId: s.units.candidateId }).from(s.units).where(eq(s.units.id, unitId)).get()!;
}

/**
 * A line that gets its first text while it is still in an initial status (미번역) has started:
 * it moves to the first ordinary status that is not a review inbox (번역됨), so its badge and the
 * scene's progress say so. Null when the line is past its initial status or there is no such status.
 */
function startedStatus(tx: Tx, projectId: string, statusId: string): string | null {
  const current = tx.select({ kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.id, statusId)).get();
  if (current?.kind !== 'initial') return null;
  return tx.select({ id: s.statuses.id }).from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'normal'), eq(s.statuses.inReview, false))).orderBy(asc(s.statuses.sort)).get()?.id ?? null;
}

/**
 * One text for several lines at once (same-source apply, #49): each line goes through saveLine with
 * the rev it was shown at, in the caller's transaction. A line changed since is skipped rather
 * than overwritten or stopping the rest; the counts say what happened.
 */
export function saveSameText(tx: Tx, lines: { unit: Unit; rev: number | undefined }[], text: string) {
  let applied = 0;
  let skipped = 0;
  for (const { unit, rev } of lines) {
    try {
      saveLine(tx, unit, { text, rev });
      applied++;
    } catch (error) {
      if (!(error instanceof LineConflict)) throw error;
      skipped++;
    }
  }
  return { applied, skipped };
}

const SAME_SOURCE_MAX = 200;
/** A line of any project and the condition for the other lines of its project that share its source (case and end punctuation aside). */
function sameSourceOf(db: Db, unitId: string) {
  const unit = found(db.select({ id: s.units.id, projectId: s.units.projectId, source: s.units.source }).from(s.units).where(eq(s.units.id, unitId)).get(), '대사');
  return { unit, others: and(eq(s.units.projectId, unit.projectId), ne(s.units.id, unit.id), sql`${sameSource(sql`${s.units.source}`)} = ${sameSource(sql`${unit.source}`)}`, sql`${sameSource(sql`${unit.source}`)} != ''`) };
}

/** Other lines with the same source, translated or not, each with its rev: what a confirmed translation may be applied to (saveSameSource). */
export function sameSourceLines(db: Db, unitId: string) {
  const rows = db
    .select({ id: s.units.id, groupId: s.units.groupId, groupTitle: s.groups.title, translation: s.units.translation, speaker: s.units.speaker, listener: s.units.listener, kind: s.statuses.kind, updatedAt: s.units.updatedAt })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
    .where(sameSourceOf(db, unitId).others)
    .orderBy(asc(s.units.seq))
    .limit(SAME_SOURCE_MAX)
    .all();
  return rows.map(({ kind, updatedAt, ...row }) => ({ ...row, final: kind === 'final', rev: revOf({ updatedAt }) }));
}

/**
 * One translation for other lines with the same source as `unitId`, in one transaction. Only lines that really share
 * the source in the same project are written; one changed since it was shown, or not such a line, is skipped and counted.
 */
export function saveSameSource(db: Db, unitId: string, text: string, lines: { unitId: string; rev: number }[]) {
  const revs = new Map(lines.map((line) => [line.unitId, line.rev]));
  const rows = db.select().from(s.units).where(and(sameSourceOf(db, unitId).others, inArray(s.units.id, [...revs.keys()]))).all();
  const result = db.transaction((tx) => saveSameText(tx, rows.map((row) => ({ unit: row, rev: revs.get(row.id) })), text));
  return { applied: result.applied, skipped: result.skipped + (lines.length - rows.length) };
}

// ── what else a line holds ──────────────────────────────────────────────────────

/** A line's memo (a person's note on it); empty clears it. Who set the status is not touched. */
export function setLineMemo(tx: Pick<Db, 'update'>, projectId: string, unitIds: readonly string[], memo: string) {
  eachChunk(unitIds, (slice) => tx.update(s.units).set({ note: memo.trim() }).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).run());
}

/** 번역 제외 for lines: include / exclude whatever the project's rules say; null hands the lines back to the rules. */
export function setLineTranslate(tx: Pick<Db, 'update'>, projectId: string, unitIds: readonly string[], translate: LineTranslate | null) {
  eachChunk(unitIds, (slice) => tx.update(s.units).set({ translate }).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).run());
}

/** What a person sets on lines besides their text (the script list's bulk bar, a line's pane and menu). */
export interface LinePatch {
  statusId?: string;
  /** 확인함: the statuses stay, and are a person's now. */
  checked?: boolean;
  addTagIds?: readonly string[];
  removeTagIds?: readonly string[];
  /** The lines' tags, whole: these go on and every other tag comes off. */
  tagIds?: readonly string[];
  /** A person's listener (null = unknown); it replaces an AI's or an imported one. Dialogue only. */
  listener?: string | null;
  /** The lines' memo; empty clears it. */
  note?: string;
  translate?: LineTranslate | null;
}

/**
 * A person's change to lines of one project, all of it or none: status (setLineStatus), 확인함, tags (only where
 * their scope allows), listener, memo and 번역 제외. Every id it takes must be the project's.
 */
export function patchLines(db: Db, projectId: string, unitIds: readonly string[], patch: LinePatch) {
  assertProjectRefs(db, projectId, { unitIds, statusId: patch.statusId, tagIds: [...(patch.addTagIds ?? []), ...(patch.removeTagIds ?? []), ...(patch.tagIds ?? [])] });
  // Only dialogue has a listener: naming one where no picked line can take it is a mistake, not a no-op.
  if (cleanListener(patch.listener) !== null && !inChunks(unitIds, (slice) => db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.kind, 'dialogue'), inArray(s.units.id, slice))).limit(1).all()).length) badRequest('나레이션에는 청자가 없습니다.');
  const person: StatusSetter = { statusBy: 'human' };
  db.transaction((tx) => {
    // A person setting the status (or confirming what a run set) makes it theirs.
    if (patch.statusId) setLineStatus(tx, projectId, unitIds, patch.statusId, person);
    else if (patch.checked) markChecked(tx, projectId, unitIds, person);
    if (patch.tagIds) {
      const kept = new Set(patch.tagIds);
      const others = [...new Set(inChunks(unitIds, (slice) => tx.select({ tagId: s.unitTags.tagId }).from(s.unitTags).where(inArray(s.unitTags.unitId, slice)).all()).map((row) => row.tagId))].filter((id) => !kept.has(id));
      attachUnitTags(tx, projectId, [...unitIds], { add: [...patch.tagIds], remove: others }, { onMisplaced: 'refuse' });
    }
    if (patch.addTagIds?.length || patch.removeTagIds?.length) attachUnitTags(tx, projectId, [...unitIds], { add: [...(patch.addTagIds ?? [])], remove: [...(patch.removeTagIds ?? [])] }, { onMisplaced: 'refuse' });
    if (patch.listener !== undefined) setHumanListener(tx, unitIds, patch.listener);
    if (patch.note !== undefined) setLineMemo(tx, projectId, unitIds, patch.note);
    if (patch.translate !== undefined) setLineTranslate(tx, projectId, unitIds, patch.translate);
  });
}

/** patchLines for one line of any project, by id (a line's pane and menu). */
export function patchLineById(db: Db, unitId: string, patch: LinePatch) {
  const unit = found(db.select({ projectId: s.units.projectId }).from(s.units).where(eq(s.units.id, unitId)).get(), '대사');
  patchLines(db, unit.projectId, [unitId], patch);
}
