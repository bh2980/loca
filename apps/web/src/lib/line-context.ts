import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { compileFormatRules, mentions } from '@tw/shared';
import { q } from '@/lib/queries';

export interface SourcePart {
  text: string;
  /** A format token (placeholder or tag): kept as is in the translation. */
  token?: boolean;
  /** A confirmed glossary term and its translation. */
  term?: { source: string; target: string };
}

/** A token as a short chip label: a tag by its name (<d target="…"> → <d>), anything else cut to 14 characters. */
export const tokenLabel = (token: string) => {
  const tag = /^<(\/?)([A-Za-z][\w-]*)[^>]*?(\/?)>$/.exec(token);
  if (tag) return `<${tag[1]}${tag[2]}${tag[3]}>`;
  return token.length > 14 ? `${token.slice(0, 13)}…` : token;
};

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
    const compiled = compileFormatRules(project.data?.formatRules ?? undefined);
    const parts = [compiled.placeholder, compiled.tag].filter((pattern): pattern is RegExp => !!pattern).map((pattern) => `(?:${pattern.source})`);
    const tokenPattern = parts.length ? new RegExp(parts.join('|'), 'gu') : null;
    const tokens = tokenPattern ? (source.match(tokenPattern) ?? []) : [];
    const plain = withoutTokens(source, tokenPattern);
    const used = (terms.data ?? [])
      .filter((term) => term.status === 'confirmed' && term.target && mentions(plain, term.source))
      // Longer names first, so "Captain Allen" wins over "Allen".
      .sort((a, b) => b.source.length - a.source.length)
      .map((term) => ({ source: term.source, target: term.target }));

    // Cut the source into plain text, tokens and term mentions (tokens win over terms).
    const marks: { start: number; end: number; part: SourcePart }[] = [];
    for (const match of tokenPattern ? source.matchAll(tokenPattern) : []) marks.push({ start: match.index, end: match.index + match[0].length, part: { text: match[0], token: true } });
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
