import { describe, expect, it } from 'vitest';
import { fitResult } from './tool-output.ts';

describe('tool output', () => {
  it('passes a small result through untouched', () => {
    const small = { total: 2, terms: [{ a: 1 }, { a: 2 }] };
    expect(fitResult(small, 1000)).toBe(small);
  });

  it('shortens the longest list and says how much is left', () => {
    const terms = Array.from({ length: 500 }, (_, index) => ({ source: `Term ${index}`, target: `용어 ${index}` }));
    const fitted = fitResult({ total: 500, terms }, 2_000) as { total: number; terms: unknown[]; truncated: { shown: number; total: number; note: string } };
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(2_000);
    expect(fitted.total).toBe(500);
    expect(fitted.terms.length).toBe(fitted.truncated.shown);
    expect(fitted.truncated).toMatchObject({ total: 500, note: expect.stringContaining('offset') });
    expect(fitted.truncated.shown).toBeGreaterThan(10);
  });

  it('wraps a long top-level list and cuts plain text with a marker', () => {
    const list = fitResult(Array.from({ length: 300 }, (_, index) => `line ${index}`), 500) as { items: string[]; truncated: { total: number } };
    expect(list.truncated.total).toBe(300);
    const text = fitResult('x'.repeat(5_000), 1_000) as { text: string; truncated: { total: number } };
    expect(text.text.length).toBeLessThan(1_000);
    expect(text.truncated.total).toBe(5_002);
  });
});
