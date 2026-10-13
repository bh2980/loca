import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { chipLabel, splitTokens, useLineContext, type SourcePart } from '@/lib/line-context';
import { cn } from '@/lib/utils';
import { insertIntoLine } from './translation-input';

/**
 * A line's source as the translator reads it: format tokens as chips and confirmed glossary terms
 * underlined (hover for the translation). With the line's editor open, clicking either puts it at
 * the cursor.
 */
export function SourceText({ parts, unitId, className }: { parts: SourcePart[]; unitId?: string; className?: string }) {
  const insert = (text: string) => unitId && insertIntoLine(unitId, text);
  return (
    <p className={cn('break-words whitespace-pre-wrap', className)}>
      {parts.map((part, index) => {
        if (part.token !== undefined)
          return (
            <TokenChip
              key={index}
              part={part}
              hint={unitId ? `눌러서 번역에 넣기${part.token && part.token <= 9 ? ` (⌘${part.token})` : ''}` : undefined}
              onPick={unitId ? () => insert(part.text) : undefined}
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
  return <SourceText parts={line.parts} unitId={unitId} className={className} />;
}

/** A numbered format token (#1); the full token shows on hover. */
export function TokenChip({ part, hint, onPick }: { part: SourcePart; hint?: string; onPick?: () => void }) {
  return (
    <span
      title={hint ? `${part.text}\n${hint}` : part.text}
      className={cn('mx-px rounded-sm border bg-muted px-1 font-mono text-xs text-muted-foreground', !part.token && 'border-warning/40 bg-warning/10 text-warning', onPick && 'cursor-pointer hover:border-ring')}
      onMouseDown={onPick && ((event) => (event.preventDefault(), onPick()))}
    >
      {chipLabel(part.token ?? 0)}
    </span>
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
