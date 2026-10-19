import { describe, expect, it } from 'vitest';
import { packGroups, planBatches, type BatchLine } from './batches.ts';

// Each test line costs lineCost = 10 + 20 tokens, so 300 tokens hold 10 lines (and "count" packs 10 by size).
const config = { mode: 'group' as const, size: 10, maxTokens: 300 };
let seq = 0;
const scene = (groupId: string, count: number, extra: Partial<BatchLine> = {}) =>
  Array.from({ length: count }, () => ({ groupId, seq: seq++, tokens: 10, kind: 'dialogue', speaker: 'A', ...extra }));

describe('planBatches', () => {
  it('packs short scenes together and keeps a scene whole when it fits', () => {
    seq = 0;
    const batches = planBatches([...scene('s1', 3), ...scene('s2', 4), ...scene('s3', 6)], config);
    expect(batches.map((batch) => batch.length)).toEqual([7, 6]);
  });

  it('never mixes dialogue with UI text', () => {
    seq = 0;
    const batches = planBatches([...scene('s1', 2), ...scene('ui', 2, { kind: 'ui', speaker: null }), ...scene('s2', 2)], config);
    expect(batches.map((batch) => batch.map((line) => line.groupId))).toEqual([['s1', 's1'], ['ui', 'ui'], ['s2', 's2']]);
  });

  it('starts a new batch for an unrelated scene once the current one is half full', () => {
    seq = 0;
    const batches = planBatches([...scene('s1', 5, { speaker: 'A' }), ...scene('s2', 2, { speaker: 'B' }), ...scene('s3', 2, { speaker: 'B' })], config);
    expect(batches.map((batch) => batch.length)).toEqual([5, 4]);
  });
});

describe('packGroups', () => {
  it('keeps groups whole and lets a small remnant ride with a neighbour past the limit', () => {
    seq = 0;
    const requests = packGroups([scene('a', 2), scene('b', 10), scene('c', 9)], config);
    expect(requests.map((request) => request.length)).toEqual([12, 9]);
  });

  it('cuts a group larger than one request', () => {
    seq = 0;
    expect(packGroups([scene('a', 25)], config).map((request) => request.length)).toEqual([10, 10, 5]);
  });

  it('cuts a group that holds several kinds where the kind changes', () => {
    seq = 0;
    const mixed = [...scene('a', 2, { kind: 'dialogue' }), ...scene('a', 2, { kind: 'ui' })];
    expect(packGroups([mixed], config).map((request) => request.map((line) => line.kind))).toEqual([['dialogue', 'dialogue'], ['ui', 'ui']]);
    expect(planBatches(mixed, { ...config, mode: 'count' }).map((batch) => batch.map((line) => line.kind))).toEqual([['dialogue', 'dialogue'], ['ui', 'ui']]);
  });

  it('does not put dialogue, UI and documents in one request', () => {
    seq = 0;
    const requests = packGroups([scene('a', 2, { kind: 'dialogue' }), scene('b', 2, { kind: 'dialogue' }), scene('ui', 3, { kind: 'ui' }), scene('doc', 1, { kind: 'document' })], config);
    expect(requests.map((request) => request.map((line) => line.kind))).toEqual([['dialogue', 'dialogue', 'dialogue', 'dialogue'], ['ui', 'ui', 'ui'], ['document']]);
  });
});

describe('planBatches with dialogue-graph links', () => {
  it('keeps a linked scene with the batch even when no speaker is shared', () => {
    seq = 0;
    const lines = [...scene('s1', 5, { speaker: 'A' }), ...scene('s2', 2, { speaker: 'B' })];
    expect(planBatches(lines, config).map((batch) => batch.length)).toEqual([5, 2]);
    expect(planBatches(lines, config, (a, b) => a === 's1' && b === 's2').map((batch) => batch.length)).toEqual([7]);
  });
});
