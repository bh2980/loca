import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { projectSlice, type RouteSlice } from './route-slice.ts';

/**
 * 이음새 점검 (docs/DESIGN.md J2c): from the second route on, the translator only has to check the
 * places where the route's new lines hand back into lines of an earlier route. For one seam this
 * gathers the current route's last lines before it (the new side) and the first lines after it (the
 * earlier side). Only graph edges are followed; nothing is guessed.
 */
const LINES = 2;

export interface SeamLine {
  unitId: string;
  key: string;
  groupId: string;
  speaker: string | null;
  source: string;
  translation: string | null;
}
export type SeamCheckState = 'checked' | 'stale';
export interface SeamCounts {
  checked: number;
  stale: number;
  total: number;
}
export interface SeamDetail {
  nodeId: string;
  /** The current route's last lines before the seam, one entry per way in (parallel arms enter the same block). */
  before: { from: string; lines: SeamLine[] }[];
  /** The first lines from the seam on: lines of an earlier route. */
  after: SeamLine[];
  /** Hash of the involved lines' ids and translations; what a check is stored against. */
  sig: string;
  /** The stored check, with whether the lines still read as they did. */
  check: { at: string; state: SeamCheckState } | null;
}

/** The seam blocks of the slice, each once. */
export const seamNodes = (slice: RouteSlice) => [...new Set(slice.seams.map((seam) => seam.nodeId))];

/** The unit ids on each way into the seam and after it; null when `nodeId` is not a seam of the slice. */
export function seamLines(slice: RouteSlice, nodeId: string): { before: { from: string; unitIds: string[] }[]; after: string[] } | null {
  const entries = slice.seams.filter((seam) => seam.nodeId === nodeId);
  if (!entries.length) return null;
  const blocks = new Map(slice.blocks.map((block) => [block.id, block]));
  const pathInto = new Map<string, string[]>();
  const pathOut = new Map<string, string[]>();
  for (const edge of slice.edges) {
    if (edge.kind !== 'path') continue;
    pathInto.set(edge.to, [...(pathInto.get(edge.to) ?? []), edge.from]);
    pathOut.set(edge.from, [...(pathOut.get(edge.from) ?? []), edge.to]);
  }
  // Back from the entering block, through blocks without lines, while the way is single.
  const tail = (start: string) => {
    const ids: string[] = [];
    const seen = new Set<string>();
    let at: string | undefined = start;
    while (at && !seen.has(at) && ids.length < LINES) {
      seen.add(at);
      const block = blocks.get(at);
      // Only the round's new lines: an earlier route's block is not '이번 길의 새 줄'.
      if (!block || block.earlier) break;
      ids.unshift(...block.unitIds.slice(-(LINES - ids.length)));
      const before: string[] = pathInto.get(at) ?? [];
      at = before.length === 1 ? before[0] : undefined;
    }
    return ids.slice(-LINES);
  };
  // After the seam: its own lines, then on along a single way while it has fewer than two.
  const after: string[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined = nodeId; at && !seen.has(at) && after.length < LINES; ) {
    seen.add(at);
    after.push(...(blocks.get(at)?.unitIds ?? []).slice(0, LINES - after.length));
    const next: string[] = pathOut.get(at) ?? [];
    at = next.length === 1 ? next[0] : undefined;
  }
  return { before: entries.map((seam) => ({ from: seam.from, unitIds: tail(seam.from) })), after };
}

const involved = (found: NonNullable<ReturnType<typeof seamLines>>) => [...found.before.flatMap((entry) => entry.unitIds), ...found.after];

/** What a check is stored against: the involved lines in order, with their translations. */
export function seamSignature(unitIds: string[], translations: Map<string, string | null>) {
  const ids = [...new Set(unitIds)];
  return createHash('sha1').update(JSON.stringify(['seam', ids.map((id) => [id, translations.get(id) ?? ''])])).digest('hex').slice(0, 16);
}

const unitRows = (db: Db, ids: string[]) =>
  new Map(
    (ids.length
      ? db.select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation }).from(s.units).where(inArray(s.units.id, ids)).all()
      : []
    ).map((row) => [row.id, row]),
  );

const stateOf = (stored: { sig: string }, sig: string): SeamCheckState => (stored.sig === sig ? 'checked' : 'stale');

/** The seam with the lines on both sides, or null when `nodeId` is not a seam of the project's current slice. */
export function seamDetail(db: Db, projectId: string, nodeId: string): SeamDetail | null {
  const found = seamLines(projectSlice(db, projectId), nodeId);
  if (!found) return null;
  const rows = unitRows(db, [...new Set(involved(found))]);
  const line = (unitId: string): SeamLine => {
    const row = rows.get(unitId);
    return { unitId, key: row?.key ?? '', groupId: row?.groupId ?? '', speaker: row?.speaker ?? null, source: row?.source ?? '', translation: row?.translation ?? null };
  };
  const sig = seamSignature(involved(found), new Map([...rows].map(([id, row]) => [id, row.translation])));
  const stored = db.select({ checks: s.projects.joinChecks }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.checks?.[nodeId];
  return {
    nodeId,
    before: found.before.map((entry) => ({ from: entry.from, lines: entry.unitIds.map(line) })),
    after: found.after.map(line),
    sig,
    check: stored ? { at: stored.at, state: stateOf(stored, sig) } : null,
  };
}

/** The checked seams of the current slice with their state (seams nobody checked are not listed), and the counts for the round. */
export function seamStates(db: Db, projectId: string): { checks: Record<string, { at: string; state: SeamCheckState }>; seamChecks: SeamCounts } {
  const slice = projectSlice(db, projectId);
  const seams = seamNodes(slice);
  const stored = db.select({ checks: s.projects.joinChecks }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.checks ?? {};
  const marked = seams.filter((id) => stored[id]);
  const found = marked.map((id) => [id, seamLines(slice, id)!] as const);
  const rows = unitRows(db, [...new Set(found.flatMap(([, f]) => involved(f)))]);
  const translations = new Map([...rows].map(([id, row]) => [id, row.translation]));
  const checks = Object.fromEntries(found.map(([id, f]) => [id, { at: stored[id]!.at, state: stateOf(stored[id]!, seamSignature(involved(f), translations)) }]));
  const states = Object.values(checks);
  return { checks, seamChecks: { checked: states.filter((item) => item.state === 'checked').length, stale: states.filter((item) => item.state === 'stale').length, total: seams.length } };
}
