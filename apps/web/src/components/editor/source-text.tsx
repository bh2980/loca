import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { tokenLabel, useLineContext, type SourcePart } from '@/lib/line-context';
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
        if (part.token)
          return (
            <span
              key={index}
              title={`${part.text}${unitId ? '\n눌러서 번역에 넣기 (⌘1…⌘9)' : ''}`}
              className={cn('rounded-sm border bg-muted px-0.5 font-mono text-xs text-muted-foreground', unitId && 'cursor-pointer hover:border-ring')}
              onMouseDown={(event) => unitId && (event.preventDefault(), insert(part.text))}
            >
              {tokenLabel(part.text)}
            </span>
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
