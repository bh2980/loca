import { cn } from '@/lib/utils';

const LABEL = { running: '실행 중', paused: '일시정지', completed: '완료', failed: '실패', cancelled: '취소됨' } as const;
const DOT = { running: 'bg-primary', paused: 'bg-warning', completed: 'bg-muted-foreground/50', failed: 'bg-destructive', cancelled: 'bg-muted-foreground/50' } as const;

/** One pill for the state of any run or job, same look as `StatusBadge`: a dot (running = primary, paused = warning, failed = destructive, the rest muted) and the label. */
export function JobStatusBadge({ status, className }: { status: keyof typeof LABEL; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs font-medium whitespace-nowrap', className)}>
      <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', DOT[status])} />
      {LABEL[status]}
    </span>
  );
}
