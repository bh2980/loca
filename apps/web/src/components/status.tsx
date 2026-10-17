import { useParams } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { AUTO_MARKS, markColor, type AutoMark } from '@tw/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { useMarkColors } from '@/lib/queries';
import { cn } from '@/lib/utils';

export interface StatusLike {
  id: string;
  name: string;
  color: string;
}

export function StatusDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />;
}

/** Status pill: colored dot + name. Color is never the only signal. */
export function StatusBadge({ status, className }: { status?: StatusLike; className?: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs font-medium whitespace-nowrap', className)}>
      <StatusDot color={status.color} />
      {status.name}
    </span>
  );
}

/**
 * A tag's chip colors: a light tint of the color behind text darkened toward the foreground, so
 * light colors (amber, gray) stay readable; in dark mode the foreground is light and the mix follows.
 */
export const chipStyle = (color: string) => ({
  backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
  color: `color-mix(in oklab, ${color} 55%, var(--foreground))`,
});

export function TagChip({ tag }: { tag: StatusLike }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" style={chipStyle(tag.color)}>
      #{tag.name}
    </span>
  );
}

/**
 * An automatic mark as a tag: the same chip, in the project's color for it (설정 › 상태·태그).
 * The project comes from the route unless given (the chat panel sits outside it on some pages).
 */
export function MarkChip({ mark, projectId, className }: { mark: AutoMark; projectId?: string; className?: string }) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const colors = useMarkColors(projectId ?? params.projectId);
  const color = markColor(mark, colors);
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', className)} style={chipStyle(color)} title={AUTO_MARKS[mark].description}>
      #{AUTO_MARKS[mark].name}
    </span>
  );
}

/** Horizontal stacked bar of line counts per status. */
export function StatusBar({ statuses, counts, className }: { statuses: StatusLike[]; counts: Record<string, number>; className?: string }) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="img" aria-label={statuses.map((status) => `${status.name} ${counts[status.id] ?? 0}`).join(', ')}>
      {total > 0 && statuses.map((status) => (counts[status.id] ? <div key={status.id} style={{ width: `${(counts[status.id] / total) * 100}%`, backgroundColor: status.color }} /> : null))}
    </div>
  );
}

/**
 * ✦ beside a status or 확정 that AI set and no person has looked at since (docs/DESIGN.md 3.5).
 * The same mark everywhere: lines, knowledge, terms. Renders nothing when a person set it.
 */
export function AiMark({ by, className }: { by: 'ai' | 'human' | null | undefined; className?: string }) {
  if (by !== 'ai') return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label="AI가 정함" className={cn('inline-flex shrink-0 text-muted-foreground', className)}>
          <Sparkles className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>AI가 정함 · 아직 사람이 확인하지 않음</TooltipContent>
    </Tooltip>
  );
}
