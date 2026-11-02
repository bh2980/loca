import { describe, expect, it } from 'vitest';
import { shiftRoute } from './route-shift';

const square = (points: { x: number; y: number }[]) => points.slice(1).every((point, index) => point.x === points[index]!.x || point.y === points[index]!.y);
// Down out of the source, across, down into the target.
const route = { points: [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 200, y: 40 }, { x: 200, y: 100 }], labelPosition: { x: 100, y: 40 } };

describe('shiftRoute', () => {
  it('moves the whole line, mark too, when both ends move together', () => {
    expect(shiftRoute(route, { dx: 10, dy: 5 }, { dx: 10, dy: 5 })).toEqual({ points: route.points.map((p) => ({ x: p.x + 10, y: p.y + 5 })), labelPosition: { x: 110, y: 45 } });
  });
  it('keeps a line still when neither end moves', () => {
    expect(shiftRoute(route, { dx: 0, dy: 0 }, { dx: 0, dy: 0 })).toBe(route);
  });
  it('moves the source end only, keeps the line square and meeting both ports', () => {
    const next = shiftRoute(route, { dx: 30, dy: 20 }, { dx: 0, dy: 0 })!;
    expect(next.points[0]).toEqual({ x: 30, y: 20 });
    expect(next.points.at(-1)).toEqual({ x: 200, y: 100 });
    expect(square(next.points)).toBe(true);
    // The mark stays on the line.
    const at = next.labelPosition!;
    expect(next.points.slice(1).some((point, index) => { const from = next.points[index]!; return (from.x === point.x && at.x === point.x && at.y >= Math.min(from.y, point.y) && at.y <= Math.max(from.y, point.y)) || (from.y === point.y && at.y === point.y && at.x >= Math.min(from.x, point.x) && at.x <= Math.max(from.x, point.x)); })).toBe(true);
  });
  it('moves the target end only, keeps the line square', () => {
    const next = shiftRoute(route, { dx: 0, dy: 0 }, { dx: -50, dy: 30 })!;
    expect(next.points[0]).toEqual({ x: 0, y: 0 });
    expect(next.points.at(-1)).toEqual({ x: 150, y: 130 });
    expect(square(next.points)).toBe(true);
  });
  it('steps a straight line across at its middle when one end moves sideways', () => {
    expect(shiftRoute({ points: [{ x: 0, y: 0 }, { x: 0, y: 50 }] }, { dx: 20, dy: 0 }, { dx: 0, dy: 0 })).toEqual({ points: [{ x: 20, y: 0 }, { x: 20, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 50 }] });
  });
});
