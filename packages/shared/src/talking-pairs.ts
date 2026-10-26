import { isSpecialListener, UNKNOWN_LISTENER } from './knowledge.ts';

/** A spoken line as the pair count reads it: the scene it is in, who says it and, when known, to whom. */
export interface PairLine {
  groupId: string;
  speaker: string | null;
  /** The line's listener as the project knows it (an unsure AI guess is passed as null). */
  listener?: string | null;
}

/** Two people who talk to each other and how many lines of the script show it. `a` and `b` are sorted, names as the script writes them. */
export interface TalkingPair {
  a: string;
  b: string;
  turns: number;
}

const clean = (name: string | null | undefined) => name?.trim() ?? '';

/**
 * The pairs of people who talk to each other in `lines` (script order), counted by two rules that both
 * add one turn to the pair per line:
 * - a line with a named listener counts speaker → listener (both directions add to the same pair);
 *   "group", "public", "self", "others" and "unknown" name nobody, so such a line counts nothing;
 * - a spoken line with no listener counts as a turn with the spoken line right before it when that one
 *   is in the same scene and said by someone else (lines without a speaker are skipped over).
 * Names are matched ignoring case and shown as first written. Only pairs with at least `minTurns` turns
 * are returned, most turns first.
 */
export function talkingPairs(lines: readonly PairLine[], minTurns = 1): TalkingPair[] {
  const pairs = new Map<string, TalkingPair>();
  const count = (one: string, other: string) => {
    if (one.toLowerCase() === other.toLowerCase()) return;
    const [a, b] = one.toLowerCase() < other.toLowerCase() ? [one, other] : [other, one];
    const key = `${a.toLowerCase()}\u0000${b.toLowerCase()}`;
    const found = pairs.get(key);
    if (found) found.turns++;
    else pairs.set(key, { a, b, turns: 1 });
  };
  let previous: { groupId: string; speaker: string } | null = null;
  for (const line of lines) {
    const speaker = clean(line.speaker);
    if (!speaker) continue;
    const listener = clean(line.listener);
    if (listener && listener !== UNKNOWN_LISTENER) {
      if (!isSpecialListener(listener)) count(speaker, listener);
    } else if (previous && previous.groupId === line.groupId) count(previous.speaker, speaker);
    previous = { groupId: line.groupId, speaker };
  }
  return [...pairs.values()].filter((pair) => pair.turns >= minTurns).sort((x, y) => y.turns - x.turns || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/**
 * The kind of the candidate relationship a pair gets when the AI could not say what it is (관계 저장's
 * "확인 못 한 쌍"): a row to look at, with the AI's reason as its description. A real relationship saved
 * for the same pair later takes its place.
 */
export const UNRESOLVED_RELATIONSHIP_KIND = '관계 미확인';

/** Why a talking pair has no relationship: not a person (a UI text, device, place), nothing in the lines shows one, or the parts disagree. */
export const UNRESOLVED_PAIR_KINDS = ['notPerson', 'noEvidence', 'undecided'] as const;
export type UnresolvedPairKind = (typeof UNRESOLVED_PAIR_KINDS)[number];
/** The review note a stored character gets when the AI says its name is not a person ("<prefix><reason>"). */
export const NOT_A_PERSON_NOTE = '인물이 아닐 수 있음: ';
