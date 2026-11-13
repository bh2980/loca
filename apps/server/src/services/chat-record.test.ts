import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { capToolOutputs, catchUp, handover, mergeIncoming, messageText, transcript } from './chat-record.ts';

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const reply = (id: string, text: string, model?: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }], ...(model && { metadata: { answeredBy: { kind: 'openai', connectionId: 'c', model } } }) });

describe('chat context from the one record (#46)', () => {
  it('a message as text keeps tool calls and their results on one line', () => {
    const message = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: '찾아볼게요' }, { type: 'tool-find_lines', toolCallId: 't', state: 'output-available', input: { speakers: ['Mira'] }, output: { total: 3 } }] } as unknown as UIMessage;
    expect(messageText(message)).toBe('찾아볼게요\n[도구 find_lines {"speakers":["Mira"]} → {"total":3}]');
  });

  it('a transcript names who answered and keeps every message whole', () => {
    const messages = [user('1', 'x'.repeat(10_000)), reply('2', 'y'.repeat(10_000), 'gpt'), user('3', '지금 질문'), reply('4', '답', 'claude')];
    const all = transcript(messages);
    expect(all).toContain(`에이전트(gpt): ${'y'.repeat(10_000)}`);
    expect(all).toContain('x'.repeat(10_000));
    expect(all.endsWith('에이전트(claude): 답')).toBe(true);
  });

  it('a cached backend session is told only what it missed', () => {
    const messages = [user('1', '첫 질문'), reply('2', '첫 답', 'a'), user('3', '둘째'), reply('4', '다른 모델의 답', 'b')];
    const text = catchUp(messages, 2)!;
    expect(text).toContain('다른 모델의 답');
    expect(text).not.toContain('첫 질문');
    expect(catchUp(messages, 4)).toBeNull();
    expect(handover([])).toBeNull();
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

describe('tool results capped by age', () => {
  const result = (id: string, rows: number, end = 'total: 500') => ({ id, role: 'assistant', parts: [{ type: 'tool-find_lines', toolCallId: id, state: 'output-available', input: { speakers: ['MIRA'] }, output: { lines: Array.from({ length: rows }, (_, i) => ({ id: `u${i}`, source: 'Some long source line here.' })), end } }] }) as unknown as UIMessage;
  const ask = (id: string) => ({ id, role: 'user', parts: [{ type: 'text', text: 'x'.repeat(20_000) }] }) as UIMessage;

  it('keeps the start and the end of a long result and says how much went', () => {
    const [capped] = capToolOutputs([result('a', 500)], () => 600);
    const output = (capped!.parts[0] as { output: string }).output;
    expect(output.length).toBeLessThan(700);
    expect(output.startsWith('{"lines":[')).toBe(true);
    expect(output).toContain('total: 500');
    expect(output).toMatch(/자 생략\)…/);
  });

  it('gives each result the limit of its age, newest first, and leaves inputs and the person alone', () => {
    const capped = capToolOutputs([ask('q'), result('old', 500), result('new', 500)], (rank) => (rank === 0 ? undefined : 600));
    expect(typeof (capped[2]!.parts[0] as { output: unknown }).output).toBe('object');
    expect(typeof (capped[1]!.parts[0] as { output: unknown }).output).toBe('string');
    expect((capped[1]!.parts[0] as { input: unknown }).input).toEqual({ speakers: ['MIRA'] });
    expect((capped[0]!.parts[0] as { text: string }).text.length).toBe(20_000);
  });
});
