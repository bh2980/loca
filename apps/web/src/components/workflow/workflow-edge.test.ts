import { describe, expect, it } from 'vitest';
import { routeMatchesPorts } from './workflow-edge';

describe('saved workflow edge geometry', () => {
  it('uses a saved route only when both endpoints still match the current handles', () => {
    const route = [{ x: 10, y: 20 }, { x: 10, y: 80 }, { x: 200, y: 80 }];
    // React Flow reports the outside edge of a 10px handle; ELK routes to the card border.
    expect(routeMatchesPorts(route, 10, 25, 205, 80)).toBe(true);
    expect(routeMatchesPorts(route, 10, 40, 200, 80)).toBe(false);
    expect(routeMatchesPorts([{ x: 10, y: 20 }], 10, 20, 200, 80)).toBe(false);
  });
});
