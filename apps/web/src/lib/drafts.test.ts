import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDraft } from './drafts';

// Exercise the persistent store across renders/remounts without a DOM renderer.
vi.mock('react', () => ({ useCallback: (fn: unknown) => fn, useSyncExternalStore: (_subscribe: unknown, snapshot: () => string) => snapshot() }));
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe('translation draft base', () => {
  it('retains the editing base across server changes and remounts, until explicitly rebased', () => {
    useDraft('line:a', 'before')[1]('mine');
    const [text, set, clear, base] = useDraft('line:a', 'someone else');
    expect([text, base]).toEqual(['mine', 'before']);
    set('more typing');
    expect(useDraft('line:a', 'someone else')[3]).toBe('before');
    clear(); set(text);
    expect(useDraft('line:a', 'someone else')[3]).toBe('someone else');
  });
  it('keeps typing during a successful save and uses that save as the next base', () => {
    const [, set, clear] = useDraft('line:a', 'before');
    set('sent'); set('newer');
    expect(clear('sent')).toBe(false);
    const state = useDraft('line:a', 'sent');
    expect([state[0], state[3]]).toEqual(['newer', 'sent']);
    expect(state[2]('newer')).toBe(true);
    expect(useDraft('line:a', 'newer')[0]).toBe('newer');
  });
  it('does not assume a legacy draft began at the current server value', () => {
    sessionStorage.setItem('tw.draft.line:a', 'old draft');
    expect(useDraft('line:a', 'latest')[3]).toBeNull();
  });
});
