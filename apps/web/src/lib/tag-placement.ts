import { mentions } from '@tw/shared';
import { numberTokens, tokenUnits, type TokenKind } from './tokens';

/** One token to insert into the translation, at a position of the text as it is now. */
export interface TagInsert {
  at: number;
  text: string;
  kind: TokenKind;
  number: number;
}

export interface TagPlacement {
  inserts: TagInsert[];
  /** Units the rules placed, and the ones still missing (left to a person, or later to AI). */
  placed: number[];
  left: number[];
}

const EDGE = /^[\s\p{P}]*$/u;

/**
 * Puts the source's format units that the translation lacks where rules can tell, without AI
 * (docs/DESIGN.md J3b B). The text between tokens is never changed, only tokens are added:
 * ① a pair around the whole source (end punctuation aside) goes around the whole translation;
 * ② a token at the very start or end of the source goes to the start or end;
 * ③ a pair around a confirmed term goes around that term's translation when it occurs once;
 * ④ a pair around text that the translation repeats verbatim once (a name, a number) goes around it.
 */
export function placeTags(source: string, translation: string, pattern: RegExp | null, terms: { source: string; target: string }[] = []): TagPlacement {
  if (!pattern) return { inserts: [], placed: [], left: [] };
  const units = tokenUnits(source, pattern);
  const present = new Set(numberTokens(translation, source, pattern).filter((token) => token.number).map((token) => `${token.number}:${token.kind}`));
  const missing = units.filter((unit) => (unit.close ? !present.has(`${unit.number}:open`) || !present.has(`${unit.number}:close`) : !present.has(`${unit.number}:single`)));
  const sourceTokens = numberTokens(source, source, pattern);
  // The translation's own tokens are not split by an insertion; plain text is where tokens may go.
  const plainEnd = translation.replace(/[\s\p{P}]+$/u, '').length;
  const plainStart = translation.length - translation.trimStart().length;
  // Punctuation the source keeps outside a tag ("... <d>…</d>") stays outside in the translation too.
  const wordStart = translation.length - translation.replace(/^[\s\p{P}]+/u, '').length;

  const inserts: TagInsert[] = [];
  const placed: number[] = [];
  const once = (needle: string) => {
    if (!needle.trim()) return -1;
    const first = translation.indexOf(needle);
    return first >= 0 && translation.indexOf(needle, first + 1) < 0 ? first : -1;
  };
  for (const unit of missing) {
    const open = sourceTokens.find((token) => token.number === unit.number && token.kind !== 'close')!;
    const close = sourceTokens.find((token) => token.number === unit.number && token.kind === 'close');
    const before = source.slice(0, open.from).replace(pattern, '');
    const after = source.slice((close ?? open).to).replace(pattern, '');
    let at: [number, number] | undefined; // where the opener and the closer go
    if (close) {
      const inner = source.slice(open.to, close.from).replace(new RegExp(pattern.source, 'gu'), '').trim();
      if (EDGE.test(before) && EDGE.test(after)) at = [before.trim() ? wordStart : plainStart, after.trim() ? plainEnd : translation.length];
      else {
        const term = terms.find((item) => item.target && item.source.toLowerCase() === inner.toLowerCase() && mentions(inner, item.source));
        const index = term ? once(term.target) : -1;
        const target = index >= 0 ? term!.target : inner;
        const where = index >= 0 ? index : once(inner);
        if (where >= 0) at = [where, where + target.length];
      }
    } else if (EDGE.test(before)) at = [plainStart, plainStart];
    else if (EDGE.test(after)) at = [translation.length, translation.length];
    if (!at) continue;
    inserts.push({ at: at[0], text: unit.open, kind: close ? 'open' : 'single', number: unit.number });
    if (close && unit.close) inserts.push({ at: at[1], text: unit.close, kind: 'close', number: unit.number });
    placed.push(unit.number);
  }
  return { inserts, placed, left: missing.map((unit) => unit.number).filter((number) => !placed.includes(number)) };
}

/** The translation with the inserts applied (for tests and previews). */
export function applyInserts(text: string, inserts: TagInsert[]) {
  // Later positions first; at one position openers after closers (…1⟩⟨2…).
  const order = [...inserts].map((insert, index) => ({ ...insert, index })).sort((a, b) => b.at - a.at || b.index - a.index);
  return order.reduce((result, insert) => result.slice(0, insert.at) + insert.text + result.slice(insert.at), text);
}
