import { describe, expect, it } from 'vitest';
import { isFreeModel } from './connections.ts';

describe('isFreeModel', () => {
  it('opencode "-free" models and big-pickle are free; others and other kinds are not', () => {
    expect(isFreeModel('opencode', 'opencode/beam-free')).toBe(true);
    expect(isFreeModel('opencode', 'opencode/big-pickle')).toBe(true);
    expect(isFreeModel('opencode', 'opencode/gpt-5')).toBe(false);
    expect(isFreeModel('openai', 'beam-free')).toBe(false);
    expect(isFreeModel('opencode', null)).toBe(false);
  });
});
