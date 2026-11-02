import { describe, expect, it } from 'vitest';
import { particle } from './josa';

describe('particle', () => {
  it('follows the last syllable', () => {
    expect(particle('번역', '이', '가')).toBe('이');
    expect(particle('색상, 설명', '이', '가')).toBe('이');
    expect(particle('노트', '이', '가')).toBe('가');
  });
  it('keeps both forms when the word does not end in Hangul', () => {
    expect(particle('REEVE', '이', '가')).toBe('이(가)');
  });
});
