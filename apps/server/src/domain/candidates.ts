import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface NewCandidate {
  unitId: string;
  text: string;
  origin: 'human' | 'ai' | 'tool' | 'import';
  model?: string | null;
  note?: string | null;
  /** The run and node that produced it (workflows only). */
  runId?: string;
  nodeId?: string;
  /** Pick an existing candidate of the line with exactly this text instead of adding one (a person's save: a double click is one candidate, not two). */
  reuseSame?: boolean;
  /** 'pending': an AI's translation waiting for a person to 적용 or 거절 it (the default is history). */
  state?: s.CandidateState;
}

/**
 * The one writer of `candidates` (#49): a person's save (line-save), the editor's AI translation
 * (editor-assist), the agent's propose_translation and a workflow node (runner) all add candidates
 * here. Whether the text then goes into the line is the caller's rule (saveLine, applyRunCandidate);
 * adding a candidate never touches `units`. Returns the candidate's id.
 */
export function addCandidate(db: Db | Tx, candidate: NewCandidate): string {
  if (candidate.reuseSame) {
    const same = db.select({ id: s.candidates.id }).from(s.candidates).where(and(eq(s.candidates.unitId, candidate.unitId), eq(s.candidates.text, candidate.text))).get();
    if (same) return same.id;
  }
  const { unitId, text, origin, model, note, runId, nodeId, state } = candidate;
  return db
    .insert(s.candidates)
    .values({ unitId, text, origin, model: model ?? null, runId, nodeId, ...(note != null && { note }), ...(state && { state }) })
    .returning({ id: s.candidates.id })
    .get().id;
}

/** A waiting suggestion turned down by a person: it stays in the line's history as declined. False when it is not one of the line's waiting suggestions. */
export function declineSuggestion(db: Db | Tx, unitId: string, candidateId: string): boolean {
  const row = db.select({ state: s.candidates.state }).from(s.candidates).where(and(eq(s.candidates.id, candidateId), eq(s.candidates.unitId, unitId))).get();
  if (row?.state !== 'pending') return false;
  db.update(s.candidates).set({ state: 'declined' }).where(eq(s.candidates.id, candidateId)).run();
  return true;
}
