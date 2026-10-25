import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { termMatcher } from '@tw/shared';
import { EditorSourceParagraph, EditorTermMark, EditorTokenChip, EditorTokenText, EditorTokenTip, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { q } from '@/lib/queries';
import { splitTokens, useLineContext, type SourcePart } from '@/lib/line-context';
import { chipHue, chipLabel, type TokenUnit } from '@/lib/tokens';
import { useDraft } from '@/lib/drafts';
import { placeTags } from '@/lib/tag-placement';
import { insertIntoLine, insertUnitIntoLine } from './translation-input';
import { TermPick } from './term-pick';
import { keyLabel } from '@/lib/keys';

/**
 * A line's source as the translator reads it: format tokens as chips and confirmed glossary terms
 * underlined (hover for the translation). With the line's editor open, clicking either puts it at
 * the cursor.
 */
export function SourceText({ parts, units = [], unitId, missing = [] }: { parts: SourcePart[]; units?: TokenUnit[]; unitId?: string; missing?: number[] }) {
  const insert = (text: string) => unitId && insertIntoLine(unitId, text);
  return (
    <EditorSourceParagraph>
      {parts.map((part, index) => {
        if (part.token !== undefined)
          return (
            <TokenChip
              key={index}
              part={part}
              missing={!!part.token.number && missing.includes(part.token.number)}
              hint={unitId ? [missing.includes(part.token.number) && '번역에 없음', part.token.number && part.token.number <= 9 && keyLabel(`Alt+${part.token.number}`)].filter(Boolean).join(' · ') || undefined : undefined}
              onPick={
                unitId
                  ? () => {
                      // Either chip of a pair puts the whole pair around the selection.
                      const unit = units.find((candidate) => candidate.number === part.token!.number);
                      if (unit) insertUnitIntoLine(unitId, unit);
                      else insert(part.text);
                    }
                  : undefined
              }
            />
          );
        if (part.term)
          return (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <EditorTermMark
                  pickable={!!unitId}
                  onMouseDown={(event) => unitId && (event.preventDefault(), insert(part.term!.target))}
                >
                  {part.text}
                </EditorTermMark>
              </TooltipTrigger>
              <TooltipContent>
                {part.term.source} → {part.term.target}
              </TooltipContent>
            </Tooltip>
          );
        return <span key={index}>{part.text}</span>;
      })}
    </EditorSourceParagraph>
  );
}

/** The source of the line being edited, with its tokens and terms (see SourceText); tokens the draft still lacks are ringed. */
export function LineSourceText({ projectId, unitId, source, translation }: { projectId: string; unitId: string; source: string; translation?: string | null }) {
  const line = useLineContext(projectId, source);
  const [draft] = useDraft(`line:${unitId}`, translation ?? '');
  const missing = useMemo(() => {
    if (!draft.trim()) return [];
    const placement = placeTags(source, draft, line.tokenPattern);
    return [...placement.placed, ...placement.left];
  }, [source, draft, line.tokenPattern]);
  // Selecting words in it offers to add them to the glossary.
  return (
    <TermPick projectId={projectId} unitId={unitId}>
      <SourceText parts={line.parts} units={line.units} unitId={unitId} missing={missing} />
    </TermPick>
  );
}

/** A numbered format token (#1); the full token shows in a tooltip on hover. */
export function TokenChip({ part, hint, onPick, missing = false }: { part: SourcePart; hint?: string; onPick?: () => void; missing?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <EditorTokenChip
          hue={chipHue(part.token?.number ?? 0)}
          stray={!part.token?.number}
          missing={missing}
          pickable={!!onPick}
          onMouseDown={onPick && ((event) => (event.preventDefault(), onPick()))}
        >
          {chipLabel(part.token?.kind ?? 'single', part.token?.number ?? 0)}
        </EditorTokenChip>
      </TooltipTrigger>
      <EditorTokenTip text={part.text} stray={!part.token?.number} hint={hint} />
    </Tooltip>
  );
}

/** Read-only text (a line in the list, a translation) with its format tokens as numbered chips. */
export function TokenText({ text, source, pattern, look }: { text: string; source: string; pattern: RegExp | null; look?: 'suggestion' | 'removed' | 'added' | 'plain' }) {
  const parts = splitTokens(text, source, pattern);
  return (
    // A span (block), so it can sit inside a button as well as a list row.
    <EditorTokenText look={look}>
      {parts.map((part, index) => (part.token !== undefined ? <TokenChip key={index} part={part} /> : <span key={index}>{part.text}</span>))}
    </EditorTokenText>
  );
}

type ConfirmedTerm = { source: string; target: string };
const matchers = new WeakMap<object, ReturnType<typeof termMatcher<ConfirmedTerm>>>();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole word, any case, also next to Hangul or punctuation (the rule of `mentions` and the picked line's underlines). */
const wordPattern = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu');

/** One glossary matcher for every row of a list: built once per loaded glossary, not once per row. */
function useConfirmedTermMatcher(projectId: string) {
  const terms = useQuery(q.terms(projectId)).data;
  return useMemo(() => {
    if (!terms) return null;
    let matcher = matchers.get(terms);
    if (!matcher) {
      const confirmed = terms
        .filter((term) => term.status === 'confirmed' && term.target)
        .map((term) => ({ source: term.source, target: term.target }))
        .sort((a, b) => b.source.length - a.source.length);
      matcher = termMatcher(confirmed, (term) => term.source);
      matchers.set(terms, matcher);
    }
    return matcher;
  }, [terms]);
}

/** A plain run of text cut at the confirmed glossary terms it mentions (longest terms win). */
function cutTerms(text: string, used: ConfirmedTerm[]) {
  const found: { start: number; end: number; term: ConfirmedTerm }[] = [];
  for (const term of used)
    for (const match of text.matchAll(wordPattern(term.source))) {
      const start = match.index, end = start + match[0].length;
      if (!found.some((item) => start < item.end && end > item.start)) found.push({ start, end, term });
    }
  found.sort((a, b) => a.start - b.start);
  const cut: { text: string; term?: ConfirmedTerm }[] = [];
  let at = 0;
  for (const item of found) {
    if (item.start > at) cut.push({ text: text.slice(at, item.start) });
    cut.push({ text: text.slice(item.start, item.end), term: item.term });
    at = item.end;
  }
  if (at < text.length) cut.push({ text: text.slice(at) });
  return cut;
}

/**
 * The source of a line that is not being edited: format tokens as chips and confirmed glossary
 * terms with a dotted underline (the translation in its title), so the list shows which words the
 * glossary has before a line is picked.
 */
export function MarkedSourceText({ projectId, text, pattern }: { projectId: string; text: string; pattern: RegExp | null }) {
  const matcher = useConfirmedTermMatcher(projectId);
  const parts = splitTokens(text, text, pattern);
  return (
    <EditorTokenText>
      {parts.map((part, index) => {
        if (part.token !== undefined) return <TokenChip key={index} part={part} />;
        const used = matcher?.find(part.text) ?? [];
        if (!used.length) return <span key={index}>{part.text}</span>;
        return (
          <span key={index}>
            {cutTerms(part.text, used).map((piece, at) =>
              piece.term ? (
                <EditorTermMark key={at} dotted title={`${piece.term.source} → ${piece.term.target}`}>{piece.text}</EditorTermMark>
              ) : (
                <span key={at}>{piece.text}</span>
              ),
            )}
          </span>
        );
      })}
    </EditorTokenText>
  );
}
