import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import type * as ai from '@tw/ai';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { cliChatResponse, readLocaCall, readToolCalls } from './cli-chat.ts';
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

const fakeTurn = () => ({ token: crypto.randomUUID(), signal: new AbortController().signal, end: () => {}, record: () => {}, markClosing: () => {} });

const user = (text: string) => ({ id: crypto.randomUUID(), role: 'user' as const, parts: [{ type: 'text' as const, text }] });

describe('CLI chat', () => {
  it('reads tool blocks out of an answer', () => {
    const answer = '찾아볼게요.\n```loca-tools\n[{"tool":"find_lines","input":{"speakers":["Alice"]}}]\n```';
    expect(readToolCalls(answer)).toEqual({ visible: '찾아볼게요.', calls: [{ tool: 'find_lines', input: { speakers: ['Alice'] } }], error: undefined });
    expect(readToolCalls('```loca-tools\n[{bad json\n```').error).toMatch(/JSON/);
  });

  it('parses the supported loca call command forms and leaves other shell commands alone', () => {
    expect(readLocaCall(`loca call find_lines '{"speakers":["Alice"]}'`)).toEqual({ tool: 'find_lines', input: { speakers: ['Alice'] } });
    expect(readLocaCall("loca call find_lines - <<'JSON'\n{\"limit\":20}\nJSON")).toEqual({ tool: 'find_lines', input: { limit: 20 } });
    expect(readLocaCall("loca call find_lines '{broken}'")).toEqual({ tool: 'find_lines', input: { command: "loca call find_lines '{broken}'" } });
    expect(readLocaCall('loca call find_lines unsupported')).toEqual({ tool: 'find_lines', input: { command: 'loca call find_lines unsupported' } });
    expect(readLocaCall('pwd')).toEqual({ command: 'pwd' });
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

  it('renders Codex shell commands as tool parts and does not parse loca-tools blocks', async () => {
    const { db, chat } = setup();
    const cli = async (_route: ai.ResolvedRoute, request: ai.CliChatTurn): Promise<ai.CliChatResult> => {
      expect(request.shell).toMatchObject({ env: { LOCA_PROJECT: chat.projectId, LOCA_CHAT: expect.any(String) }, readPaths: [expect.any(String)], deny: [expect.any(String)], loca: expect.stringContaining('/apps/cli/bin/loca.mjs') });
      return {
        sessionId: 'codex-1', text: '완료했습니다.\n```loca-tools\n[{"tool":"find_lines"}]\n```', usage: {},
        commands: [{ command: "loca call save_character '{\"name\":\"Bob\"}'", output: '{"proposalId":"proposal-1"}', exitCode: 0 }],
      };
    };
    const response = await cliChatResponse({
      db, chat, route: { kind: 'codex', model: 'gpt-6-luna' },
      answeredBy: { kind: 'codex', connectionId: 'conn-codex', model: 'gpt-6-luna' },
      system: 'test', view: null, messages: [user('용어집을 확인해줘')], timeoutMs: 1000, turn: fakeTurn(), cli,
    });
    const body = await response.text();

    expect(body).toContain('"toolName":"save_character"');
    expect(body).toContain('"proposalId":"proposal-1"');
    expect(body).toContain('완료했습니다.');
    expect(body).toContain('```loca-tools');
    expect(body.match(/"type":"start-step"/g)).toHaveLength(1);
  });
});
