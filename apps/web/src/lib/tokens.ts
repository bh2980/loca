/**
 * Format tokens numbered the way CAT tools do: an opening tag and its closing tag are one pair
 * with one number (drawn ⟨1 … 1⟩, enclosing what they wrap), anything else is a single token
 * (⟨1⟩). Numbers follow the source's order; ⌘n inserts unit n. In a translation a token takes the
 * number of the same token in the source, and a closing tag the number of the tag it closes;
 * 0 (⟨?⟩) means the source has no such token.
 */
export type TokenKind = 'open' | 'close' | 'single';

export interface NumberedToken {
  text: string;
  from: number;
  to: number;
  kind: TokenKind;
  number: number;
}

/** What ⌘n inserts: a single token, or a pair to put around the selection. */
export interface TokenUnit {
  number: number;
  open: string;
  close?: string;
}

/** A tag that could open or close a pair, by name (<b …>, </b>, [color=red], [/color]). */
function shapeOf(token: string): { role: 'open' | 'close'; name: string } | null {
  let match = /^<\/([A-Za-z][\w-]*)\s*>$/.exec(token) ?? /^\[\/([A-Za-z][\w-]*)\]$/.exec(token);
  if (match) return { role: 'close', name: match[1].toLowerCase() };
  match = /^<([A-Za-z][\w-]*)\b[^>]*?[^/]?>$/.exec(token);
  if (match && !token.endsWith('/>')) return { role: 'open', name: match[1].toLowerCase() };
  match = /^\[([A-Za-z][\w-]*)(?:=[^\]]*)?\]$/.exec(token);
  if (match) return { role: 'open', name: match[1].toLowerCase() };
  return null;
}

/** The tokens of `text` with their kind; an opener without a closer (or the reverse) is single. */
function pairUp(text: string, pattern: RegExp) {
  const tokens = [...text.matchAll(new RegExp(pattern.source, 'gu'))].map((match) => ({ text: match[0], from: match.index, to: match.index + match[0].length, kind: 'single' as TokenKind, partner: -1 }));
  const open = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    const shape = shapeOf(token.text);
    if (!shape) return;
    if (shape.role === 'open') open.set(shape.name, [...(open.get(shape.name) ?? []), index]);
    else {
      const opener = open.get(shape.name)?.pop();
      if (opener === undefined) return;
      tokens[opener].kind = 'open';
      tokens[opener].partner = index;
      token.kind = 'close';
      token.partner = opener;
    }
  });
  return tokens;
}

/** The source's units in order: pairs and single tokens, each with its number. */
export function tokenUnits(source: string, pattern: RegExp | null): TokenUnit[] {
  if (!pattern) return [];
  const tokens = pairUp(source, pattern);
  return tokens.flatMap((token) => (token.kind === 'close' ? [] : [{ open: token.text, ...(token.kind === 'open' && { close: tokens[token.partner].text }) }])).map((unit, index) => ({ number: index + 1, ...unit }));
}

/** The tokens of `text` (the source itself or a translation), numbered from `source`. */
export function numberTokens(text: string, source: string, pattern: RegExp | null): NumberedToken[] {
  if (!pattern) return [];
  const units = tokenUnits(source, pattern);
  const tokens = pairUp(text, pattern);
  const used = new Set<number>();
  const numbers: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind === 'close') return;
    // The nth copy of a token takes the nth unit with the same opening text (pair or single alike).
    const unit = units.find((candidate) => !used.has(candidate.number) && candidate.open === token.text && Boolean(candidate.close) === (token.kind === 'open'))
      ?? units.find((candidate) => !used.has(candidate.number) && candidate.open === token.text);
    if (unit) used.add(unit.number);
    numbers[index] = unit?.number ?? 0;
  });
  return tokens.map((token, index) => ({ text: token.text, from: token.from, to: token.to, kind: token.kind, number: token.kind === 'close' ? numbers[token.partner] : numbers[index] }));
}

/** The chip's text: ⟨1 opens, 1⟩ closes, ⟨1⟩ stands alone; ? when the source lacks the token. */
export function chipLabel(kind: TokenKind, number: number) {
  const n = number ? String(number) : '?';
  return kind === 'open' ? `⟨${n}` : kind === 'close' ? `${n}⟩` : `⟨${n}⟩`;
}
