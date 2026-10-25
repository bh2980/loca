import { useEffect, useState } from 'react';
import { JobProgressBar, Text } from '@loca/ui';

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

/** Progress of a run or job (see `JobProgressBar`). */
export const JobProgress = JobProgressBar;
