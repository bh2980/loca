import { describe, expect, it } from 'vitest';
import { filterChips, hasLineFilter, lineFilterCount, lineFilterOf, lineQueryParams, linesSearchSchema } from './line-filters';

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

describe('the list as the filter an export starts from', () => {
  it('carries the scope and what the URL filters', () => {
    expect(lineFilterOf({ q: 'tower', statuses: ['s1'], listener: 'Bob' }, { groupId: 'g1', kind: 'scene' })).toMatchObject({ groups: ['g1'], groupKind: 'scene', q: 'tower', statuses: ['s1'], listeners: ['Bob'] });
    expect(lineFilterOf({}, { section: 'Chapter 1' })).toMatchObject({ sections: ['Chapter 1'] });
  });

  it('keeps 번역 제외 lines the list hides: the file decides what becomes of them', () => {
    expect(lineFilterOf({}).excluded).toBeUndefined();
    expect(lineFilterOf({ excluded: 'show' }).excluded).toBeUndefined();
    expect(lineFilterOf({ excluded: 'only' }).excluded).toBe('only');
  });

  it('narrows the review inbox to its statuses, and an empty answer stays empty', () => {
    expect(lineFilterOf({}, { reviewStatuses: ['r1', 'r2'] }).statuses).toEqual(['r1', 'r2']);
    expect(lineFilterOf({ statuses: ['r2', 'x'] }, { reviewStatuses: ['r1', 'r2'] }).statuses).toEqual(['r2']);
    expect(lineFilterOf({ statuses: ['x'] }, { reviewStatuses: ['r1'] }).statuses).toEqual(['__none__']);
    expect(lineFilterOf({}, { reviewStatuses: [] }).statuses).toEqual(['__none__']);
  });

  it('counts what a person set', () => {
    expect(lineFilterCount({})).toBe(0);
    expect(lineFilterCount({ q: 'a', statuses: ['s1'], unfinished: false })).toBe(3);
  });
});
