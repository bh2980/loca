import { useMemo } from 'react';
import { glossaryMatcher, termForms, termLine, type TermScope } from '@loca/shared';
import { Text, EditorTermMark, EditorTokenChip, EditorTokenText, EditorTokenTip, Tooltip, TooltipContent, TooltipTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@loca/ui';
import { markedTerm, splitTokens, useSourceParts, type SourcePart, type SourceTerm } from '@/lib/source-parts';
import { chipHue, chipLabel, type TokenUnit } from '@/lib/tokens';
import { useDraft } from '@/lib/drafts';
import { placeTags } from '@/lib/tag-placement';
import { insertIntoLine, insertUnitIntoLine } from './translation-input';
import { TermPick } from './term-pick';
import { keyLabel } from '@/lib/keys';
import { tokenKey } from '@/lib/shortcuts';
import { useTerms } from '@/lib/terms';

/**
 * A line's source as the translator reads it: format tokens as chips and confirmed glossary terms
 * underlined (hover for the translation). With the line's editor open, clicking either puts it at
 * the cursor.
 */
/** A chip's hint in the editor: missing from the translation, and its Alt+number shortcut. */
const chipHint = (number: number | undefined, missing: readonly (number | undefined)[]) =>
  [missing.includes(number) && '번역에 없음', number && tokenKey(number) && keyLabel(tokenKey(number)!)].filter(Boolean).join(' · ') || undefined;

export function SourceText({ parts, units = [], unitId, missing = [] }: { parts: SourcePart[]; units?: TokenUnit[]; unitId?: string; missing?: number[] }) {
  const insert = (text: string) => unitId && insertIntoLine(unitId, text);
  return (
    <Text as="p" breakWords preserveLines>
      {parts.map((part, index) => {
        if (part.token !== undefined)
          return (
            <TokenChip
              key={index}
              part={part}
              missing={!!part.token.number && missing.includes(part.token.number)}
              hint={unitId ? chipHint(part.token.number, missing) : undefined}
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
        if (part.term) return <TermMark key={index} term={part.term} text={part.text} onPut={unitId ? insert : undefined} />;
        return <span key={index}>{part.text}</span>;
      })}
    </Text>
  );
}

/** The source of the line being edited, with its tokens and terms (see SourceText); tokens the draft still lacks are ringed. */
export function LineSourceText({ projectId, unitId, source, translation }: { projectId: string; unitId: string; source: string; translation?: string | null }) {
  const line = useSourceParts(projectId, source);
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
          {chipLabel(part.token?.kind ?? 'single', part.token?.number ?? 0, part.text)}
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

type ConfirmedTerm = SourceTerm & { scope?: TermScope; matchCase?: boolean };

/**
 * A term in the open line's source, by what it asks: 고정 — a press puts its form at the cursor; 후보 — a press opens its
 * forms to pick one; 뉘앙스 — wavy, its sense in the tooltip, a press puts its example (if it has one).
 */
function TermMark({ term, text, onPut }: { term: SourceTerm; text: string; onPut?: (form: string) => void }) {
  const forms = termForms(term);
  const example = term.mode === 'guide' ? term.target.trim() : '';
  if (onPut && term.mode === 'choices' && forms.length > 1)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EditorTermMark pickable title={termLine(term)} onMouseDown={(event) => event.preventDefault()}>
            {text}
          </EditorTermMark>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
          {forms.map((form, index) => (
            <DropdownMenuItem key={form} onSelect={() => onPut(form)}>
              {form}{index === 0 && <Text marginLeft="auto" variant="caption" tone="muted">기본</Text>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  const put = term.mode === 'guide' ? example : forms[0];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <EditorTermMark nuance={term.mode === 'guide'} pickable={!!onPut && !!put} onMouseDown={(event) => onPut && put && (event.preventDefault(), onPut(put))}>
          {text}
        </EditorTermMark>
      </TooltipTrigger>
      <TooltipContent>{termLine(term)}</TooltipContent>
    </Tooltip>
  );
}
const matchers = new WeakMap<object, ReturnType<typeof glossaryMatcher<ConfirmedTerm>>>();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole word, any case, also next to Hangul or punctuation (the rule of `mentions` and the picked line's underlines). */
const wordPattern = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu');

/** One glossary matcher for every row of a list: built once per loaded glossary, not once per row. */
function useConfirmedTermMatcher(projectId: string) {
  const terms = useTerms(projectId).data;
  return useMemo(() => {
    if (!terms) return null;
    let matcher = matchers.get(terms);
    if (!matcher) {
      const confirmed = terms
        .filter(markedTerm)
        .map((term) => ({ source: term.source, target: term.target, mode: term.mode, alternatives: term.alternatives, note: term.note, scope: term.scope, matchCase: term.matchCase }))
        .sort((a, b) => b.source.length - a.source.length);
      matcher = glossaryMatcher(confirmed);
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
                <EditorTermMark key={at} dotted nuance={piece.term.mode === 'guide'} title={termLine(piece.term)}>{piece.text}</EditorTermMark>
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
