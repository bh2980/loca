import { describe, expect, it } from 'vitest';
import { packGroups, planBatches, scaleBatch, type BatchLine } from './batches.ts';

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

  it('counts a whole-script line as compact script text, not per-line JSON', () => {
    seq = 0;
    // 10 + 5 tokens a line: 20 lines of 10 tokens fit 300 whole, where per-line JSON (10 + 20) would need two requests.
    const lines = [...scene('s1', 10), ...scene('s2', 10)];
    expect(planBatches(lines, { ...config, mode: 'whole' }).map((batch) => batch.length)).toEqual([20]);
    expect(planBatches(lines, config).map((batch) => batch.length)).toEqual([10, 10]);
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

describe('scaleBatch', () => {
  it('scales the tokens of group and whole, the lines of count, and leaves unit and a factor of 1 alone', () => {
    expect(scaleBatch(config, 0.5)).toMatchObject({ mode: 'group', maxTokens: 150 });
    expect(scaleBatch({ ...config, mode: 'whole' }, 0.25)).toMatchObject({ maxTokens: 75 });
    expect(scaleBatch({ ...config, mode: 'count' }, 0.5)).toMatchObject({ size: 5 });
    expect(scaleBatch({ ...config, mode: 'count', size: 3 }, 0.1)).toMatchObject({ size: 1 });
    expect(scaleBatch({ ...config, mode: 'unit' }, 0.5)).toEqual({ ...config, mode: 'unit' });
    expect(scaleBatch(config, 1)).toBe(config);
  });

  it('plans smaller requests with it, but never fewer than one line', () => {
    seq = 0;
    const lines = [...scene('s1', 2), ...scene('s2', 2), ...scene('s3', 2), ...scene('s4', 2), ...scene('s5', 2)];
    expect(planBatches(lines, config).map((batch) => batch.length)).toEqual([10]);
    expect(planBatches(lines, scaleBatch(config, 0.5)).map((batch) => batch.length)).toEqual([4, 4, 2]);
    // A budget below one line still sends the line.
    expect(packGroups([lines], scaleBatch({ ...config, maxTokens: 20 }, 0.1)).map((batch) => batch.length)).toEqual(Array(10).fill(1));
    expect(packGroups([lines.slice(0, 4), lines.slice(4)], scaleBatch(config, 0.5)).map((batch) => batch.length)).toEqual([4, 5, 1]);
  });
});
