import { describe, expect, it } from 'vitest';
import { pickTab } from './inspector-tab';

const tabs = ['line', 'history', 'prompt'] as const;

describe('pickTab', () => {
  it('takes the tab the URL names', () => expect(pickTab(tabs, 'prompt')).toBe('prompt'));
  it('falls back to the first tab', () => expect(pickTab(tabs, undefined)).toBe('line'));
  it('skips a value that is not one of its tabs (another inspector\'s tab, a hand-edited URL)', () => {
    expect(pickTab(tabs, 'usage')).toBe('line');
    expect(pickTab(tabs, 3)).toBe('line');
  });
});
