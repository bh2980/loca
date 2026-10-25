import { useEffect, useState } from 'react';
import { Progress, Text } from '@loca/ui';

/** "2분 13초": how long something has been running, ticking every second while shown. */
export function Elapsed({ since, until }: { since: Date | string; until?: Date | string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  const seconds = Math.max(0, Math.round(((until ? new Date(until).getTime() : now) - new Date(since).getTime()) / 1000));
  return <Text tabular>{seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`}</Text>;
}

/**
 * Progress of a run or job. Counted when there is something to count; while a single long step is under way (one model call reading
 * the whole script) the bar moves instead of sitting at 0. `grow` lets it fill a row (at least 4rem).
 */
export function JobProgress({ done, total, running, grow = false }: { done: number; total: number; running: boolean; grow?: boolean }) {
  return <Progress value={total ? (done / total) * 100 : 0} indeterminate={running && done === 0 && total <= 1} grow={grow && 'reserve'} />;
}
