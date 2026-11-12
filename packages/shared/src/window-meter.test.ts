import { describe, expect, it } from 'vitest';
import { windowMeter } from './window-meter.ts';

describe('window meter', () => {
  it('is the share of the window the last input used, hidden when either is unknown', () => {
    expect(windowMeter({ inputTokens: 50_000, window: 200_000 })).toMatchObject({ percent: 25, level: 'ok' });
    expect(windowMeter({ inputTokens: 150_000, window: 200_000 })).toMatchObject({ percent: 75, level: 'ok' });
    expect(windowMeter({ inputTokens: 170_000, window: 200_000 })).toMatchObject({ percent: 85, level: 'high' });
    expect(windowMeter({ inputTokens: 190_000, window: 200_000 })).toMatchObject({ percent: 95, level: 'full' });
    // A turn summed over an agent's steps: no percent, no warning.
    expect(windowMeter({ inputTokens: 300_000, window: 200_000 })).toMatchObject({ percent: null, level: 'ok' });
    expect(windowMeter({ inputTokens: 0, window: 200_000 })?.percent).toBe(0);
    expect(windowMeter({ inputTokens: 5, window: null })).toBeNull();
    expect(windowMeter({ inputTokens: null, window: 200_000 })).toBeNull();
  });
});
