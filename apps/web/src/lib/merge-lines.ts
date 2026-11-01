/** Why a line shows in a pair's 근거 대사 tab: a rule applies to it (말투 적용), or an item cites it (근거). */
export type LineReason = 'applied' | 'evidence';

export interface LineSource<L> {
  reason: LineReason;
  /** The lines, in the order they should read (script order for a rule's lines, the item's order for its evidence). */
  lines: readonly L[];
  /** What the source adds to each of its lines (the speech level a rule asks for). */
  note?: string;
}

export interface MergedLine<L> {
  line: L;
  /** Each reason once, 말투 적용 before 근거. */
  reasons: LineReason[];
  /** The sources' notes, each once, in the order they came. */
  notes: string[];
}

const ORDER: LineReason[] = ['applied', 'evidence'];

/**
 * The lines of several sources as one list with each line once (by id): a line both governed by a rule and cited
 * as evidence shows a single time, carrying both reasons. Lines keep the order they first appear in.
 */
export function mergeLines<L extends { id: string }>(sources: readonly LineSource<L>[]): MergedLine<L>[] {
  const byId = new Map<string, MergedLine<L>>();
  for (const source of sources)
    for (const line of source.lines) {
      const merged = byId.get(line.id) ?? { line, reasons: [], notes: [] };
      if (!merged.reasons.includes(source.reason)) merged.reasons = ORDER.filter((reason) => reason === source.reason || merged.reasons.includes(reason));
      if (source.note && !merged.notes.includes(source.note)) merged.notes.push(source.note);
      byId.set(line.id, merged);
    }
  return [...byId.values()];
}
