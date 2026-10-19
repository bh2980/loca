import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { agentWith, setAgentStarter, stopIdleAgents } from '@tw/ai';
import { inProcessStarter } from '@tw/ai/fake-acp';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { cliChatResponse } from './cli-chat.ts';
import { runChatTurn } from './chat-run.ts';
import { memoryStore } from './secrets.ts';
import { enqueueSteer } from './chat-interject.ts';
import { importProject } from './importer.ts';
import { decideProposal, hasUnreportedDecisions, propose } from './proposals.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor' }],
    units: [{ key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." }],
    characters: [{ name: 'Alice' }],
  });
  const { projectId } = importProject(db, file);
  const chat = db.insert(s.chatSessions).values({ projectId, title: '새 대화' }).returning().get();
  return { db, projectId, chat };
}

const fakeTurn = () => ({ signal: new AbortController().signal, end: () => {}, record: () => {}, markClosing: () => {} });
const user = (text: string) => ({ id: crypto.randomUUID(), role: 'user' as const, parts: [{ type: 'text' as const, text }] });

function respond(db: ReturnType<typeof setup>['db'], chat: typeof s.chatSessions.$inferSelect, text: string, turn = fakeTurn()) {
  return cliChatResponse({
    db,
    chat,
    route: { kind: 'grok', model: 'fake' },
    answeredBy: { kind: 'grok', connectionId: 'conn-grok', model: 'fake' },
    system: 'test',
    view: null,
    messages: [...((chat.messages ?? []) as never[]), user(text)],
    timeoutMs: 10_000,
    turn,
  });
}

afterEach(async () => {
  await stopIdleAgents(true);
  setAgentStarter(null);
});

describe('CLI chat over ACP', () => {
  it('streams the reply, runs workbench tools through MCP and proposes changes for this chat', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: JSON.stringify([{ name: 'find_lines', arguments: { speakers: ['Alice'] } }, { name: 'save_character', arguments: { name: 'Bob' } }]) }));
    const { db, chat } = setup();
    const body = await (await respond(db, chat, '앨리스 프로필 만들어줘')).text();

    expect(body).toContain('"toolName":"find_lines"');
    expect(body).toContain("You're late.");
    expect(body).toContain('"toolName":"save_character"');
    expect(body).toContain('"proposalId"');
    // The text arrives in pieces, not as one block at the end.
    expect(body.match(/"type":"text-delta"/g)!.length).toBeGreaterThan(1);
    // Text after a tool call is a new step: a last step of finished tool calls would make the panel send again.
    const steps = body.split('"type":"start-step"').slice(1);
    expect(steps.at(-1)).not.toContain('tool-output');
    const proposal = db.select().from(s.proposals).get();
    expect(proposal).toMatchObject({ sessionId: chat.id, tool: 'save_character', source: 'cli' });
  });

  it('keeps one CLI session across turns and tells it only what it missed', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]' }));
    const { db, chat } = setup();
    await (await respond(db, chat, '첫 질문')).text();
    const first = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!;
    expect(first.agentSession).toMatchObject({ kind: 'grok', model: 'fake', seen: 2 });
    const body = await (await respond(db, first, '둘째 질문')).text();
    const second = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!;
    expect(second.agentSession!.id).toBe(first.agentSession!.id);
    expect(body).toContain('둘째 질문');
    expect(body).not.toContain('이전 기록');
  });

  it('reopens the saved session in a new process after a restart', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]' }));
    const { db, chat } = setup();
    await (await respond(db, chat, '첫 질문')).text();
    await stopIdleAgents(true);
    const first = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!;
    await (await respond(db, first, '둘째 질문')).text();
    expect(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!.agentSession!.id).toBe(first.agentSession!.id);
  });

  it('hands a message sent during the turn to the agent and carries on', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]', FAKE_ACP_CHUNK_MS: '30' }));
    const { db, chat } = setup();
    const response = await respond(db, chat, '첫 질문');
    enqueueSteer(db, chat.id, '이것도 봐줘');
    const body = await response.text();
    expect(body).toContain('"type":"data-steer"');
    expect(body.match(/"type":"start-step"/g)).toHaveLength(2);
  });

  it('finishes and saves a reply nobody reads any more (the page was reloaded)', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]' }));
    const { db, chat } = setup();
    const onEnd = vi.fn();
    await respond(db, chat, '안녕', { ...fakeTurn(), end: onEnd });
    // The response body is never read.
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(JSON.stringify(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!.messages)).toContain('가짜 ACP 에이전트');
  });

  it('tells the agent once how its proposals were decided, and keeps ids out of the reason the person reads', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: JSON.stringify([{ name: 'save_character', arguments: { id: 'no-such-id', name: 'X' } }]) }));
    const { db, projectId, chat } = setup();
    const proposal = propose(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'save_character', input: { name: 'Bob' } });
    await decideProposal(db, proposal.id, false);
    expect(hasUnreportedDecisions(db, chat.id)).toBe(true);
    const body = await (await respond(db, chat, '계속')).text();
    expect(hasUnreportedDecisions(db, chat.id)).toBe(false);
    expect(body).toContain('"type":"data-steer"');
    expect(body).toContain('제안하지 못했습니다: 없는 인물입니다.');
    expect(body.match(/"errorText":"[^"]*"/)?.[0]).not.toContain('no-such-id');
    // The agent's copy of the reason has the id to fix it with (the fake agent quotes it in its reply).
    const reply = [...body.matchAll(/"delta":"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`) as string).join('');
    expect(reply).toContain('id=no-such-id');
    expect(reply).toContain('사용자가 거절함');
  });

  it('lets the CLI session go when the chat moves to another model', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]' }));
    const { db, chat } = setup();
    const connection = db.insert(s.connections).values({ name: 'Grok', kind: 'grok', defaultModel: 'fake' }).returning().get();
    const send = async (model: string, text: string) => {
      const current = db.update(s.chatSessions).set({ connectionId: connection.id, model }).where(eq(s.chatSessions.id, chat.id)).returning().get();
      await (await runChatTurn({ db, secrets: memoryStore() }, current, { incoming: user(text) })).text();
      return db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!.agentSession!;
    };
    const first = await send('fake', '하나');
    expect(await agentWith('grok', undefined, first.id)).not.toBeNull();
    const second = await send('fake-2', '둘');
    expect(second.id).not.toBe(first.id);
    await vi.waitFor(async () => expect(await agentWith('grok', undefined, first.id)).toBeNull());
    expect(await agentWith('grok', undefined, second.id)).not.toBeNull();
  });
});
