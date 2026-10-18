import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { compileFormatRules, termMatcher } from '@tw/shared';
import { q } from '@/lib/queries';
import { numberTokens, tokenUnits, type TokenKind } from '@/lib/tokens';

export interface SourcePart {
  text: string;
  /** A format token (placeholder or tag), kept as is in the translation: its number and whether it opens, closes or stands alone (see lib/tokens). */
  token?: { number: number; kind: TokenKind };
  /** A confirmed glossary term and its translation. */
  term?: { source: string; target: string };
}

/** Text cut into plain runs and numbered tokens (numbers from `source`). */
export function splitTokens(text: string, source: string, pattern: RegExp | null): SourcePart[] {
  const parts: SourcePart[] = [];
  let at = 0;
  for (const token of numberTokens(text, source, pattern)) {
    if (token.from > at) parts.push({ text: text.slice(at, token.from) });
    parts.push({ text: token.text, token: { number: token.number, kind: token.kind } });
    at = token.to;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** The format checks the editor runs while typing (numbers, spaces; particles after variables for Korean targets). */
export const editorChecks = (targetLanguage?: string, emptyText = false) => ({ placeholders: true, tags: true, newlines: true, emptyText, numbers: true, spaces: true, particles: Boolean(targetLanguage?.toLowerCase().startsWith('ko')) });

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

  const confirmedTerms = useMemo(
    () =>
      (terms.data ?? [])
        .filter((term) => term.status === 'confirmed' && term.target)
        .sort((a, b) => b.source.length - a.source.length)
        .map((term) => ({ source: term.source, target: term.target })),
    [terms.data],
  );
  const matcher = useMemo(() => termMatcher(confirmedTerms, (term) => term.source), [confirmedTerms]);
  const tokenPattern = useMemo(() => tokenPatternOf(project.data?.formatRules ?? undefined), [project.data?.formatRules]);

  return useMemo(() => {
    const units = tokenUnits(source, tokenPattern);
    const plain = withoutTokens(source, tokenPattern);
    const used = matcher.find(plain);

    // Cut the source into plain text, tokens and term mentions (tokens win over terms).
    const marks: { start: number; end: number; part: SourcePart }[] = [];
    for (const token of numberTokens(source, source, tokenPattern)) marks.push({ start: token.from, end: token.to, part: { text: token.text, token: { number: token.number, kind: token.kind } } });
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
    return { tokenPattern, units, terms: used, parts: cut, formatRules: project.data?.formatRules };
  }, [tokenPattern, matcher, source, project.data?.formatRules]);
}
