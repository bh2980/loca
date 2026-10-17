import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { splitTokens, useLineContext, type SourcePart } from '@/lib/line-context';
import { chipHue, chipLabel, type TokenUnit } from '@/lib/tokens';
import { cn } from '@/lib/utils';
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
export function SourceText({ parts, units = [], unitId, missing = [], className }: { parts: SourcePart[]; units?: TokenUnit[]; unitId?: string; missing?: number[]; className?: string }) {
  const insert = (text: string) => unitId && insertIntoLine(unitId, text);
  return (
    <p className={cn('break-words whitespace-pre-wrap', className)}>
      {parts.map((part, index) => {
        if (part.token !== undefined)
          return (
            <TokenChip
              key={index}
              part={part}
              missing={!!part.token.number && missing.includes(part.token.number)}
              hint={unitId ? `${missing.includes(part.token.number) ? '번역에 없음 · ' : ''}눌러서 넣기${part.token.number && part.token.number <= 9 ? ` (${keyLabel(`Alt+${part.token.number}`)})` : ''}` : undefined}
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
                <span
                  className={cn('underline decoration-primary/40 decoration-2 underline-offset-4', unitId && 'cursor-pointer hover:decoration-primary')}
                  onMouseDown={(event) => unitId && (event.preventDefault(), insert(part.term!.target))}
                >
                  {part.text}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {part.term.source} → {part.term.target}
                {unitId && <span className="text-muted-foreground"> · 눌러서 넣기</span>}
              </TooltipContent>
            </Tooltip>
          );
        return <span key={index}>{part.text}</span>;
      })}
    </p>
  );
}

/** The source of the line being edited, with its tokens and terms (see SourceText); tokens the draft still lacks are ringed. */
export function LineSourceText({ projectId, unitId, source, translation, className }: { projectId: string; unitId: string; source: string; translation?: string | null; className?: string }) {
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
      <SourceText parts={line.parts} units={line.units} unitId={unitId} missing={missing} className={className} />
    </TermPick>
  );
}

/** A numbered format token (#1); the full token shows in a tooltip on hover. */
export function TokenChip({ part, hint, onPick, missing = false }: { part: SourcePart; hint?: string; onPick?: () => void; missing?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('token-chip', chipHue(part.token?.number ?? 0), !part.token?.number && 'token-chip-stray', missing && 'ring-1 ring-warning', onPick && 'cursor-pointer hover:border-ring')}
          onMouseDown={onPick && ((event) => (event.preventDefault(), onPick()))}
        >
          {chipLabel(part.token?.kind ?? 'single', part.token?.number ?? 0)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-md text-sm">
        <span className="font-mono break-all">{part.text}</span>
        {!part.token?.number && <span className="block opacity-70">원문에 없는 서식</span>}
        {hint && <span className="block opacity-70">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Read-only text (a line in the list, a translation) with its format tokens as numbered chips. */
export function TokenText({ text, source, pattern, className }: { text: string; source: string; pattern: RegExp | null; className?: string }) {
  const parts = splitTokens(text, source, pattern);
  return (
    // A span (block), so it can sit inside a button as well as a list row.
    <span className={cn('block break-words whitespace-pre-wrap', className)}>
      {parts.map((part, index) => (part.token !== undefined ? <TokenChip key={index} part={part} /> : <span key={index}>{part.text}</span>))}
    </span>
  );
}
