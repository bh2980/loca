import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { NO_HISTORY, sentTexts, stepHistory } from './chat-input-history';
import { mergeIntoDraft, removeOnce } from './chat-queue';

const user = (id: string, text: string, kind?: string) => ({ id, role: 'user', metadata: kind ? { kind } : undefined, parts: [{ type: 'text', text }] }) as unknown as UIMessage;

describe('input history', () => {
  it('lists sent messages newest first, including steers, without decision notices', () => {
    const reply = { id: 'r', role: 'assistant', parts: [{ type: 'data-steer', data: { text: '둘' } }, { type: 'data-steer', data: { text: 'x', kind: 'decisions' } }] } as unknown as UIMessage;
    expect(sentTexts([user('1', '하나'), reply, user('d', '결과', 'decisions'), user('3', '셋')])).toEqual(['셋', '둘', '하나']);
  });

  it('walks back and forth and restores the draft', () => {
    const history = ['셋', '둘', '하나'];
    const a = stepHistory(history, NO_HISTORY, 'up', '쓰던 글', 0)!;
    expect(a.value).toBe('셋');
    const b = stepHistory(history, a.state, 'up', a.value, 0)!;
    expect(b.value).toBe('둘');
    expect(stepHistory(history, stepHistory(history, b.state, 'up', b.value, 0)!.state, 'up', '하나', 0)).toBeNull();
    const back = stepHistory(history, b.state, 'down', b.value, b.value.length)!;
    expect(back.value).toBe('셋');
    const end = stepHistory(history, back.state, 'down', back.value, back.value.length)!;
    expect(end).toEqual({ state: NO_HISTORY, value: '쓰던 글' });
    expect(stepHistory(history, NO_HISTORY, 'down', '', 0)).toBeNull();
  });

  it('leaves the arrows to the textarea inside a multi-line text', () => {
    expect(stepHistory(['a'], NO_HISTORY, 'up', '첫줄\n둘째줄', 6)).toBeNull();
    expect(stepHistory(['a'], NO_HISTORY, 'up', '첫줄\n둘째줄', 1)).not.toBeNull();
    expect(stepHistory([], NO_HISTORY, 'up', '', 0)).toBeNull();
    const walking = { index: 0, draft: '' };
    expect(stepHistory(['a\nb'], walking, 'down', 'a\nb', 0)).toBeNull();
  });
});

describe('message queue', () => {
  it('removes one equal message and merges texts into the draft', () => {
    expect(removeOnce(['a', 'b', 'a'], 'a')).toEqual(['b', 'a']);
    expect(removeOnce(['a'], 'z')).toEqual(['a']);
    expect(mergeIntoDraft(' 쓰던 ', ['a', 'b'])).toBe('쓰던\n\na\n\nb');
    expect(mergeIntoDraft('', ['a'])).toBe('a');
  });
});
