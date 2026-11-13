import { describe, expect, it } from 'vitest';
import { diffRows, diffStats } from './text-diff';

describe('diffRows', () => {
  it('marks only the changed word for one-line values', () => {
    expect(diffRows('Hello brave world', 'Hello quiet world')).toEqual([
      { type: 'removed', parts: [{ text: 'Hello ' }, { text: 'brave', mark: true }, { text: ' world' }] },
      { type: 'added', parts: [{ text: 'Hello ' }, { text: 'quiet', mark: true }, { text: ' world' }] },
    ]);
  });

  it('folds unchanged runs with 2 context lines around a changed line in 20 lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const modified = [...lines];
    modified[9] = 'line 10 changed';

    const rows = diffRows(lines.join('\n'), modified.join('\n'));
    expect(rows).toEqual([
      { type: 'folded', count: 7 },
      { type: 'same', parts: [{ text: 'line 8' }] },
      { type: 'same', parts: [{ text: 'line 9' }] },
      { type: 'removed', parts: [{ text: 'line 10' }] },
      { type: 'added', parts: [{ text: 'line 10' }, { text: ' changed', mark: true }] },
      { type: 'same', parts: [{ text: 'line 11' }] },
      { type: 'same', parts: [{ text: 'line 12' }] },
      { type: 'folded', count: 8 },
    ]);
  });

  it('handles an added line at the end', () => {
    const before = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n') + '\n';
    const after = `${before}seven\n`;
    expect(diffRows(before, after)).toEqual([
      { type: 'folded', count: 4 },
      { type: 'same', parts: [{ text: 'five' }] },
      { type: 'same', parts: [{ text: 'six' }] },
      { type: 'added', parts: [{ text: 'seven' }] },
    ]);
  });

  it('returns same rows only when texts are equal', () => {
    expect(diffRows('same', 'same')).toEqual([{ type: 'same', parts: [{ text: 'same' }] }]);
    expect(diffRows('a\nb\nc\nd\ne\nf', 'a\nb\nc\nd\ne\nf')).toEqual([
      { type: 'same', parts: [{ text: 'a' }] },
      { type: 'same', parts: [{ text: 'b' }] },
      { type: 'same', parts: [{ text: 'c' }] },
      { type: 'same', parts: [{ text: 'd' }] },
      { type: 'same', parts: [{ text: 'e' }] },
      { type: 'same', parts: [{ text: 'f' }] },
    ]);
  });
});

describe('diffStats', () => {
  it('counts added and removed lines for one-line and multi-line texts', () => {
    expect(diffStats('same', 'same')).toEqual({ added: 0, removed: 0 });
    expect(diffStats('old', 'new')).toEqual({ added: 1, removed: 1 });
    expect(diffStats('a\nb\nc\n', 'a\nx\ny\nc\n')).toEqual({ added: 2, removed: 1 });
  });

  it('cuts long unchanged text around a one-word change down to its ends', () => {
    const tail = ' and the rest of a long paragraph that does not change at all, going on for quite a while longer than anyone reads'.repeat(2);
    const rows = diffRows(`Pass it only if${tail}`, `Pass it only when${tail}`);
    const removed = rows.find((row) => row.type === 'removed');
    const text = removed && 'parts' in removed ? removed.parts.map((part) => part.text).join('') : '';
    expect(text.length).toBeLessThan(120);
    expect(text.endsWith('…')).toBe(true);
  });

  it('marks words when a line is split in two', () => {
    const rows = diffRows('Translate each line. Keep tags.', 'Translate each line.\nNever add honorifics. Keep tags.');
    expect(rows.filter((row) => row.type === 'added')).toHaveLength(2);
    const added = rows.filter((row) => row.type === 'added').flatMap((row) => ('parts' in row ? row.parts : []));
    expect(added.some((part) => part.mark && part.text.includes('honorifics'))).toBe(true);
  });
});
