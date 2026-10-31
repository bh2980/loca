import { sourceOf, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus, type StatusBy } from './knowledge.ts';
import { decidedBy, isUnreviewed, knowledgeMarksOf, matchesMarks, type AutoMark, type DecidedBy } from './marks.ts';

/**
 * What a knowledge list (people, relationships, speech rules, events, notes) can be narrowed by: the
 * knowledge page's filters (its URL) and the list tools / `loca knowledge`, so both list the same
 * items. Every given part must hold.
 */
export interface KnowledgeFilter {
  /** 출처: who wrote it. */
  source?: KnowledgeSource;
  /** 상태 (several mean either); rejected items are never listed. */
  status?: readonly ('candidate' | 'confirmed')[];
  /** 정한 쪽. */
  decidedBy?: DecidedBy;
  /** No person has decided it yet: a candidate, or decided by AI. */
  unreviewed?: boolean;
  /** Automatic tags the item must all carry, and 숨기기: any of these leaves it out. */
  marks?: readonly AutoMark[];
  hideMarks?: readonly AutoMark[];
  /** Tag ids the item must all carry, and 숨기기: any of these leaves it out. */
  tags?: readonly string[];
  hideTags?: readonly string[];
}

export interface KnowledgeItem {
  id: string;
  status: KnowledgeStatus;
  statusBy: StatusBy;
  origin: KnowledgeOrigin;
  evidence?: readonly unknown[];
  /** Why the analysis wants a person to look (확인 권장); empty when none. */
  reviewNote?: string;
  tags?: readonly { id: string; note?: string | null }[];
}

/** Whether a knowledge item passes the filter. */
export function knowledgeMatches(item: KnowledgeItem, filter: KnowledgeFilter) {
  if (item.status === 'rejected') return false;
  const marks = knowledgeMarksOf(item);
  const tagIds = (item.tags ?? []).map((tag) => tag.id);
  return (
    (!filter.source || sourceOf(item) === filter.source) &&
    (!filter.status?.length || filter.status.includes(item.status as 'candidate' | 'confirmed')) &&
    (!filter.decidedBy || decidedBy(item, filter.decidedBy)) &&
    (!filter.unreviewed || isUnreviewed(item)) &&
    matchesMarks(marks, filter.marks) &&
    (filter.tags ?? []).every((id) => tagIds.includes(id)) &&
    !marks.some((mark) => filter.hideMarks?.includes(mark)) &&
    !tagIds.some((id) => filter.hideTags?.includes(id))
  );
}

/**
 * One speaker → listener direction: the relationship (a fact of the story) and the speech rules
 * (the Korean translation decision, in stretches). Stored apart, shown together.
 */
export interface Pair<R extends KnowledgeItem = KnowledgeItem, S extends KnowledgeItem = KnowledgeItem> {
  key: string;
  from: string;
  to: string;
  fromId?: string;
  toId?: string;
  relationship?: R;
  rules: S[];
}

export const pairKey = (from: string, to: string) => `${from}→${to}`;

/** Every direction that has a relationship or a speech rule, by speaker then listener. Rule names resolve through aliases. */
export function buildPairs<R extends KnowledgeItem & { fromId: string; toId: string }, S extends KnowledgeItem & { fromName: string; toName: string }>(
  characters: readonly { id: string; name: string; aliases: readonly string[] }[],
  relationships: readonly R[],
  rules: readonly S[],
): Pair<R, S>[] {
  const byName = new Map(characters.flatMap((c) => [c.name, ...c.aliases].map((name) => [name.toLowerCase(), c] as const)));
  const byId = new Map(characters.map((c) => [c.id, c]));
  const pairs = new Map<string, Pair<R, S>>();
  const pair = (from: string, to: string, fromId?: string, toId?: string) => {
    const key = pairKey(from, to);
    const existing = pairs.get(key) ?? { key, from, to, fromId, toId, rules: [] };
    pairs.set(key, existing);
    return existing;
  };
  for (const rel of relationships) {
    const from = byId.get(rel.fromId);
    const to = byId.get(rel.toId);
    if (from && to) pair(from.name, to.name, from.id, to.id).relationship ??= rel;
  }
  for (const rule of rules) {
    const from = byName.get(rule.fromName.toLowerCase());
    const to = byName.get(rule.toName.toLowerCase());
    pair(from?.name ?? rule.fromName, to?.name ?? rule.toName, from?.id, to?.id).rules.push(rule);
  }
  return [...pairs.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** A pair's items: its relationship, then its rules. */
const itemsOf = (pair: Pair): KnowledgeItem[] => [...(pair.relationship ? [pair.relationship] : []), ...pair.rules];

/** A pair is AI's if any of its items is, a candidate if any item is: what the table and graph show for it. */
export function pairSummary(pair: Pair) {
  const rows = itemsOf(pair);
  return {
    id: pair.key,
    status: rows.some((row) => row.status === 'candidate') ? ('candidate' as const) : ('confirmed' as const),
    origin: rows.some((row) => row.origin === 'ai') ? ('ai' as const) : ('human' as const),
    statusBy: rows.some((row) => row.statusBy === 'ai') ? ('ai' as const) : ('human' as const),
    evidence: [] as string[],
    // Every tag of its items once; the items' 확인 권장 reasons joined (two stretches may both have one).
    reviewNote: rows.flatMap((row) => (row.reviewNote ? [row.reviewNote] : [])).join('\n'),
    tags: [...Map.groupBy(rows.flatMap((row) => row.tags ?? []), (tag) => tag.id).entries()].map(([id, list]) => ({ id, note: list.flatMap((tag) => (tag.note ? [tag.note] : [])).join('\n') || null })),
  };
}

/** The marks any item of a pair carries: what its row shows and the marks filter reads. */
export const pairMarks = (pair: Pair): AutoMark[] => [...new Set(itemsOf(pair).flatMap((row) => knowledgeMarksOf(row)))];

/**
 * Pairs matching the filter: 상태 by the pair's summary, 정한 쪽, 출처 and tags through any one item,
 * automatic tags and 숨기기 through the pair's own marks and its items' tags.
 */
export function pairMatches(pair: Pair, filter: KnowledgeFilter) {
  const rows = itemsOf(pair);
  const marks = pairMarks(pair);
  const tagIds = rows.flatMap((row) => (row.tags ?? []).map((tag) => tag.id));
  return (
    (!filter.status?.length || filter.status.includes(pairSummary(pair).status)) &&
    (!filter.decidedBy || rows.some((row) => decidedBy(row, filter.decidedBy!))) &&
    (!filter.unreviewed || rows.some((row) => isUnreviewed(row))) &&
    matchesMarks(marks, filter.marks) &&
    rows.some((row) => knowledgeMatches(row, { source: filter.source, tags: filter.tags })) &&
    !marks.some((mark) => filter.hideMarks?.includes(mark)) &&
    !tagIds.some((id) => filter.hideTags?.includes(id))
  );
}
