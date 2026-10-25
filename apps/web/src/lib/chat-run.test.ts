import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { runCardMessage, runCardOf, type RunCard, type RunCardPlan } from '@tw/shared';
import { cardSummary, syncCards, withCard } from './chat-run';
import { chipHref } from './chat-links';

const plan = (over: Partial<RunCardPlan> = {}): RunCardPlan => ({
  lines: { total: 218, excluded: 3 },
  totals: { calls: { min: 40, expected: 44, max: 60 } },
  pace: { seconds: 600, costUsd: 0.42, subscription: false },
  suggestedLimits: { maxCalls: 120, maxInputTokens: 900_000 },
  ...over,
});
const card = (id: string, over: Partial<RunCard> = {}): RunCard => ({ id, workflowId: 'w1', workflowName: '번역', input: 'lines', chips: [{ kind: '장면', id: 'g1', label: 'Greywater Ferry' }], scope: { groupIds: ['g1'] }, plan: plan(), state: 'pending', createdAt: 1, ...over });
const text = (id: string, role: 'user' | 'assistant' = 'user'): UIMessage => ({ id, role, parts: [{ type: 'text', text: id }] });
const message = (value: RunCard) => runCardMessage(value) as unknown as UIMessage;

describe('the run confirm card', () => {
  it('shows lines, requests, time and cost in words', () => {
    expect(cardSummary('lines', plan())).toEqual({ targets: '218줄', empty: false, excluded: 3, requests: '44회', time: '10분', money: '약 $0.42' });
    expect(cardSummary('terms', plan({ lines: { total: 12, excluded: 0 } })).targets).toBe('12개');
    expect(cardSummary('lines', plan({ totals: { calls: { min: 3, expected: null, max: 9 } }, pace: { seconds: null, costUsd: null, subscription: true } }))).toMatchObject({ requests: '3~9회', time: null, money: '구독 사용' });
    expect(cardSummary('lines', plan({ lines: { total: 0, excluded: 5 } })).empty).toBe(true);
  });

  it('is a message of the conversation that reads back as the same card', () => {
    expect(runCardOf(message(card('c1', { state: 'started', runId: 'run-1' })))).toEqual(card('c1', { state: 'started', runId: 'run-1' }));
    expect(runCardOf(text('u1'))).toBeNull();
    expect(runCardOf({ parts: [{ type: 'data-run', data: { id: 'x' } } as never] })).toBeNull();
  });

  it('a card the server answered replaces its message in the stored conversation, a new one goes to the end', () => {
    const session = { messages: [text('u1'), message(card('c1'))] as unknown[] };
    const started = withCard(session, card('c1', { state: 'started', runId: 'run-1' }));
    expect(started.messages.map((item) => (item as UIMessage).id)).toEqual(['u1', 'c1']);
    expect(runCardOf(started.messages[1] as UIMessage)?.runId).toBe('run-1');
    expect(withCard(started, card('c2')).messages.map((item) => (item as UIMessage).id)).toEqual(['u1', 'c1', 'c2']);
  });

  it('joins the screen\'s conversation where the stored one has it, and takes the stored state of one it has', () => {
    const stored = [text('u1'), text('a1', 'assistant'), message(card('c1')), text('u2'), message(card('c2', { state: 'cancelled' }))];
    // This window has not seen either card.
    const joined = syncCards([text('u1'), text('a1', 'assistant'), text('u2')], stored)!;
    expect(joined.map((item) => item.id)).toEqual(['u1', 'a1', 'c1', 'u2', 'c2']);
    // Nothing to do once they are there.
    expect(syncCards(joined, stored)).toBeNull();
    // Another window started c1.
    const answered = [...stored.slice(0, 2), message(card('c1', { state: 'started', runId: 'run-1' })), ...stored.slice(3)];
    const updated = syncCards(joined, answered)!;
    expect(runCardOf(updated[2]!)?.state).toBe('started');
    // A reply being streamed into the last message is left as it is.
    expect(updated[3]).toBe(joined[3]);
    // A card made while a reply ran (the stored conversation has it after the reply) goes after the message before it.
    expect(syncCards([text('u1'), text('a1', 'assistant')], [text('u1'), text('a1', 'assistant'), message(card('c3'))])!.map((item) => item.id)).toEqual(['u1', 'a1', 'c3']);
  });
});

describe('where a chip leads', () => {
  it('uses the address the server gave, else the page of its kind', () => {
    expect(chipHref('p1', { kind: '장면', id: 'g1', href: '/p/p1/script?group=g1' })).toBe('/p/p1/script?group=g1');
    expect(chipHref('p1', { kind: '장면', id: 'g1' })).toBe('/p/p1/script?group=g1');
    expect(chipHref('p1', { kind: '대사', id: 'u1' })).toBe('/p/p1/script?line=u1&detail=true');
    expect(chipHref('p1', { kind: '용어', id: 't1' })).toBe('/p/p1/glossary?term=t1');
    expect(chipHref('p1', { kind: '인물', id: 'c1' })).toBe('/p/p1/knowledge?tab=people&display=characters&item=c1');
    expect(chipHref('p1', { kind: '실행', id: 'r1' })).toBe('/p/p1/runs/r1');
    expect(chipHref('p1', { kind: '워크플로', id: 'w1' })).toBe('/p/p1/workflows/w1');
    expect(decodeURIComponent(chipHref('p1', { kind: '태그', id: 'tag1' })!)).toBe('/p/p1/script?tags=["tag1"]');
    expect(chipHref('p1', { kind: '그래프', id: 'n1' })).toBeUndefined();
  });
});
