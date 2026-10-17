import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { catchUp, fitMessages, handover, mergeIncoming, messageText, transcript } from './chat-context.ts';

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const reply = (id: string, text: string, model?: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }], ...(model && { metadata: { answeredBy: { kind: 'openai', connectionId: 'c', model } } }) });

describe('chat context from the one record (#46)', () => {
  it('a message as text keeps tool calls and their results on one line', () => {
    const message = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: '찾아볼게요' }, { type: 'tool-find_lines', toolCallId: 't', state: 'output-available', input: { speakers: ['Mira'] }, output: { total: 3 } }] } as unknown as UIMessage;
    expect(messageText(message)).toBe('찾아볼게요\n[도구 find_lines {"speakers":["Mira"]} → {"total":3}]');
  });

  it('a transcript names who answered and shortens, then leaves out, the oldest past the budget', () => {
    const messages = [user('1', 'x'.repeat(1_000)), reply('2', 'y'.repeat(1_000), 'gpt'), user('3', '지금 질문'), reply('4', '답', 'claude')];
    const all = transcript(messages, 10_000);
    expect(all).toContain('에이전트(gpt): ');
    expect(all.endsWith('에이전트(claude): 답')).toBe(true);
    const short = transcript(messages, 1_200);
    expect(short).toContain('사용자: 지금 질문');
    expect(short).toContain('…');
    expect(short.length).toBeLessThanOrEqual(1_400);
    expect(transcript(messages, 400)).toMatch(/^\(앞선 메시지 \d개는 길이 때문에 생략\)/);
  });

  it('a cached backend session is told only what it missed', () => {
    const messages = [user('1', '첫 질문'), reply('2', '첫 답', 'a'), user('3', '둘째'), reply('4', '다른 모델의 답', 'b')];
    const text = catchUp(messages, 2, 10_000)!;
    expect(text).toContain('다른 모델의 답');
    expect(text).not.toContain('첫 질문');
    expect(catchUp(messages, 4, 10_000)).toBeNull();
    expect(handover([], 10_000)).toBeNull();
  });

  it('API messages over the budget start at a user message after one handover message', () => {
    const messages = [user('1', 'a'.repeat(500)), reply('2', 'b'.repeat(500)), user('3', 'c'.repeat(500)), reply('4', 'd'.repeat(500)), user('5', '지금')];
    expect(fitMessages(messages, 100_000)).toBe(messages);
    const fitted = fitMessages(messages, 1_500);
    expect(fitted[0].id).toBe('earlier');
    expect(fitted[1].role).toBe('user');
    expect(fitted.at(-1)!.id).toBe('5');
  });

  it('the server merges what the browser sent: append, replace the newest by id, regenerate drops the answer', () => {
    const stored = [user('1', 'q'), reply('2', 'a')];
    expect(mergeIncoming(stored, user('3', 'next')).map((m) => m.id)).toEqual(['1', '2', '3']);
    const approved = { ...reply('2', 'a'), parts: [{ type: 'text', text: 'approved' }] } as UIMessage;
    expect(textOfLast(mergeIncoming(stored, approved))).toBe('approved');
    // An old tab cannot rewrite an earlier message.
    expect(mergeIncoming(stored, user('1', 'rewritten'))).toEqual(stored);
    expect(mergeIncoming(stored, user('1', 'q'), 'regenerate-message').map((m) => m.id)).toEqual(['1']);
  });
});

const textOfLast = (messages: UIMessage[]) => (messages.at(-1)!.parts[0] as { text: string }).text;
