/** How `pnpm budget` judges a scenario against its baseline (scripts/budget.ts); kept apart so it can be tested. */

export const TOLERANCE = { calls: 0.1, inputPerLine: 0.1, failedShare: 0.02 };

/** What the comparison reads from a scenario's run. */
export interface Compared {
  /** The run's end state; the baseline's is the one the scenario is expected to reach. */
  status: string;
  notice?: string | null;
  /** Lines with work still queued or running when the run stopped (0 for a finished run). */
  unfinishedLines?: number;
  calls: number;
  inputPerLine: number;
  failedLineShare: number;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/**
 * Regressions (fail) and improvements (note) of one scenario against its baseline. Costs are only
 * compared between runs that did the same work: a run that ends in another state than the baseline
 * (paused instead of completed) or leaves more lines unfinished is a regression, never a saving.
 */
export function compare(now: Compared, base: Compared) {
  const regressions: string[] = [];
  const improvements: string[] = [];
  if (now.status !== base.status) regressions.push(`run status ${base.status} → ${now.status}${now.notice ? ` (${now.notice})` : ''}; costs not compared`);
  const unfinished = now.unfinishedLines ?? 0;
  const baseUnfinished = base.unfinishedLines ?? 0;
  if (unfinished > baseUnfinished) regressions.push(`unfinished lines ${baseUnfinished} → ${unfinished}; costs not compared`);
  if (regressions.length) return { regressions, improvements };
  const relative = (name: string, a: number, b: number, tolerance: number) => {
    if (a > b * (1 + tolerance)) regressions.push(`${name} ${b} → ${a} (+${(((a - b) / b) * 100).toFixed(0)}%, allowed +${tolerance * 100}%)`);
    else if (a < b * (1 - tolerance)) improvements.push(`${name} ${b} → ${a}`);
  };
  relative('model calls', now.calls, base.calls, TOLERANCE.calls);
  relative('input tokens per line', now.inputPerLine, base.inputPerLine, TOLERANCE.inputPerLine);
  const delta = now.failedLineShare - base.failedLineShare;
  if (delta > TOLERANCE.failedShare) regressions.push(`failed-line share ${pct(base.failedLineShare)} → ${pct(now.failedLineShare)} (allowed +${TOLERANCE.failedShare * 100} points)`);
  else if (delta < -TOLERANCE.failedShare) improvements.push(`failed-line share ${pct(base.failedLineShare)} → ${pct(now.failedLineShare)}`);
  return { regressions, improvements };
}
