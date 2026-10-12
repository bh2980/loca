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

export function TagChip({ tag }: { tag: StatusLike }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" style={{ backgroundColor: `${tag.color}1f`, color: tag.color }}>
      #{tag.name}
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
