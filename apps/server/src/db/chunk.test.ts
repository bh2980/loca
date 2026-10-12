import { describe, expect, it } from 'vitest';
import { eachChunk, inChunks } from './chunk.ts';

describe('chunk helpers', () => {
  it('inChunks slices, dedupes and concatenates', () => {
    const calls: string[][] = [];
    const rows = inChunks(['a', 'b', 'a', 'c', 'd', 'e'], (slice) => (calls.push(slice), slice.map((id) => id.toUpperCase())), 2);
    expect(calls).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(rows).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('eachChunk visits every id once and nothing for an empty list', () => {
    const seen: string[] = [];
    eachChunk(['1', '2', '3'], (slice) => seen.push(...slice), 2);
    expect(seen).toEqual(['1', '2', '3']);
    let called = false;
    eachChunk([], () => (called = true));
    inChunks([], () => (called = true, []));
    expect(called).toBe(false);
  });
});
