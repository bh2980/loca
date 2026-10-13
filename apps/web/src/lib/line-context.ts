import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { compileFormatRules, mentions } from '@tw/shared';
import { q } from '@/lib/queries';

export interface SourcePart {
  text: string;
  /** A format token (placeholder or tag): kept as is in the translation. Its chip number (#1…), or 0 when the source lacks it. */
  token?: number;
  /** A confirmed glossary term and its translation. */
  term?: { source: string; target: string };
}

/**
 * Format tokens are chips numbered by their order in the source (#1 is what ⌘1 inserts); the
 * full token is the chip's tooltip. In a translation a token takes the number of the same token
 * in the source (the nth copy the nth number), or 0 (#?) when the source does not have it.
 */
export function tokenNumbering(source: string, pattern: RegExp | null) {
  const numbers = new Map<string, number[]>();
  (pattern ? (source.match(new RegExp(pattern.source, 'gu')) ?? []) : []).forEach((token, index) => numbers.set(token, [...(numbers.get(token) ?? []), index + 1]));
  /** The number of `token`, seen `copy` times before it (0-based) in the text being numbered. */
  return (token: string, copy: number) => numbers.get(token)?.[copy] ?? 0;
}
export const chipLabel = (number: number) => (number ? `#${number}` : '#?');

/** Text cut into plain runs and numbered tokens (numbers from `source`, see tokenNumbering). */
export function splitTokens(text: string, source: string, pattern: RegExp | null): SourcePart[] {
  if (!pattern) return [{ text }];
  const numberOf = tokenNumbering(source, pattern);
  const copies = new Map<string, number>();
  const parts: SourcePart[] = [];
  let at = 0;
  for (const match of text.matchAll(new RegExp(pattern.source, 'gu'))) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    const copy = copies.get(match[0]) ?? 0;
    copies.set(match[0], copy + 1);
    parts.push({ text: match[0], token: numberOf(match[0], copy) });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** One pattern for every format token of the project's rules. */
export function tokenPatternOf(rules: Parameters<typeof compileFormatRules>[0]) {
  const compiled = compileFormatRules(rules);
  const parts = [compiled.placeholder, compiled.tag].filter((pattern): pattern is RegExp => !!pattern).map((pattern) => `(?:${pattern.source})`);
  return parts.length ? new RegExp(parts.join('|'), 'gu') : null;
}

/** The text with its format tokens blanked out (same length), so words inside tags are not read as terms. */
export const withoutTokens = (text: string, pattern: RegExp | null) => (pattern ? text.replace(new RegExp(pattern.source, 'gu'), (token) => ' '.repeat(token.length)) : text);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole word, any case, also next to Hangul or punctuation (the same rule as `mentions`). */
const wordPattern = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu');

/**
 * What the editor knows about a line's source: its format tokens (in order) and the confirmed
 * terms it mentions, plus the source cut into parts for display. One pattern matches any token.
 */
export function useLineContext(projectId: string, source: string) {
  const project = useQuery(q.project(projectId));
  const terms = useQuery(q.terms(projectId));
  return useMemo(() => {
    const tokenPattern = tokenPatternOf(project.data?.formatRules ?? undefined);
    const tokens = tokenPattern ? (source.match(tokenPattern) ?? []) : [];
    const plain = withoutTokens(source, tokenPattern);
    const used = (terms.data ?? [])
      .filter((term) => term.status === 'confirmed' && term.target && mentions(plain, term.source))
      // Longer names first, so "Captain Allen" wins over "Allen".
      .sort((a, b) => b.source.length - a.source.length)
      .map((term) => ({ source: term.source, target: term.target }));

    // Cut the source into plain text, tokens and term mentions (tokens win over terms).
    const marks: { start: number; end: number; part: SourcePart }[] = [];
    let number = 0;
    for (const match of tokenPattern ? source.matchAll(tokenPattern) : []) marks.push({ start: match.index, end: match.index + match[0].length, part: { text: match[0], token: ++number } });
    for (const term of used)
      for (const match of plain.matchAll(wordPattern(term.source))) {
        const start = match.index, end = start + match[0].length;
        if (!marks.some((mark) => start < mark.end && end > mark.start)) marks.push({ start, end, part: { text: match[0], term } });
      }
    marks.sort((a, b) => a.start - b.start);
    const cut: SourcePart[] = [];
    let at = 0;
    for (const mark of marks) {
      if (mark.start > at) cut.push({ text: source.slice(at, mark.start) });
      cut.push(mark.part);
      at = mark.end;
    }
    if (at < source.length) cut.push({ text: source.slice(at) });
    return { tokenPattern, tokens, terms: used, parts: cut, formatRules: project.data?.formatRules };
  }, [project.data?.formatRules, terms.data, source]);
}
