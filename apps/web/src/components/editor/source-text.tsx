import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { splitTokens, useLineContext, type SourcePart } from '@/lib/line-context';
import { chipLabel, type TokenUnit } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { insertIntoLine, insertUnitIntoLine } from './translation-input';

/**
 * A line's source as the translator reads it: format tokens as chips and confirmed glossary terms
 * underlined (hover for the translation). With the line's editor open, clicking either puts it at
 * the cursor.
 */
export function SourceText({ parts, units = [], unitId, className }: { parts: SourcePart[]; units?: TokenUnit[]; unitId?: string; className?: string }) {
  const insert = (text: string) => unitId && insertIntoLine(unitId, text);
  return (
    <p className={cn('break-words whitespace-pre-wrap', className)}>
      {parts.map((part, index) => {
        if (part.token !== undefined)
          return (
            <TokenChip
              key={index}
              part={part}
              hint={unitId ? `눌러서 번역에 넣기${part.token.number && part.token.number <= 9 ? ` (⌘${part.token.number}${part.token.kind === 'single' ? '' : ', 고른 글자를 감쌈'})` : ''}` : undefined}
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

/** The source of the line being edited, with its tokens and terms (see SourceText). */
export function LineSourceText({ projectId, unitId, source, className }: { projectId: string; unitId: string; source: string; className?: string }) {
  const line = useLineContext(projectId, source);
  return <SourceText parts={line.parts} units={line.units} unitId={unitId} className={className} />;
}

/** A numbered format token (#1); the full token shows in a tooltip on hover. */
export function TokenChip({ part, hint, onPick }: { part: SourcePart; hint?: string; onPick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('token-chip', !part.token?.number && 'token-chip-stray', onPick && 'cursor-pointer hover:border-ring')}
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
