import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { applyIssueTags } from './issue-tags.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * What a person's change to a line writes (docs/DESIGN.md 3.5): the text, candidate or status they
 * set, and, when they set a status, wrote text or confirmed ('확인함') what a run had set, the line is
 * theirs now. With `unit` given, a changed translation also clears the problem-type tags, which
 * described the old text. `unit` is null for a change over many lines (no text then).
 */
export function humanLinePatch(
  tx: Tx,
  unit: { id: string; projectId: string; translation: string | null } | null,
  change: { translation?: string; candidateId?: string; statusId?: string; checked?: boolean },
): Partial<typeof s.units.$inferInsert> {
  const patch: Partial<typeof s.units.$inferInsert> = {};
  if (change.translation !== undefined) patch.translation = change.translation;
  if (change.candidateId !== undefined) patch.candidateId = change.candidateId;
  if (change.statusId) patch.statusId = change.statusId;
  if (unit && change.translation !== undefined && change.translation !== unit.translation) applyIssueTags(tx, unit.projectId, unit.id, { clear: 'all' });
  if (change.statusId || change.translation !== undefined || change.checked) Object.assign(patch, { statusBy: 'human', statusRunId: null });
  return patch;
}
