import { useEffect, useState } from 'react';
import { Progress } from '@loca/ui';
import { cn } from '@/lib/utils';

/** "2분 13초": how long something has been running, ticking every second while shown. */
export function Elapsed({ since, until }: { since: Date | string; until?: Date | string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  const seconds = Math.max(0, Math.round(((until ? new Date(until).getTime() : now) - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`}</span>;
}

/**
 * Progress of a run or job. Counted when there is something to count; while a single long step is
 * under way (one model call reading the whole script) the bar moves instead of sitting at 0.
 */
export function JobProgress({ done, total, running, className }: { done: number; total: number; running: boolean; className?: string }) {
  if (running && done === 0 && total <= 1)
    return (
      <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20', className)} role="progressbar" aria-label="진행 중">
        <div className="absolute inset-y-0 w-2/5 rounded-full bg-primary" style={{ animation: 'indeterminate 1.4s ease-in-out infinite' }} />
      </div>
    );
  return <Progress value={total ? (done / total) * 100 : 0} className={cn('h-1.5', className)} />;
}
