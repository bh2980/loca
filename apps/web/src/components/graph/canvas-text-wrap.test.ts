import { describe, expect, it } from 'vitest';
import { wrapTextLines } from './canvas-text-wrap';

const measure = (text: string) => Array.from(text).length;

describe('wrapTextLines', () => {
  it('keeps Latin words together at whitespace when possible', () => {
    expect(wrapTextLines('moving forward', 7, 2, measure)).toEqual(['moving', 'forward']);
    expect(wrapTextLines('moving.', 6, 2, measure)).toEqual(['movin', 'g.']);
  });

  it('allows dense CJK text to break at character boundaries', () => {
    expect(wrapTextLines('你好世界', 2, 2, measure)).toEqual(['你好', '世界']);
  });

  it('breaks an unspaced long token without exceeding the width', () => {
    expect(wrapTextLines('abcdefgh', 3, 3, measure)).toEqual(['abc', 'def', 'gh']);
  });

  it('adds an ellipsis to the last visible line when content is truncated', () => {
    const lines = wrapTextLines('alpha beta gamma', 6, 2, measure);
    expect(lines).toEqual(['alpha', 'beta…']);
    expect(lines.every((line) => measure(line) <= 6)).toBe(true);
  });
});
