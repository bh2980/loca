import { windowOf, type Overview } from './path-window';

/**
 * The path view's translation list (docs/DESIGN.md J2c, 길 번역 목록): the route's lines in reading
 * order, with the stretches that need no look folded and the seams marked. Plain data in, plain data out.
 */
export interface SequenceLine {
  unitId: string;
  /** The overview node the line belongs to (what the map and `at` speak of). */
  nodeId: string;
}

/** Every line of the overview in reading order: nodes as the whole-overview column reads them, each node's lines in order. */
export function routeSequence(overview: Overview): SequenceLine[] {
  const byId = new Map(overview.nodes.map((node) => [node.id, node] as const));
  const seen = new Set<string>();
  return windowOf(overview, undefined, true).ids.flatMap((id) => {
    const node = byId.get(id);
    if (!node || seen.has(id)) return [];
    seen.add(id);
    return node.unitIds.map((unitId) => ({ unitId, nodeId: node.id }));
  });
}

export type RouteItem =
  | { kind: 'line'; key: string; unitId: string; nodeId: string }
  | { kind: 'fold'; key: string; unitIds: string[]; nodeId: string; nodeIds: string[] }
  | { kind: 'seam'; key: string; nodeId: string };

/** Folded runs are at least this long (one folded line would say less than the line). */
export const MIN_FOLD = 2;

export function buildItems(input: {
  sequence: SequenceLine[];
  /** From round 2 on; round 1 folds nothing. */
  round: number;
  translated: (unitId: string) => boolean;
  /** The line is on an earlier round's route. */
  earlier: (unitId: string) => boolean;
  /** Lines that stay open: around seams, and the selected one. */
  open: ReadonlySet<string>;
  /** Lines of the folds the person opened (every unit id of them), so a later change of the run's edges cannot fold them again. */
  expanded: ReadonlySet<string>;
  /** Seam overview node ids whose block (a divider) goes before the node's first line. */
  seams: ReadonlySet<string>;
}): RouteItem[] {
  const { sequence, round } = input;
  const foldable = (unitId: string) => round >= 2 && input.translated(unitId) && input.earlier(unitId) && !input.open.has(unitId) && !input.expanded.has(unitId);
  const items: RouteItem[] = [];
  const seamDone = new Set<string>();
  for (let i = 0; i < sequence.length; ) {
    const line = sequence[i]!;
    if (input.seams.has(line.nodeId) && !seamDone.has(line.nodeId)) {
      seamDone.add(line.nodeId);
      items.push({ kind: 'seam', key: `seam:${line.nodeId}`, nodeId: line.nodeId });
    }
    if (foldable(line.unitId)) {
      let end = i;
      // A run stops before a seam divider as well: the seam's first line is open anyway, but the check is cheap and explicit.
      while (end + 1 < sequence.length && foldable(sequence[end + 1]!.unitId) && !(input.seams.has(sequence[end + 1]!.nodeId) && !seamDone.has(sequence[end + 1]!.nodeId))) end++;
      const run = sequence.slice(i, end + 1);
      if (run.length >= MIN_FOLD) {
        items.push({ kind: 'fold', key: `fold:${line.unitId}`, unitIds: run.map((item) => item.unitId), nodeId: line.nodeId, nodeIds: [...new Set(run.map((item) => item.nodeId))] });
        i = end + 1;
        continue;
      }
    }
    items.push({ kind: 'line', key: line.unitId, unitId: line.unitId, nodeId: line.nodeId });
    i++;
  }
  return items;
}

/** The first item index of every node (a fold stands for each node it covers; a node with a seam starts two lines before the divider). */
export function nodeStarts(items: RouteItem[]): Map<string, number> {
  const starts = new Map<string, number>();
  items.forEach((item, index) => {
    for (const nodeId of item.kind === 'fold' ? item.nodeIds : [item.nodeId]) if (!starts.has(nodeId)) starts.set(nodeId, item.kind === 'seam' ? Math.max(0, index - 2) : index);
  });
  return starts;
}

/** The index of the item that shows a line (the fold holding it when folded), or -1. */
export function indexOfLine(items: RouteItem[], unitId: string): number {
  return items.findIndex((item) => (item.kind === 'line' ? item.unitId === unitId : item.kind === 'fold' && item.unitIds.includes(unitId)));
}

/** The next (or previous) line without a translation after `from` in reading order; none when there is none. */
export function untranslatedFrom(sequence: SequenceLine[], translated: (unitId: string) => boolean, from: string | undefined, direction: 1 | -1): string | undefined {
  const start = from ? sequence.findIndex((line) => line.unitId === from) : -1;
  for (let i = start < 0 ? (direction === 1 ? 0 : sequence.length - 1) : start + direction; i >= 0 && i < sequence.length; i += direction) if (!translated(sequence[i]!.unitId)) return sequence[i]!.unitId;
  return undefined;
}

/** The ids of the translation mask: every character is one line of the slice in block order. */
export function translatedIds(blocks: { unitIds: string[] }[], mask: string): Set<string> {
  const ids = new Set<string>();
  let at = 0;
  for (const block of blocks) for (const id of block.unitIds) if (mask[at++] === '1') ids.add(id);
  return ids;
}
