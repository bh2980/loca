import { describe, expect, it } from 'vitest';
import { pickTab } from './inspector-tab';

const tabs = ['line', 'history', 'prompt'] as const;

describe('pickTab', () => {
  it('takes the URL first', () => expect(pickTab(tabs, 'prompt', 'history')).toBe('prompt'));
  it('falls back to the remembered tab', () => expect(pickTab(tabs, undefined, 'history')).toBe('history'));
  it('falls back to the first tab', () => expect(pickTab(tabs, undefined, null)).toBe('line'));
  it('skips unknown values', () => expect(pickTab(tabs, 'nope', 'gone')).toBe('line'));
});
