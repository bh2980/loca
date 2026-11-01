import { describe, expect, it } from 'vitest';
import { mergeLines } from './merge-lines';

const line = (id: string) => ({ id, source: `line ${id}` });

describe('mergeLines', () => {
  it('shows a line both applied and cited once, with both reasons', () => {
    const merged = mergeLines([
      { reason: 'applied', lines: [line('a'), line('b')], note: '해요체' },
      { reason: 'evidence', lines: [line('b'), line('c')] },
    ]);
    expect(merged.map((item) => item.line.id)).toEqual(['a', 'b', 'c']);
    expect(merged.map((item) => item.reasons)).toEqual([['applied'], ['applied', 'evidence'], ['evidence']]);
    expect(merged.map((item) => item.notes)).toEqual([['해요체'], ['해요체'], []]);
  });

  it('keeps 말투 적용 before 근거 whichever source came first', () => {
    const [merged] = mergeLines([
      { reason: 'evidence', lines: [line('a')] },
      { reason: 'applied', lines: [line('a')], note: '해체' },
    ]);
    expect(merged.reasons).toEqual(['applied', 'evidence']);
  });

  it('cites a line once when two items cite it, and keeps each rule’s level once', () => {
    const merged = mergeLines([
      { reason: 'applied', lines: [line('a')], note: '해요체' },
      { reason: 'applied', lines: [line('a')], note: '해요체' },
      { reason: 'applied', lines: [line('a')], note: '해체' },
      { reason: 'evidence', lines: [line('a'), line('a')] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reasons).toEqual(['applied', 'evidence']);
    expect(merged[0].notes).toEqual(['해요체', '해체']);
  });

  it('is empty without lines', () => {
    expect(mergeLines([])).toEqual([]);
    expect(mergeLines([{ reason: 'evidence', lines: [] }])).toEqual([]);
  });
});
