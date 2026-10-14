import { and, eq, inArray } from 'drizzle-orm';
import { needsListener } from '@tw/shared';
import { eachChunk } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

type Tx = Pick<Db, 'update' | 'select'>;

/** A listener name as stored: trimmed, and empty means unknown. */
export const cleanListener = (listener: string | null | undefined) => listener?.trim() || null;

/** A confidence as stored: within 0..1 (a missing or non-numeric one counts as 0). */
export const clampConfidence = (confidence: unknown) => (typeof confidence === 'number' && Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0);

/** Only dialogue has a listener. */
export const hasListener = (unit: { kind: string }) => unit.kind === 'dialogue';

/** Naming a listener for a line that has none (narration): refused by the paths that take one from outside. "Unknown" (null) is always fine. */
export const refusesListener = (unit: { kind: string }, listener: string | null | undefined) => !hasListener(unit) && cleanListener(listener) !== null;

/**
 * A person's listener for lines (null = unknown): replaces whatever was there. Dialogue only,
 * narration keeps none. Returns how many lines took it. `unitIds` must already be the project's.
 */
export function setHumanListener(tx: Tx, unitIds: readonly string[], listener: string | null) {
  let changed = 0;
  eachChunk(unitIds, (slice) => {
    changed += tx.update(s.units).set({ listener: cleanListener(listener), listenerOrigin: 'human', listenerConfidence: null }).where(and(eq(s.units.kind, 'dialogue'), inArray(s.units.id, slice))).run().changes;
  });
  return changed;
}

/**
 * An AI guess (`origin` 'ai' = for this line, 'scene' = the scene's default for the speaker). Never
 * over a person's listener or an imported one, and only on lines said to someone (needsListener:
 * not narration, not format tokens only), so the AI makes up no listener for the rest. Returns
 * whether it was stored.
 */
export function setAiListener(tx: Tx, unit: { id: string; projectId: string; kind: string; speaker: string | null; source: string; listener: string | null; listenerOrigin: string | null }, listener: string | null, confidence: number, origin: 'ai' | 'scene') {
  if (unit.listenerOrigin === 'human' || (unit.listenerOrigin === 'import' && unit.listener)) return false;
  const rules = tx.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, unit.projectId)).get()?.rules;
  if (!needsListener(unit, rules)) return false;
  tx.update(s.units).set({ listener: cleanListener(listener), listenerOrigin: origin, listenerConfidence: clampConfidence(confidence) }).where(eq(s.units.id, unit.id)).run();
  return true;
}
