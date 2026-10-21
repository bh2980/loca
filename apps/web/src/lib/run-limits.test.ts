import { describe, expect, it } from 'vitest';
import { resumeLimits, startLimits } from './run-limits';

describe('run caps', () => {
  it('starts with the suggestion until the person changes or clears a field', () => {
    const suggested = { maxCalls: 100, maxInputTokens: 5000 };
    expect(startLimits(suggested, {})).toEqual(suggested);
    expect(startLimits(suggested, { maxCalls: 150 })).toEqual({ maxCalls: 150, maxInputTokens: 5000 });
    expect(startLimits(suggested, { maxInputTokens: null })).toEqual({ maxCalls: 100 });
    expect(startLimits(undefined, { maxCalls: null })).toEqual({});
    expect(startLimits({ maxCalls: 100 }, { maxInputTokens: 900 })).toEqual({ maxCalls: 100, maxInputTokens: 900 });
  });

  it('sends null for a cap that was emptied, and nothing for one that never existed', () => {
    expect(resumeLimits({ maxCalls: 10 }, { maxCalls: 20 })).toEqual({ maxCalls: 20 });
    expect(resumeLimits({ maxCalls: 10, maxInputTokens: 99 }, { maxCalls: 20 })).toEqual({ maxCalls: 20, maxInputTokens: null });
    expect(resumeLimits({ maxCalls: 10 }, { maxCalls: 20, maxInputTokens: 50 })).toEqual({ maxCalls: 20, maxInputTokens: 50 });
    expect(resumeLimits(undefined, {})).toEqual({});
  });
});
