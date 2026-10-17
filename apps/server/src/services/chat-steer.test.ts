import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { importFileSchema } from '@tw/shared';
import type * as ai from '@tw/ai';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { expandSteers, fitMessages, transcript } from './chat-context.ts';
import { startTurn, steerable } from './chat-turns.ts';
import { enqueueSteer, hasSteers, stopWithQueued, takeSteers } from './chat-interject.ts';
import { eq } from 'drizzle-orm';
import { cliChatResponse } from './cli-chat.ts';
import { importProject } from './importer.ts';
import { decideProposal, hasUnreportedDecisions, openProposals, propose } from './proposals.ts';

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });

describe('steering (#44)', () => {
  it('splits a reply where a steering message reached the model', () => {
    const reply = { id: 'r', role: 'assistant', metadata: { answeredBy: { kind: 'openai', connectionId: 'c', model: 'm' } }, parts: [{ type: 'step-start' }, { type: 'text', text: '읽는 중' }, { type: 'data-steer', data: { text: '인물부터 해줘' } }, { type: 'step-start' }, { type: 'text', text: '인물을 봅니다' }] } as unknown as UIMessage;
    const expanded = expandSteers([user('u', '요약해줘'), reply]);
    expect(expanded.map((message) => [message.id, message.role])).toEqual([['u', 'user'], ['r', 'assistant'], ['r~1', 'user'], ['r~2', 'assistant']]);
    expect(expanded[2].parts).toEqual([{ type: 'text', text: '인물부터 해줘' }]);
    expect(expanded[3].metadata).toEqual(reply.metadata);
    // Every context builder reads it in that order.
    expect(transcript([user('u', '요약해줘'), reply], 10_000)).toBe('사용자: 요약해줘\n에이전트(m): 읽는 중\n사용자: 인물부터 해줘\n에이전트(m): 인물을 봅니다');
    expect(fitMessages([user('u', '요약해줘'), reply], 100_000).map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // A steer at the very start leaves no empty reply segment.
    const first = { id: 'f', role: 'assistant', parts: [{ type: 'data-steer', data: { text: '먼저' } }, { type: 'text', text: '네' }] } as unknown as UIMessage;
    expect(expandSteers([first]).map((message) => message.role)).toEqual(['user', 'assistant']);
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
    expect(takeSteers(db, id)).toEqual(['a', 'b']);
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

  it('a CLI turn takes a message sent mid-turn at the next round, and keeps going for one sent at the end', async () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', speaker: 'Alice', source: 'Hi' }] }));
    const chat = db.insert(s.chatSessions).values({ projectId, title: '새 대화' }).returning().get();
    const prompts: string[] = [];
    let closed = false;
    const answers = ['```loca-tools\n[{"tool":"find_lines","input":{"speakers":["Alice"]}}]\n```', '찾았습니다.', '인물부터 보겠습니다.'];
    const turn = async (_route: ai.ResolvedRoute, request: ai.CliChatTurn): Promise<ai.CliChatResult> => {
      prompts.push(request.prompt);
      // Sent while round 1 runs, and again while round 2 (the would-be last) runs.
      if (prompts.length === 1) enqueueSteer(db, chat.id, '대사 말고 인물부터');
      if (prompts.length === 2) enqueueSteer(db, chat.id, '그리고 짧게');
      return { sessionId: 'cli', text: answers[prompts.length - 1], usage: {} };
    };
    const response = await cliChatResponse({ db, chat, route: { kind: 'grok', model: 'g' }, answeredBy: { kind: 'grok', connectionId: 'c', model: 'g' }, system: 't', view: null, messages: [user('u', '대사 찾아줘')], timeoutMs: 1000, turn: { signal: new AbortController().signal, end: () => {}, record: () => {}, markClosing: () => (closed = true) }, cli: turn });
    const body = await response.text();
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain('작업실 도구 결과');
    expect(prompts[1]).toContain('대사 말고 인물부터');
    expect(prompts[2]).toContain('그리고 짧게');
    expect(body).toContain('"type":"data-steer"');
    expect(closed).toBe(true);
    const saved = db.select().from(s.chatSessions).all()[0].messages as UIMessage[];
    const steers = saved.at(-1)!.parts.filter((part) => part.type === 'data-steer').map((part) => (part as { data: { text: string } }).data.text);
    expect(steers).toEqual(['대사 말고 인물부터', '그리고 짧게']);
  });

  it('a decision made since the last turn reaches the agent once, recorded in the reply (#43), and a refusal hides ids from the person', async () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', speaker: 'Alice', source: 'Hi' }] }));
    const chat = db.insert(s.chatSessions).values({ projectId, title: '새 대화' }).returning().get();
    const proposal = propose(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'save_character', input: { name: 'Bob' } });
    expect(openProposals(db, chat.id)).toBe(1);
    await decideProposal(db, proposal.id, false);
    expect(openProposals(db, chat.id)).toBe(0);
    expect(hasUnreportedDecisions(db, chat.id)).toBe(true);
    const prompts: string[] = [];
    const answers = ['```loca-tools\n[{"tool":"save_character","input":{"id":"no-such-id","name":"X"}}]\n```', '알겠습니다.'];
    const cli = async (_route: ai.ResolvedRoute, request: ai.CliChatTurn): Promise<ai.CliChatResult> => {
      prompts.push(request.prompt);
      return { sessionId: 'cli', text: answers[prompts.length - 1], usage: {} };
    };
    const response = await cliChatResponse({ db, chat, route: { kind: 'grok', model: 'g' }, answeredBy: { kind: 'grok', connectionId: 'c', model: 'g' }, system: 't', view: null, messages: [user('u', '계속')], timeoutMs: 1000, turn: { signal: new AbortController().signal, end: () => {}, record: () => {}, markClosing: () => {} }, cli });
    const body = await response.text();
    expect(prompts[0]).toContain('사용자가 거절함');
    expect(hasUnreportedDecisions(db, chat.id)).toBe(false);
    const saved = db.select().from(s.chatSessions).all()[0].messages as UIMessage[];
    expect(saved.at(-1)!.parts.find((part) => part.type === 'data-steer')).toMatchObject({ data: { kind: 'decisions' } });
    // The panel reads a plain reason; the agent gets the id to fix it with.
    expect(body).toContain('제안하지 못했습니다: 없는 인물입니다.');
    expect(body.match(/"errorText":"[^"]*"/)?.[0]).not.toContain('no-such-id');
    expect(prompts[1]).toContain('id=no-such-id');
  });
});
