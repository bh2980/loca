import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { importFileSchema, runCardMessage, runCardOf, type RunCard } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { chatRoutes } from '../routes/chat.ts';
import { expandRecord, mergeIncoming, runCardLine, transcript, withStoredCards } from './chat-context.ts';
import { partsTokens } from './chat-compaction.ts';
import { importProject } from './importer.ts';

const setup = () => {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'a', title: 'Ferry' }], units: [{ key: 'u1', group: 'a', source: 'one' }, { key: 'u2', group: 'a', source: 'two' }] }), { connectionId: connection.id, model: 'm' });
  db.update(s.connections).set({ projectId }).where(eq(s.connections.id, connection.id)).run();
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((item) => item.name === '번역')!;
  const group = db.select().from(s.groups).get()!;
  const sessionId = db.insert(s.chatSessions).values({ projectId, title: '새 대화' }).returning().get().id;
  const app = new Hono<Env>().use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', chatRoutes);
  const post = (path: string, body?: unknown) => app.request(`/chat/${sessionId}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const stored = () => db.select().from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get()!.messages as UIMessage[];
  const make = async () => (await (await post('run-cards', { workflowId: workflow.id, chips: [{ kind: '장면', id: group.id, label: 'Ferry' }] })).json()) as RunCard;
  return { db, projectId, workflow, group, sessionId, post, stored, make };
};
const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const card = (over: Partial<RunCard> = {}): RunCard => ({ id: 'c1', workflowId: 'w1', workflowName: '번역', input: 'lines', chips: [{ kind: '장면', id: 'g1', label: 'Ferry' }], scope: { groupIds: ['g1'] }, plan: { lines: { total: 12, excluded: 0 }, totals: { calls: { min: 1, expected: 2, max: 3 } }, pace: { seconds: null, costUsd: null, subscription: false } }, state: 'pending', createdAt: 1, ...over });

describe('the run card is stored in the conversation', () => {
  it('is made from the picks with the preflight numbers, as a pending message at the end', async () => {
    const { make, stored, workflow, group } = setup();
    const made = await make();
    expect(made).toMatchObject({ workflowId: workflow.id, workflowName: '번역', input: 'lines', state: 'pending', scope: { groupIds: [group.id] }, plan: { lines: { total: 2, excluded: 0 } } });
    expect(made.runId).toBeUndefined();
    expect(made.plan.totals.calls.max).toBeGreaterThan(0);
    const messages = stored();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: made.id, role: 'user', metadata: { kind: 'run-card' } });
    expect(runCardOf(messages[0]!)).toEqual(made);
  });

  it('refuses picks that cannot be a scope, and stores nothing', async () => {
    const { post, stored, workflow, group } = setup();
    const refused = await post('run-cards', { workflowId: workflow.id, chips: [{ kind: '장면', id: group.id, label: 'F' }, { kind: '대사', id: 'u', label: 'L' }] });
    expect(refused.status).toBe(400);
    expect((await post('run-cards', { workflowId: 'missing', chips: [{ kind: '장면', id: group.id, label: 'F' }] })).status).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it('cancel moves pending → cancelled once; the card cannot be answered again', async () => {
    const { make, post, stored } = setup();
    const made = await make();
    const cancelled = await post(`run-cards/${made.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ id: made.id, state: 'cancelled' });
    expect(runCardOf(stored()[0]!)?.state).toBe('cancelled');
    expect((await post(`run-cards/${made.id}/cancel`)).status).toBe(400);
    const again = await post(`run-cards/${made.id}/start`);
    expect(again.status).toBe(400);
    expect(await again.text()).toContain('이미 취소');
    expect(runCardOf(stored()[0]!)?.state).toBe('cancelled');
    expect((await post('run-cards/nope/start')).status).toBe(404);
  });

  it('실행 starts the run with the card\'s scope and records its id on the card in the same call; a second 실행 is refused', async () => {
    const { make, post, stored, db, workflow, group } = setup();
    const made = await make();
    const [first, second] = await Promise.all([post(`run-cards/${made.id}/start`), post(`run-cards/${made.id}/start`)]);
    // Two windows answering at once: exactly one wins.
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const started = (await (first.status === 200 ? first : second).json()) as RunCard;
    expect(started).toMatchObject({ id: made.id, state: 'started' });
    const run = db.select().from(s.runs).where(eq(s.runs.id, started.runId!)).get()!;
    expect(run).toMatchObject({ workflowId: workflow.id, scope: { groupIds: [group.id] } });
    expect(db.select().from(s.runs).all()).toHaveLength(1);
    expect(runCardOf(stored()[0]!)).toMatchObject({ state: 'started', runId: run.id });
    expect((await post(`run-cards/${made.id}/cancel`)).status).toBe(400);
  });

  it('a card is kept when a reply that began before it is saved, and takes the newest answer', () => {
    const waiting = runCardMessage(card()) as unknown as UIMessage;
    const answered = runCardMessage(card({ state: 'started', runId: 'run-1' })) as unknown as UIMessage;
    const made = runCardMessage(card({ id: 'c2' })) as unknown as UIMessage;
    const reply: UIMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '네' }] };
    // The reply began with [u, c1(pending)]; meanwhile c1 was started and c2 was made.
    const saved = withStoredCards([user('u', '안녕'), waiting, reply], [user('u', '안녕'), answered, made]);
    expect(saved.map((message) => message.id)).toEqual(['u', 'c1', 'a1', 'c2']);
    expect(runCardOf(saved[1]!)?.runId).toBe('run-1');
    expect(withStoredCards([user('u', 'x')], [user('u', 'x')])).toEqual([user('u', 'x')]);
  });

  it('a regenerate drops the answers after the last question but keeps the cards, which are never the message being revised', () => {
    const c = runCardMessage(card()) as unknown as UIMessage;
    const reply: UIMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '네' }] };
    expect(mergeIncoming([user('u', 'q'), reply, c], undefined, 'regenerate-message').map((message) => message.id)).toEqual(['u', 'c1']);
    // An answered approval revises the newest reply even with a card after it.
    const revised = { ...reply, parts: [{ type: 'text' as const, text: '수정' }] };
    expect(mergeIncoming([user('u', 'q'), reply, c], revised).map((message) => message.id)).toEqual(['u', 'a1', 'c1']);
    expect((mergeIncoming([user('u', 'q'), reply, c], revised)[1] as UIMessage).parts).toEqual(revised.parts);
  });
});

describe('what the agent is told about a card', () => {
  it('one line: the workflow, the target and its size, the run id and the state (pending and cancelled too)', () => {
    expect(runCardLine(card({ state: 'started', runId: 'run-1' }))).toBe("사용자가 이 대화에서 워크플로 '번역'을 장면 Ferry(12줄)에 실행함 · run run-1 · 실행 시작함, 결과는 read_run으로 확인");
    expect(runCardLine(card())).toBe("사용자가 이 대화에서 워크플로 '번역'을 장면 Ferry(12줄)에 실행함 · run 없음 · 확인 대기 중, 아직 실행하지 않음");
    expect(runCardLine(card({ state: 'cancelled', input: 'terms' }))).toContain('(12개)에 실행함 · run 없음 · 확인 카드에서 취소함, 실행하지 않음');
  });

  it('is a user message in the model\'s context, where the card sits, with the run id the agent reads with read_run', () => {
    const started = runCardMessage(card({ state: 'started', runId: 'run-1' })) as unknown as UIMessage;
    const reply: UIMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '돌렸습니다' }] };
    const expanded = expandRecord([user('u1', '번역해 줘'), started, reply, user('u2', '방금 돌린 거 결과 어때?')]);
    expect(expanded.map((message) => message.role)).toEqual(['user', 'user', 'assistant', 'user']);
    expect(expanded[1]!.parts).toEqual([{ type: 'text', text: expect.stringContaining('run run-1') }]);
    // Other backends (CLI handover, compaction) read it as a line of the transcript, with no speaker prefix.
    expect(transcript([user('u1', '번역해 줘'), started, reply])).toBe(`사용자: 번역해 줘\n[${runCardLine(card({ state: 'started', runId: 'run-1' }))}]\n에이전트: 돌렸습니다`);
  });

  it('costs its line in the compaction estimate, not the scope ids it carries', () => {
    const big = card({ scope: { unitIds: Array.from({ length: 5_000 }, (_, i) => `unit-${i}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`) } });
    expect(partsTokens((runCardMessage(big) as unknown as UIMessage).parts)).toBeLessThan(200);
  });
});
