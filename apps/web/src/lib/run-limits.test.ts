import { describe, expect, it } from 'vitest';
import { resumeLimits, startCaps, startLimits } from './run-limits';

describe('run caps', () => {
  it('asks only for what the person changed or cleared; the server suggests the rest', () => {
    expect(startLimits({})).toEqual({});
    expect(startLimits({ maxCalls: 150 })).toEqual({ maxCalls: 150 });
    expect(startLimits({ maxInputTokens: null })).toEqual({ maxInputTokens: null });
    expect(startLimits({ maxCalls: null, maxInputTokens: 900 })).toEqual({ maxCalls: null, maxInputTokens: 900 });
  });

  it('sends null for a cap that was emptied, and nothing for one that never existed', () => {
    expect(resumeLimits({ maxCalls: 10 }, { maxCalls: 20 })).toEqual({ maxCalls: 20 });
    expect(resumeLimits({ maxCalls: 10, maxInputTokens: 99 }, { maxCalls: 20 })).toEqual({ maxCalls: 20, maxInputTokens: null });
    expect(resumeLimits({ maxCalls: 10 }, { maxCalls: 20, maxInputTokens: 50 })).toEqual({ maxCalls: 20, maxInputTokens: 50 });
    expect(resumeLimits(undefined, {})).toEqual({});
  });

  it('says the caps a proposed run starts with: the suggestion unless it asks otherwise', () => {
    expect(startCaps(undefined, { maxCalls: 1300, maxInputTokens: 2_000_000 })).toBe('호출 1,300회 · 입력 토큰 2,000,000에서 멈춤');
    expect(startCaps({ maxCalls: 50 }, { maxCalls: 1300 })).toBe('호출 50회에서 멈춤');
    expect(startCaps({ maxCalls: null }, { maxCalls: 1300, maxInputTokens: 900 })).toBe('입력 토큰 900에서 멈춤');
    expect(startCaps({ maxCalls: null }, { maxCalls: 1300 })).toBe('없음');
    expect(startCaps(undefined, undefined)).toBe('없음');
  });
});
