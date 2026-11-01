import { describe, expect, it } from 'vitest';
import { byDay, dayLabel } from './datetime';

const now = new Date(2026, 10, 1, 18, 0);

describe('dayLabel', () => {
  it('names today and yesterday', () => {
    expect(dayLabel(new Date(2026, 10, 1, 9, 12), now)).toBe('오늘 · 11월 1일');
    expect(dayLabel(new Date(2026, 9, 31, 23, 59), now)).toBe('어제 · 10월 31일');
  });
  it('adds the year only for another year', () => {
    expect(dayLabel(new Date(2026, 9, 28), now)).toBe('10월 28일');
    expect(dayLabel(new Date(2025, 9, 28), now)).toBe('2025년 10월 28일');
  });
});

describe('byDay', () => {
  it('groups neighbours of one day, keeping order', () => {
    const items = [new Date(2026, 10, 1, 10), new Date(2026, 10, 1, 9), new Date(2026, 9, 31, 22)];
    expect(byDay(items, (item) => item).map((day) => day.items.length)).toEqual([2, 1]);
  });
});
