import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { chatOfToken, markStopped, startTurn, stopTurn, turnEnded } from './chat-turns.ts';

const reply: UIMessage[] = [{ id: 'm', role: 'assistant', parts: [{ type: 'text', text: '반쯤' }] }];

describe('a turn that ends early', () => {
  it('is 중지됨 when the person stopped it, 끊김 (interrupted) when a newer turn took over', () => {
    const first = startTurn('p', 'chat-a');
    expect(chatOfToken(first.token)).toEqual({ projectId: 'p', sessionId: 'chat-a' });
    stopTurn('chat-a');
    expect(markStopped(reply, first.signal).at(-1)?.metadata).toEqual({ stopped: true });
    first.end();
    expect(chatOfToken(first.token)).toBeNull();

    const older = startTurn('p', 'chat-b');
    const newer = startTurn('p', 'chat-b');
    expect(chatOfToken(older.token)).toBeNull();
    expect(chatOfToken(newer.token)).toEqual({ projectId: 'p', sessionId: 'chat-b' });
    expect(markStopped(reply, older.signal).at(-1)?.metadata).toEqual({ interrupted: true });
    expect(markStopped(reply, newer.signal)).toBe(reply);
    older.end();
    newer.end();
    expect(chatOfToken(newer.token)).toBeNull();
  });

  it('can be waited for: a new turn starts after it, or after the wait runs out', async () => {
    const running = startTurn('p', 'chat-c');
    const waited = turnEnded('chat-c', 1_000);
    running.end();
    expect(await waited).toBe(true);
    expect(await turnEnded('chat-c', 10)).toBe(true);
    const stuck = startTurn('p', 'chat-d');
    expect(await turnEnded('chat-d', 10)).toBe(false);
    stuck.end();
  });
});
