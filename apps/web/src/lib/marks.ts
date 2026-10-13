/**
 * Marks the app reads off a line (not stored as tags, so they never go stale), offered with the
 * tags in the line filter and the run scope and combined with them: every pick narrows the list.
 */
export const AUTO_MARKS = { remaining: '남은 줄', ai: 'AI가 정함', unknownListener: '청자 미상', diverged: '같은 원문 다른 번역', noted: '메모' } as const;
export type AutoMark = keyof typeof AUTO_MARKS;
