import { describe, expect, it, vi } from 'vitest';
import { cardSummary, loadCards, planCard, saveCards, startCard, type RunApi, type RunCard, type RunPlanLike } from './chat-run';
import { chipHref } from './chat-links';

const plan = (over: Partial<RunPlanLike> = {}): RunPlanLike => ({
  lines: { total: 218, excluded: 3 },
  totals: { calls: { min: 40, expected: 44, max: 60 } },
  pace: { seconds: 600, costUsd: 0.42, subscription: false },
  suggestedLimits: { maxCalls: 120, maxInputTokens: 900_000 },
  ...over,
});
const card: Pick<RunCard, 'workflowId' | 'chips'> = { workflowId: 'w1', chips: [{ kind: '장면', id: 'g1', label: 'Greywater Ferry' }, { kind: '상태', id: 's1', label: '검토 필요' }] };
const mockApi = (planned = plan()) => {
  const api: RunApi = {
    scope: vi.fn(async () => ({ input: 'lines' as const, scope: { groupIds: ['g1'], statusIds: ['s1'] } })),
    preflight: vi.fn(async () => planned),
    start: vi.fn(async () => ({ runId: 'run-1' })),
  };
  return api;
};

describe('the run confirm card', () => {
  it('plans from the picks: their scope, then the same preflight the run dialog asks for', async () => {
    const api = mockApi();
    const planned = await planCard(api, card);
    expect(api.scope).toHaveBeenCalledWith('w1', [{ kind: '장면', id: 'g1' }, { kind: '상태', id: 's1' }]);
    expect(api.preflight).toHaveBeenCalledWith('w1', { groupIds: ['g1'], statusIds: ['s1'] });
    expect(planned.plan.lines.total).toBe(218);
  });

  it('shows lines, requests, time and cost in words', () => {
    expect(cardSummary('lines', plan())).toEqual({ targets: '218줄', empty: false, excluded: 3, requests: '44회', time: '10분', money: '약 $0.42' });
    expect(cardSummary('terms', plan({ lines: { total: 12, excluded: 0 } })).targets).toBe('12개');
    expect(cardSummary('lines', plan({ totals: { calls: { min: 3, expected: null, max: 9 } }, pace: { seconds: null, costUsd: null, subscription: true } }))).toMatchObject({ requests: '3~9회', time: null, money: '구독 사용' });
    expect(cardSummary('lines', plan({ lines: { total: 0, excluded: 5 } })).empty).toBe(true);
  });

  it('nothing runs until 실행: planning only reads, and 실행 starts exactly the planned scope with the suggested caps', async () => {
    const api = mockApi();
    const planned = await planCard(api, card);
    expect(api.start).not.toHaveBeenCalled();
    expect(await startCard(api, card, planned)).toEqual({ runId: 'run-1' });
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.start).toHaveBeenCalledWith('w1', { groupIds: ['g1'], statusIds: ['s1'] }, { maxCalls: 120, maxInputTokens: 900_000 });
  });

  it('a scope the server refuses stops the card before any preflight', async () => {
    const api = mockApi();
    api.scope = vi.fn(async () => { throw new Error('장면과 대사(인물)는 함께 고를 수 없습니다.'); });
    await expect(planCard(api, card)).rejects.toThrow('함께');
    expect(api.preflight).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('keeps the conversation\'s cards in session storage and reads a broken record as none', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) });
    const cards: RunCard[] = [{ id: 'c1', workflowId: 'w1', workflowName: '번역', input: 'lines', chips: card.chips, after: 4, runId: 'run-1' }];
    saveCards('s1', cards);
    expect(loadCards('s1')).toEqual(cards);
    expect(loadCards('other')).toEqual([]);
    store.set('tw.chat.runcards.s2', '{not json');
    expect(loadCards('s2')).toEqual([]);
    store.set('tw.chat.runcards.s3', JSON.stringify([{ id: 'x' }, cards[0]]));
    expect(loadCards('s3')).toEqual(cards);
    vi.unstubAllGlobals();
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
