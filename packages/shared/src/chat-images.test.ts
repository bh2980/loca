import { describe, expect, it } from 'vitest';
import { CHAT_IMAGE_MAX_BYTES, compactionMarker, dataUrlBytes, imageDecision, imageProblem, limitsFor } from './index.ts';

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

describe('compaction marker', () => {
  it('points before the first message the summary does not cover', () => {
    expect(compactionMarker({ upTo: 4, summary: '요약', at: 1 }, 7)).toEqual({ index: 4, summary: '요약', at: 1 });
    expect(compactionMarker(null, 7)).toBeNull();
    // Everything so far is summarized (/compact): the mark sits after the last message.
    expect(compactionMarker({ upTo: 7, summary: '요약', at: 1 }, 7)).toEqual({ index: 7, summary: '요약', at: 1 });
    expect(compactionMarker({ upTo: 8, summary: '요약', at: 1 }, 7)).toBeNull();
    expect(compactionMarker({ upTo: 0, summary: '요약', at: 1 }, 7)).toBeNull();
  });
});
