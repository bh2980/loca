import { describe, expect, it } from 'vitest';
import { compare } from './budget-compare.ts';

const base = { status: 'completed', unfinishedLines: 0, calls: 480, inputPerLine: 1324.5, failedLineShare: 0.0019 };

describe('budget compare', () => {
  it('fails a run that paused where the baseline completed, however little it spent', () => {
    const result = compare({ status: 'paused', notice: '호출이 3번 연달아 실패해서 멈췄습니다.', unfinishedLines: 2100, calls: 392, inputPerLine: 1038.1, failedLineShare: 0.001 }, base);
    expect(result.regressions).toEqual([expect.stringContaining('run status completed → paused'), 'unfinished lines 0 → 2100; costs not compared']);
    expect(result.improvements).toEqual([]);
  });

  it('fails a run that left lines unfinished even in the same state', () => {
    const result = compare({ ...base, unfinishedLines: 40, calls: 300 }, base);
    expect(result.regressions).toEqual(['unfinished lines 0 → 40; costs not compared']);
    expect(result.improvements).toEqual([]);
  });

  it('fails a completed run where the baseline expects a pause', () => {
    expect(compare(base, { ...base, status: 'paused' }).regressions).toEqual(['run status paused → completed; costs not compared']);
  });

  it('compares costs between runs that did the same work', () => {
    expect(compare({ ...base, calls: 540 }, base).regressions).toEqual([expect.stringContaining('model calls 480 → 540')]);
    expect(compare({ ...base, calls: 400 }, base)).toEqual({ regressions: [], improvements: ['model calls 480 → 400'] });
    expect(compare({ ...base, calls: 500 }, base)).toEqual({ regressions: [], improvements: [] });
  });
});
