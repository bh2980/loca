import { describe, expect, it } from 'vitest';
import { CHAT_IMAGE_MAX_BYTES, compactionMarker, contextMeter, dataUrlBytes, imageDecision, imageProblem, limitsFor } from './index.ts';

const png = (bytes: number) => `data:image/png;base64,${Buffer.alloc(bytes, 1).toString('base64')}`;

describe('chat images', () => {
  it('measures a data URL and rejects what cannot be sent', () => {
    expect(dataUrlBytes(png(10))).toBe(10);
    expect(dataUrlBytes(png(11))).toBe(11);
    expect(dataUrlBytes('https://x/y.png')).toBeNull();
    expect(imageProblem({ mediaType: 'image/png', url: png(100) })).toBeNull();
    expect(imageProblem({ mediaType: 'image/png', url: png(CHAT_IMAGE_MAX_BYTES + 1) })).toMatch(/5MB/);
    expect(imageProblem({ mediaType: 'image/svg+xml', url: png(10) })).toMatch(/형식/);
    expect(imageProblem({ mediaType: 'image/png', url: 'https://x/y.png' })).toMatch(/읽을 수 없/);
  });

  it('sends images unless the connection said the model takes none', () => {
    expect(imageDecision(true, 2)).toEqual({ support: 'yes', send: true, dropped: 0 });
    expect(imageDecision(undefined, 2)).toEqual({ support: 'unknown', send: true, dropped: 0 });
    expect(imageDecision(false, 2)).toEqual({ support: 'no', send: false, dropped: 2 });
    expect(imageDecision(false, 0)).toEqual({ support: 'no', send: false, dropped: 0 });
  });

  it('keeps the images flag in a model list entry without making the window known', () => {
    expect(limitsFor({ modelLimits: { m: { images: true, by: 'api' } } }, 'm')).toBeUndefined();
  });
});

describe('context meter', () => {
  it('is the share of the window the last input used, hidden when either is unknown', () => {
    expect(contextMeter({ inputTokens: 50_000, window: 200_000 })).toMatchObject({ percent: 25, level: 'ok' });
    expect(contextMeter({ inputTokens: 150_000, window: 200_000 })).toMatchObject({ percent: 75, level: 'high' });
    expect(contextMeter({ inputTokens: 190_000, window: 200_000 })).toMatchObject({ percent: 95, level: 'full' });
    expect(contextMeter({ inputTokens: 300_000, window: 200_000 })?.percent).toBe(100);
    expect(contextMeter({ inputTokens: 0, window: 200_000 })?.percent).toBe(0);
    expect(contextMeter({ inputTokens: 5, window: null })).toBeNull();
    expect(contextMeter({ inputTokens: null, window: 200_000 })).toBeNull();
  });
});

describe('compaction marker', () => {
  it('points before the first message the summary does not cover', () => {
    expect(compactionMarker({ upTo: 4, summary: '요약', at: 1 }, 7)).toEqual({ index: 4, summary: '요약', at: 1 });
    expect(compactionMarker(null, 7)).toBeNull();
    expect(compactionMarker({ upTo: 7, summary: '요약', at: 1 }, 7)).toBeNull();
    expect(compactionMarker({ upTo: 0, summary: '요약', at: 1 }, 7)).toBeNull();
  });
});
