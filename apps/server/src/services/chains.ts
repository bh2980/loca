import type { LayoutJob } from './layout-worker.ts';

/** Fewest nodes a straight run needs to be folded into one block. */
export const CHAIN_MIN = 3;
/** Size of a folded run: a line box, a little taller for its count. */
export const CHAIN_SIZE: [number, number] = [260, 84];

/**
 * Folds straight runs of the dialogue graph (each step the only way out of one node and the only
 * way into the next, within one scene) into one block, so a long conversation reads as one box
 * instead of a column of boxes. Nothing is dropped: the block keeps its nodes in order (`chains`),
 * and every edge into or out of the run now ends at the block. Portals and kept nodes (a player's
 * choice) are never folded.
 */
export function foldChains(job: LayoutJob, groupOf: (id: string) => string | null | undefined, keep: (id: string) => boolean = () => false): { job: LayoutJob; chains: { id: string; nodeIds: string[] }[] } {
  const outs = new Map<string, string[]>();
  const ins = new Map<string, string[]>();
  for (const edge of job.edges) {
    if (edge.from === edge.to) continue;
    (outs.get(edge.from) ?? outs.set(edge.from, []).get(edge.from)!).push(edge.to);
    (ins.get(edge.to) ?? ins.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  const foldable = (id: string) => !id.startsWith('portal:') && !keep(id);
  // u → v is a link of a run when it is u's only way out and v's only way in.
  const next = new Map<string, string>();
  const linkedIn = new Set<string>();
  for (const node of job.nodes) {
    const out = outs.get(node.id);
    if (out?.length !== 1) continue;
    const to = out[0];
    if (ins.get(to)?.length !== 1 || !foldable(node.id) || !foldable(to) || groupOf(node.id) !== groupOf(to)) continue;
    next.set(node.id, to);
    linkedIn.add(to);
  }
  const chainOf = new Map<string, string>();
  const chains: { id: string; nodeIds: string[] }[] = [];
  for (const node of job.nodes) {
    if (linkedIn.has(node.id) || !next.has(node.id)) continue;
    const nodeIds = [node.id];
    for (let at = next.get(node.id); at && !nodeIds.includes(at); at = next.get(at)) nodeIds.push(at);
    if (nodeIds.length < CHAIN_MIN) continue;
    const id = `chain:${node.id}`;
    chains.push({ id, nodeIds });
    for (const member of nodeIds) chainOf.set(member, id);
  }
  if (!chains.length) return { job, chains };
  const end = (id: string) => chainOf.get(id) ?? id;
  return {
    job: {
      ...job,
      nodes: [...job.nodes.filter((node) => !chainOf.has(node.id)), ...chains.map((chain) => ({ id: chain.id, width: CHAIN_SIZE[0], height: CHAIN_SIZE[1] }))],
      // Edges inside a run disappear; the rest are re-ended at the blocks.
      edges: job.edges.filter((edge) => !(chainOf.has(edge.from) && chainOf.get(edge.from) === chainOf.get(edge.to))).map((edge) => ({ ...edge, from: end(edge.from), to: end(edge.to) })),
    },
    chains,
  };
}
