import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { openDatabase } from '../db/index.ts';
import { markStopped, startTurn, stopTurn, turnEnded, turnStartedAt } from './chat-turn-registry.ts';

const db = openDatabase(':memory:');
const reply: UIMessage[] = [{ id: 'm', role: 'assistant', parts: [{ type: 'text', text: '반쯤' }] }];

describe('a turn that ends early', () => {
  it('is 중지됨 when the person stopped it, 끊김 (interrupted) when a newer turn took over', () => {
    const first = startTurn(db, 'p', 'chat-a');
    stopTurn(db, 'chat-a');
    expect(markStopped(reply, first.signal).at(-1)?.metadata).toEqual({ stopped: true });
    first.end();

    const older = startTurn(db, 'p', 'chat-b');
    const newer = startTurn(db, 'p', 'chat-b');
    expect(markStopped(reply, older.signal).at(-1)?.metadata).toEqual({ interrupted: true });
    expect(markStopped(reply, newer.signal)).toBe(reply);
    older.end();
    newer.end();
  });

  it('can be waited for: a new turn starts after it, or after the wait runs out', async () => {
    const running = startTurn(db, 'p', 'chat-c');
    const waited = turnEnded(db, 'chat-c', 1_000);
    running.end();
    expect(await waited).toBe(true);
    expect(await turnEnded(db, 'chat-c', 10)).toBe(true);
    const stuck = startTurn(db, 'p', 'chat-d');
    expect(await turnEnded(db, 'chat-d', 10)).toBe(false);
    stuck.end();
  });

  it('belongs to its database: the same conversation id in another database has no turn', () => {
    const other = openDatabase(':memory:');
    const turn = startTurn(db, 'p', 'chat-e');
    expect(turnStartedAt(db, 'chat-e')).not.toBeNull();
    expect(turnStartedAt(other, 'chat-e')).toBeNull();
    // Stopping it there stops nothing here.
    expect(stopTurn(other, 'chat-e')).toBe(false);
    expect(turn.signal.aborted).toBe(false);
    turn.end();
    expect(turnStartedAt(db, 'chat-e')).toBeNull();
  });
});
