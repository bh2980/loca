import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { compileFormatRules, type FormatRules } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** Fuzzy matches below this share are not worth showing. */
const MIN_SCORE = 70;
/** How many lines the index offers for scoring. */
const POOL = 60;

export interface LineMatch {
  unitId: string;
  groupId: string;
  groupTitle: string;
  source: string;
  translation: string;
  speaker: string | null;
  listener: string | null;
  /** The line is in a final status. */
  final: boolean;
  /** 100 = the same source once case, spacing, punctuation and format tokens are ignored. */
  score: number;
  /** The match's source split into words, the ones that differ from this line's source marked. */
  diff?: { text: string; changed: boolean }[];
}

/**
 * Lines of the same project, already translated, whose source is the same as or close to this
 * line's (a translation memory made of the project itself). Candidates come from the trigram
 * index; each is scored by word-level edit distance, the way CAT tools give a fuzzy percentage.
 */
export function lineMatches(db: Db, unit: { id: string; projectId: string; source: string }, rules?: FormatRules | null): LineMatch[] {
  const tokens = compileFormatRules(rules ?? undefined);
  const words = (text: string) => wordsOf(text, tokens);
  const mine = words(unit.source);
  const key = mine.map((word) => word.norm).filter(Boolean);
  if (!key.length) return [];

  const searchable = [...new Set(key.filter((word) => [...word].length >= 3))];
  const pool = searchable.length
    ? sql`${s.units}.rowid in (select rowid from units_fts where units_fts match ${`source : (${searchable.map((word) => `"${word.replace(/"/g, '""')}"`).join(' OR ')})`})`
    : // Too short for the trigram index (What?, OK): same-length lines holding the word.
      and(sql`length(${s.units.source}) <= ${unit.source.length + 8}`, sql`lower(${s.units.source}) like ${`%${key.join(' ').replace(/[%_\\]/g, '')}%`}`);
  const rows = db
    .select({ unitId: s.units.id, groupId: s.units.groupId, groupTitle: s.groups.title, source: s.units.source, translation: s.units.translation, speaker: s.units.speaker, listener: s.units.listener, kind: s.statuses.kind })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
    .where(and(eq(s.units.projectId, unit.projectId), ne(s.units.id, unit.id), isNotNull(s.units.translation), ne(s.units.translation, ''), pool))
    .limit(POOL * 4)
    .all();

  const scored = rows.flatMap((row) => {
    const theirs = words(row.source);
    const distance = editDistance(key, theirs.map((word) => word.norm).filter(Boolean));
    const score = Math.round(100 * (1 - distance / Math.max(key.length, theirs.filter((word) => word.norm).length)));
    if (score < MIN_SCORE) return [];
    const same = new Set(common(key, theirs.map((word) => word.norm)));
    return [{
      unitId: row.unitId,
      groupId: row.groupId,
      groupTitle: row.groupTitle,
      source: row.source,
      translation: row.translation!,
      speaker: row.speaker,
      listener: row.listener,
      final: row.kind === 'final',
      score,
      ...(score < 100 && { diff: theirs.map((word, index) => ({ text: word.text, changed: !!word.norm && !same.has(index) })) }),
    }];
  });
  // Same source first, confirmed before not; one row per distinct translation of the same source.
  scored.sort((a, b) => b.score - a.score || Number(b.final) - Number(a.final));
  const seen = new Set<string>();
  return scored.filter((match) => {
    const id = `${match.score === 100 ? 'same' : match.source}\u0000${match.translation}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 5);
}

/** Words as written, each with its comparable form: lower case, no punctuation; format tokens become one marker. */
function wordsOf(text: string, tokens: ReturnType<typeof compileFormatRules>) {
  let marked = text;
  for (const pattern of [tokens.placeholder, tokens.tag]) if (pattern) marked = marked.replace(pattern, (token) => ` \u0001${token.replace(/\s+/g, '\u0002')} `);
  return marked
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const isToken = word.startsWith('\u0001');
      const shown = isToken ? word.slice(1).replace(/\u0002/g, ' ') : word;
      return { text: shown, norm: isToken ? '§' : word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') };
    });
}

function editDistance(a: string[], b: string[]) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

/** Indexes in `b` of the words it shares with `a` in order (longest common subsequence). */
function common(a: string[], b: string[]) {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] && b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const kept: number[] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j] && b[j]) (kept.push(j), i++, j++);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return kept;
}
