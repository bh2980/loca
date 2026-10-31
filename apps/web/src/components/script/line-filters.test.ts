import { describe, expect, it } from 'vitest';
import { filterChips, hasLineFilter, lineQueryParams, linesSearchSchema } from './line-filters';

describe('line filters for what a row shows', () => {
  it('reads 최종 아님, 정한 쪽, 메모, 번역 제외 and 청자 모름 from the URL', () => {
    expect(linesSearchSchema({ unfinished: true, decidedBy: 'ai', noted: 'false', excluded: 'only', listener: '-' })).toMatchObject({ unfinished: true, decidedBy: 'ai', noted: false, excluded: 'only', listener: '-' });
    expect(linesSearchSchema({ decidedBy: 'robot', excluded: 'all' })).toMatchObject({ decidedBy: undefined, excluded: undefined });
  });

  it('hides 번역 제외 unless the URL asks for it', () => {
    expect(lineQueryParams({}).excluded).toBe('hide');
    expect(lineQueryParams({ excluded: 'show' }).excluded).toBeUndefined();
    expect(lineQueryParams({ excluded: 'only', unfinished: false, noted: true, decidedBy: 'human' })).toMatchObject({ excluded: 'only', unfinished: '0', noted: '1', decidedBy: 'human' });
  });

  it('shows each as a chip; the default hidden 번역 제외 chip shows them when cleared', () => {
    const chips = filterChips({ unfinished: true, decidedBy: 'ai', listener: '-' }, [], []);
    expect(chips.map((chip) => chip.label)).toEqual(['청자: 모름', '상태: 최종 아님', '정한 쪽: AI', '번역 제외']);
    expect(chips.at(-1)).toMatchObject({ hidden: true, clear: { excluded: 'show' } });
    expect(hasLineFilter({ excluded: 'show' })).toBe(false);
    expect(hasLineFilter({ noted: false })).toBe(true);
  });
});
