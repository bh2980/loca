/** One layout request for the ELK worker (layout-worker.ts); its own module so the graph helpers can share it without importing the worker. */
export type LayoutDirection = 'vertical' | 'horizontal';

export interface LayoutJob {
  direction?: LayoutDirection;
  /**
   * `group`: the node's scene, for dialogue layouts (straight runs are folded within one scene).
   * `rank`: the node's place in the script (script-rank.ts); ELK walks nodes in this order, so it
   * is where a loop is entered.
   */
  nodes: { id: string; width: number; height: number; group?: string | null; keep?: boolean; rank?: number }[];
  /** `label`: what the edge says (a choice's text); `via`: the choice node folded into it. */
  edges: { id: string; from: string; to: string; label?: string; via?: string }[];
  /**
   * Nodes joined only by drawn (not laid out) edges, placed in labelled blocks side by side (one
   * per section), each in rows from top to bottom; `{n}` in the label is the block's node count.
   */
  ordered?: { label: string; blocks: { name: string | null; rows: string[][]; heads?: string[] }[] };
}
