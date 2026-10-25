import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { expandRecord, transcript } from './chat-context.ts';
import { startTurn, steerable } from './chat-turns.ts';
import { dequeueSteer, enqueueSteer, hasSteers, stopWithQueued, takeSteers } from './chat-interject.ts';
import { eq } from 'drizzle-orm';
import { importProject } from './importer.ts';

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });

describe('steering (#44)', () => {
  it('splits a reply where a steering message reached the model', () => {
    const reply = { id: 'r', role: 'assistant', metadata: { answeredBy: { kind: 'openai', connectionId: 'c', model: 'm' } }, parts: [{ type: 'step-start' }, { type: 'text', text: '읽는 중' }, { type: 'data-steer', data: { text: '인물부터 해줘' } }, { type: 'step-start' }, { type: 'text', text: '인물을 봅니다' }] } as unknown as UIMessage;
    const expanded = expandRecord([user('u', '요약해줘'), reply]);
    expect(expanded.map((message) => [message.id, message.role])).toEqual([['u', 'user'], ['r', 'assistant'], ['r~1', 'user'], ['r~2', 'assistant']]);
    expect(expanded[2].parts).toEqual([{ type: 'text', text: '인물부터 해줘' }]);
    expect(expanded[3].metadata).toEqual(reply.metadata);
    // Every context builder reads it in that order.
    expect(transcript([user('u', '요약해줘'), reply])).toBe('사용자: 요약해줘\n에이전트(m): 읽는 중\n사용자: 인물부터 해줘\n에이전트(m): 인물을 봅니다');
    expect(expandRecord([user('u', '요약해줘'), reply]).map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // A steer at the very start leaves no empty reply segment.
    const first = { id: 'f', role: 'assistant', parts: [{ type: 'data-steer', data: { text: '먼저' } }, { type: 'text', text: '네' }] } as unknown as UIMessage;
    expect(expandRecord([first]).map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('queues messages for the running turn, refuses once it is closing, and hands them back on stop', () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] }));
    const id = db.insert(s.chatSessions).values({ projectId, title: '새 대화' }).returning().get().id;
    const turn = startTurn('p', id);
    expect(steerable(id)).toBe(true);
    enqueueSteer(db, id, 'a');
    enqueueSteer(db, id, 'b');
    expect(hasSteers(db, id)).toBe(true);
    // Stored on the conversation: a restart (no turn in memory) keeps them.
    expect(db.select({ pending: s.chatSessions.pendingSteers }).from(s.chatSessions).where(eq(s.chatSessions.id, id)).get()!.pending).toEqual(['a', 'b']);
    // A queued message can be taken back until the turn has taken it.
    expect(dequeueSteer(db, id, 'a')).toBe(true);
    expect(dequeueSteer(db, id, 'a')).toBe(false);
    expect(takeSteers(db, id)).toEqual(['b']);
    expect(dequeueSteer(db, id, 'b')).toBe(false);
    expect(takeSteers(db, id)).toEqual([]);
    turn.markClosing();
    expect(steerable(id)).toBe(false);
    turn.end();
    expect(steerable(id)).toBe(false);
    const second = startTurn('p', id);
    enqueueSteer(db, id, 'c');
    expect(stopWithQueued(db, id)).toEqual({ stopped: true, queued: ['c'] });
    expect(steerable(id)).toBe(false);
    second.end();
    // No turn (after a restart): stopping still hands back what waited.
    enqueueSteer(db, id, 'd');
    expect(stopWithQueued(db, id)).toEqual({ stopped: false, queued: ['d'] });
  });
});
