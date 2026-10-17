import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { applyIssueTags } from '../services/issue-tags.ts';
import { filtersByStatus } from './functions/index.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Run = typeof s.runs.$inferSelect;

/**
 * Writes a candidate a workflow produced straight into the line (docs/DESIGN.md 3.5, #42): the
 * translation column is the produced text the moment it is made, set by AI. A run that picks lines
 * by status does not overwrite a translation a person saved after the run started (the #51 rule);
 * that line keeps its text and only gains the candidate. A changed translation clears the
 * problem-type tags that described the old text, so a node's own `issueTags` are applied after this.
 */
export function applyRunCandidate(tx: Tx, run: Run, unitId: string, candidateId: string, text: string): { applied: boolean } {
  const current = tx.select({ translation: s.units.translation, statusBy: s.units.statusBy }).from(s.units).where(eq(s.units.id, unitId)).get();
  const humanOwns = filtersByStatus(run.definition, run.scope) && current?.statusBy === 'human' && (current.translation ?? '').trim() !== '' && current.translation !== text;
  if (humanOwns) return { applied: false };
  const changed = current?.translation !== text;
  tx.update(s.units).set({ translation: text, candidateId, statusBy: 'ai', statusRunId: run.id }).where(eq(s.units.id, unitId)).run();
  if (changed) applyIssueTags(tx, run.projectId, unitId, { clear: 'all' });
  return { applied: true };
}
