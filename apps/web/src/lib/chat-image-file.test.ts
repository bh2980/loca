import { describe, expect, it } from 'vitest';
import { fitSize } from './chat-image-file';

describe('fitSize', () => {
  it('scales the longest side down to the limit and never enlarges', () => {
    expect(fitSize(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000, scaled: true });
    expect(fitSize(1000, 3000, 2000)).toEqual({ width: 667, height: 2000, scaled: true });
    expect(fitSize(800, 600, 2000)).toEqual({ width: 800, height: 600, scaled: false });
  });
});
