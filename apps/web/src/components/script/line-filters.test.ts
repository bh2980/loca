import { describe, expect, it } from 'vitest';
import { lineFilterSchema } from '@tw/shared';
import { exportFilterOf, filterChips, hasLineFilter, lineFilterCount, lineFilterOf, linesSearchSchema, speakerChoices } from './line-filters';

describe('line filters for what a row shows', () => {
  it('reads 최종 아님, 정한 쪽, 메모, 번역 제외 and 청자 모름 from the URL', () => {
    expect(linesSearchSchema({ unfinished: true, decidedBy: 'ai', noted: 'false', excluded: 'only', listener: '-' })).toMatchObject({ unfinished: true, decidedBy: 'ai', noted: false, excluded: 'only', listener: '-' });
    expect(linesSearchSchema({ decidedBy: 'robot', excluded: 'all' })).toMatchObject({ decidedBy: undefined, excluded: undefined });
  });

  it('hides 번역 제외 unless the URL asks for it', () => {
    expect(lineFilterOf({}).excluded).toBe('hide');
    expect(lineFilterOf({ excluded: 'show' }).excluded).toBeUndefined();
    expect(lineFilterOf({ excluded: 'only', unfinished: false, noted: true, decidedBy: 'human' })).toMatchObject({ excluded: 'only', unfinished: false, noted: true, decidedBy: 'human' });
  });

  it('shows each as a chip; the default hidden 번역 제외 chip shows them when cleared', () => {
    const chips = filterChips({ unfinished: true, decidedBy: 'ai', listener: '-' }, [], []);
    expect(chips.map((chip) => chip.label)).toEqual(['청자: 모름', '상태: 최종 아님', '정한 쪽: AI', '번역 제외']);
    expect(chips.at(-1)).toMatchObject({ hidden: true, clear: { excluded: 'show' } });
    expect(hasLineFilter({ excluded: 'show' })).toBe(false);
    expect(hasLineFilter({ noted: false })).toBe(true);
  });
});

describe('the list as the one line filter', () => {
  it('carries where the list is and what the URL filters', () => {
    expect(lineFilterOf({ q: 'tower', statuses: ['s1'], listener: 'Bob' }, { groupId: 'g1', kind: 'scene' })).toMatchObject({ groups: ['g1'], groupKind: 'scene', q: 'tower', statuses: ['s1'], listeners: ['Bob'] });
    expect(lineFilterOf({}, { section: 'Chapter 1' })).toMatchObject({ sections: ['Chapter 1'] });
  });

  it('is a filter the server takes, whatever the URL holds (the server refuses a field it does not know)', () => {
    const everything = linesSearchSchema({ q: 'tide', statuses: ['s1'], tags: ['t1'], speakers: ['Mira'], hideStatuses: ['s2'], hideSpeakers: ['Jonas'], hideTags: ['t2'], hideMarks: ['diverged'], listener: '-', unfinished: 'true', decidedBy: 'ai', noted: 'false', excluded: 'only', marks: ['aiSuggestion'], mode: 'find', page: 3, line: 'u1', detail: true });
    const filter = lineFilterOf(everything, { groupId: 'g1', section: 'Chapter 1', kind: 'scene', review: true });
    expect(lineFilterSchema.parse({ ...filter, offset: 100, limit: 100 })).toMatchObject({ groups: ['g1'], sections: ['Chapter 1'], groupKind: 'scene', review: true, q: 'tide', statuses: ['s1'], tags: ['t1'], speakers: ['Mira'], listeners: ['-'], marks: ['aiSuggestion'], hideStatuses: ['s2'], hideSpeakers: ['Jonas'], hideTags: ['t2'], hideMarks: ['diverged'], unfinished: true, decidedBy: 'ai', noted: false, excluded: 'only' });
    // Nothing set: no empty lists go out (the server refuses those), only the default hiding of 번역 제외.
    expect(lineFilterSchema.parse(lineFilterOf(linesSearchSchema({ statuses: [], tags: [], speakers: [] })))).toEqual({ excluded: 'hide', offset: 0, limit: 200 });
  });

  it('an export keeps 번역 제외 lines the list hides: the file decides what becomes of them', () => {
    expect(exportFilterOf(lineFilterOf({})).excluded).toBeUndefined();
    expect(exportFilterOf(lineFilterOf({ excluded: 'show' })).excluded).toBeUndefined();
    expect(exportFilterOf(lineFilterOf({ excluded: 'only' })).excluded).toBe('only');
    expect(exportFilterOf(lineFilterOf({ q: 'a' }, { groupId: 'g1', review: true }))).toMatchObject({ groups: ['g1'], review: true, q: 'a' });
  });

  it('the review inbox is said as such, beside the statuses the URL picks (the server narrows to both)', () => {
    expect(lineFilterOf({}, { review: true })).toMatchObject({ review: true, statuses: undefined });
    expect(lineFilterOf({ statuses: ['r2', 'x'] }, { review: true })).toMatchObject({ review: true, statuses: ['r2', 'x'] });
    expect(lineFilterOf({}).review).toBeUndefined();
  });

  it('offers a person once in the speaker filter, under every spelling the script gives them', () => {
    const rows = [
      { speaker: 'Mira', lines: 40, character: 'Mira' },
      { speaker: 'Jonas', lines: 50, character: 'Jonas' },
      { speaker: 'MIRA_KEY', lines: 15, character: 'Mira' },
      { speaker: 'Stranger', lines: 2, character: null },
      { speaker: null, lines: 99, character: null },
    ];
    expect(speakerChoices(rows)).toEqual([{ name: 'Mira', lines: 55 }, { name: 'Jonas', lines: 50 }, { name: 'Stranger', lines: 2 }]);
  });

  it('counts what a person set', () => {
    expect(lineFilterCount({})).toBe(0);
    expect(lineFilterCount({ q: 'a', statuses: ['s1'], unfinished: false })).toBe(3);
  });
});
