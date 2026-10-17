import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import type * as ai from '@tw/ai';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { cliChatResponse, readToolCalls } from './cli-chat.ts';
import { importProject } from './importer.ts';

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

describe('CLI chat', () => {
  it('reads tool blocks out of an answer', () => {
    const answer = '찾아볼게요.\n```loca-tools\n[{"tool":"find_lines","input":{"speakers":["Alice"]}}]\n```';
    expect(readToolCalls(answer)).toEqual({ visible: '찾아볼게요.', calls: [{ tool: 'find_lines', input: { speakers: ['Alice'] } }], error: undefined });
    expect(readToolCalls('```loca-tools\n[{bad json\n```').error).toMatch(/JSON/);
  });

  it('runs requested tools, proposes changes for the chat, and resumes the same CLI session with the results', async () => {
    const { db, projectId, chat } = setup();
    const prompts: { sessionId?: string; prompt: string }[] = [];
    const answers = [
      '앨리스의 대사를 보고 프로필을 제안하겠습니다.\n```loca-tools\n[{"tool":"find_lines","input":{"speakers":["Alice"]}},{"tool":"save_character","input":{"name":"Bob"}}]\n```',
      '앨리스는 "You\'re late."라고 말합니다. 밥의 인물 추가를 제안했습니다.',
    ];
    const turn = async (_route: ai.ResolvedRoute, request: ai.CliChatTurn): Promise<ai.CliChatResult> => {
      prompts.push({ sessionId: request.sessionId, prompt: request.prompt });
      return { sessionId: 'cli-1', text: answers[prompts.length - 1], usage: {} };
    };
    const response = await cliChatResponse({
      db,
      chat,
      route: { kind: 'grok', model: 'grok-4.7' },
      answeredBy: { kind: 'grok', connectionId: 'conn-grok', model: 'grok-4.7' },
      system: 'test',
      view: null,
      messages: [user('앨리스 프로필 만들어줘')],
      timeoutMs: 1000,
      turn: fakeTurn(),
      cli: turn,
    });
    const body = await response.text();

    // First turn starts a session; the second resumes it with the tool results.
    expect(prompts.map((p) => p.sessionId)).toEqual([undefined, 'cli-1']);
    expect(prompts[1].prompt).toContain('작업실 도구 결과');
    expect(prompts[1].prompt).toContain("You're late.");
    expect(prompts[1].prompt).toContain('save_character: 제안을 올렸습니다');
    // The change waits as a proposal of this chat; nothing was written.
    const proposals = db.select().from(s.proposals).where(eq(s.proposals.projectId, projectId)).all();
    expect(proposals.map((p) => [p.tool, p.sessionId, p.status])).toEqual([['save_character', chat.id, 'pending']]);
    expect(db.select().from(s.characters).where(eq(s.characters.name, 'Bob')).get()).toBeUndefined();
    // The panel sees both tool calls and the final text; the CLI session is remembered.
    expect(body).toContain('"toolName":"find_lines"');
    expect(body).toContain('"proposalId"');
    expect(body).toContain('밥의 인물 추가를 제안했습니다');
    expect(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!.agentSession).toMatchObject({ kind: 'grok', model: 'grok-4.7', id: 'cli-1' });
  });

  it('finishes and saves a reply nobody reads any more (the page was reloaded)', async () => {
    const { db, chat } = setup();
    const onEnd = vi.fn();
    await cliChatResponse({
      db,
      chat,
      route: { kind: 'grok', model: 'grok-4.7' },
      answeredBy: { kind: 'grok', connectionId: 'conn-grok', model: 'grok-4.7' },
      system: 'test',
      view: null,
      messages: [user('안녕')],
      timeoutMs: 1000,
      turn: { ...fakeTurn(), end: onEnd },
      cli: async () => ({ sessionId: 'cli-1', text: '안녕하세요.', usage: {} }),
    });
    // The response body is never read.
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(JSON.stringify(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!.messages)).toContain('안녕하세요.');
  });

  it('corrects one Codex own-tool attempt and keeps both visible replies', async () => {
    const { db, chat } = setup();
    const prompts: string[] = [];
    const cli = async (_route: ai.ResolvedRoute, request: ai.CliChatTurn): Promise<ai.CliChatResult> => {
      prompts.push(request.prompt);
      return prompts.length === 1
        ? { sessionId: 'codex-1', text: '조회하겠습니다.', usage: {}, ownToolAttempt: true }
        : { sessionId: 'codex-1', text: '확인했습니다.', usage: {} };
    };
    const response = await cliChatResponse({
      db, chat, route: { kind: 'codex', model: 'gpt-6-luna' },
      answeredBy: { kind: 'codex', connectionId: 'conn-codex', model: 'gpt-6-luna' },
      system: 'test', view: null, messages: [user('용어집을 확인해줘')], timeoutMs: 1000, turn: fakeTurn(), cli,
    });
    const body = await response.text();

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe('답이 작업실 도구를 부르지 않은 채 끝났습니다. 이 대화에는 코드 실행(exec)이 없습니다. 작업실 도구가 필요하면 답의 맨 끝에 다음처럼 loca-tools 블록을 쓰세요:\n```loca-tools\n[{"tool": "<도구 이름>", "input": {}}]\n```\n도구가 필요 없으면 바로 답하세요.');
    expect(body).toContain('조회하겠습니다.');
    expect(body).toContain('확인했습니다.');
  });

  it('does not correct an own-tool attempt more than once in a turn', async () => {
    const { db, chat } = setup();
    const prompts: string[] = [];
    const response = await cliChatResponse({
      db, chat, route: { kind: 'codex', model: 'gpt-6-luna' },
      answeredBy: { kind: 'codex', connectionId: 'conn-codex', model: 'gpt-6-luna' },
      system: 'test', view: null, messages: [user('용어집을 확인해줘')], timeoutMs: 1000, turn: fakeTurn(),
      cli: async (_route, request) => {
        prompts.push(request.prompt);
        return { sessionId: 'codex-1', text: `답 ${prompts.length}`, usage: {}, ownToolAttempt: true };
      },
    });
    const body = await response.text();

    expect(prompts).toHaveLength(2);
    expect(body).toContain('답 1');
    expect(body).toContain('답 2');
  });
});
