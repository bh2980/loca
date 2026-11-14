import { describe, expect, it } from 'vitest';
import { allowedLevels, speechFit, speechSpectrumLabel } from './knowledge.ts';

const captain = { level: 'hage' as const, sometimes: [{ level: 'hae' as const, when: '편할 때' }, { level: 'haera' as const, when: '급할 때' }], never: ['haeyo' as const, 'hasipsio' as const] };

describe('a speech spectrum', () => {
  it('tells where a translated level falls: usual, sometimes, ruled out, or none of them', () => {
    expect(speechFit(captain, 'hage')).toBe('usual');
    expect(speechFit(captain, 'haera')).toBe('sometimes');
    expect(speechFit(captain, 'haeyo')).toBe('never');
    expect(speechFit(captain, 'hao')).toBe('unlisted');
    expect(speechFit(captain, null)).toBeNull();
    // A rule of one level reads as before: another level is only worth a look.
    expect(speechFit({ level: 'haeyo' }, 'hae')).toBe('unlisted');
    expect(speechFit({ level: 'other' }, 'hae')).toBeNull();
  });

  it('allows the usual level and those used sometimes', () => {
    expect(allowedLevels(captain)).toEqual(['hage', 'hae', 'haera']);
  });

  it('reads in a few words, and a plain rule as its level alone', () => {
    expect(speechSpectrumLabel(captain)).toBe('주로 하게체 · 가끔 편할 때 해체(반말), 급할 때 해라체 · 안 씀: 해요체, 하십시오체');
    expect(speechSpectrumLabel({ level: 'haeyo' })).toBe('해요체');
  });
});
