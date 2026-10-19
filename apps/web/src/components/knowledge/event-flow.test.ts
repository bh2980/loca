import { describe, expect, it } from 'vitest';
import { layoutSection, type LayoutEvent } from './event-flow-layout.ts';

const events: LayoutEvent[] = [
  { id: 'first', next: [{ id: 'second', label: null }] },
  { id: 'second', next: [] },
];

describe('event flow layout direction', () => {
  it('lays directed events top-to-bottom with top and bottom ports', async () => {
    const layout = await layoutSection(events, 'vertical');
    const first = layout.positions.first!;
    const second = layout.positions.second!;

    expect(second.y).toBeGreaterThan(first.y);
    expect(second.x).toBe(first.x);
  });

  it('lays directed events left-to-right with left and right ports', async () => {
    const layout = await layoutSection(events, 'horizontal');
    const first = layout.positions.first!;
    const second = layout.positions.second!;

    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
  });
});
