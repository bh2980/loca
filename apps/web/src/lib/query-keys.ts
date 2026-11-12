import type { Topic } from '@loca/shared';

/**
 * The one place a query key is made (`pnpm ui-rules` refuses a `queryKey: [` literal anywhere else).
 *
 * A question's key starts with the topic whose change asks it again: the server names the changed topics
 * (its triggers and IMPLIES in @loca/shared) and refetchTopics (lib/live.ts) refetches every key that starts
 * with one. `name` says which question of the topic it is; the rest is what the question was asked with.
 */
export const key = <const A extends readonly unknown[]>(topic: Topic, name: string, ...args: A) => [topic, name, ...args] as const;

/**
 * The few questions keyed outside a topic, each with the topics it is still refetched on (`meta.follows`).
 * One belongs here only when its own topic would ask it far too often and something narrower says when it
 * changed:
 * - `line-surroundings`: one per open line (and a page of them preloaded). The units topic changes with every
 *   line of a run; the row feed names the lines that changed, and only those lines' surroundings are read
 *   again (lib/units.ts). What it reads besides lines is followed here.
 * - `run-start`: what a run started with (its definition, models, caps). The runs topic changes with every
 *   item; the key carries the run's own turn (status, notice, total, end) from its progress row instead, so
 *   it is asked again exactly when the run itself changes.
 */
export const OWN_FAMILIES = {
  'line-surroundings': ['knowledge', 'graph'],
  'run-start': [],
} as const satisfies Record<string, readonly Topic[]>;
export type OwnFamily = keyof typeof OWN_FAMILIES;

/** The key of a question outside the topics, with the topics it follows: spread into the query's options. */
export function ownKey<F extends OwnFamily, const A extends readonly unknown[]>(family: F, ...args: A) {
  return { queryKey: [family, ...args] as const, meta: { follows: OWN_FAMILIES[family] as readonly Topic[] } };
}

/** Every key of a family (for reading what is cached of it). */
export const ownFamily = <F extends OwnFamily>(family: F) => [family] as const;

/**
 * A short stand-in for a long list of ids in a key (thousands of picked lines): its length and a hash of
 * the ids in order. Two different lists of the same length share a key only if their 32-bit hashes collide.
 */
export function idsFingerprint(ids: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const id of ids) {
    for (let at = 0; at < id.length; at++) hash = Math.imul(hash ^ id.charCodeAt(at), 0x01000193);
    hash = Math.imul(hash ^ 0x2c, 0x01000193);
  }
  return `${ids.length}:${(hash >>> 0).toString(36)}`;
}
