import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { applyIssueTags } from '../services/issue-tags.ts';
import { filtersByStatus } from '@tw/shared';

/** A person's saved translation a status-filtered run does not replace (#51); the same text the runner notes. */
export const HUMAN_OWNED_NOTE = '사람이 저장한 번역이 있어 바꾸지 않았습니다. AI 번역은 후보로 남겨 두었습니다.';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Run = typeof s.runs.$inferSelect;

/**
 * Writes a candidate a workflow produced straight into the line (#42): the
 * translation column is the produced text the moment it is made, set by AI. A run that picks lines
 * by status does not overwrite a translation a person saved after the run started (the #51 rule);
 * that line keeps its text and only gains the candidate. A changed translation clears the
 * problem-type tags that described the old text, so a node's own `issueTags` are applied after this.
 */
export function applyRunCandidate(tx: Tx, run: Run, unitId: string, candidateId: string, text: string): { applied: boolean } {
  const current = tx.select({ translation: s.units.translation, statusBy: s.units.statusBy }).from(s.units).where(eq(s.units.id, unitId)).get();
  if (personOwns(current, text, filtersByStatus(run.scope))) return { applied: false };
  const changed = current?.translation !== text;
  tx.update(s.units).set({ translation: text, candidateId, statusBy: 'ai', statusRunId: run.id }).where(eq(s.units.id, unitId)).run();
  if (changed) applyIssueTags(tx, run.projectId, unitId, { clear: 'all' });
  return { applied: true };
}

/**
 * The #51 rule in one place: a line whose translation a person saved (not empty, and not already the
 * run's text) belongs to them while the run picks lines by status. Used when a node writes text
 * (above) and when a set-status node would change the status (functions/index.ts).
 */
export function personOwns(current: { translation: string | null; statusBy: string | null } | undefined, text: string | undefined, filtered: boolean) {
  return filtered && current?.statusBy === 'human' && (current.translation ?? '').trim() !== '' && current.translation !== text;
}
