import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as acp from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { acpError, agentCommand, AcpAgent as Agent, agentFor, agentWith, closeSession, readUsage, setAgentStarter, stopIdleAgents, type AcpAgent } from './acp.ts';
import { ModelError } from './errors.ts';
import { inProcessStarter } from './fake-acp-starter.ts';
import { hostTools } from './mcp-host.ts';

const cwd = () => mkdtempSync(path.join(tmpdir(), 'loca-acp-test-'));

async function failure(promise: Promise<unknown>): Promise<ModelError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ModelError) return error;
    throw error;
  }
  throw new Error('expected a ModelError');
}

/** One turn: the streamed text and what prompt() returned. */
async function turn(agent: AcpAgent, sessionId: string, text: string, options: { signal?: AbortSignal; timeoutMs?: number; idleMs?: number } = {}) {
  let reply = '';
  const result = await agent.prompt(
    sessionId,
    text,
    {
      update: (update) => {
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') reply += update.content.text;
      },
    },
    { timeoutMs: 10_000, ...options },
  );
  return { reply, ...result };
}

afterEach(async () => {
  await stopIdleAgents(true);
  setAgentStarter(null);
});

describe('chat sessions over ACP', () => {
  it('streams the reply and runs our MCP tools, which the agent is allowed to call', async () => {
    setAgentStarter(inProcessStarter());
    const calls: unknown[] = [];
    const tools = await hostTools('loca', () => [
      {
        name: 'find_lines',
        description: 'Find lines.',
        inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
        run: async (input) => {
          calls.push(input);
          return { text: 'L1: Halt!' };
        },
      },
    ]);
    const agent = await agentFor('grok');
    const session = await agent.newSession({ cwd: cwd(), mcpServers: [tools.server], system: 'be brief' });
    await agent.configure(session.sessionId, session.configOptions, 'fake-2');
    const { reply, stopReason, usage } = await turn(agent, session.sessionId, '대사 찾아줘');
    expect(stopReason).toBe('end_turn');
    expect(calls).toEqual([{ limit: 3 }]);
    expect(reply).toContain('fake-2');
    expect(reply).toContain('L1: Halt!');
    expect(usage.outputTokens).toBe(reply.length);
    tools.dispose();
  });

  it('keeps every conversation on one process and finds the process that has a session open', async () => {
    let started = 0;
    const start = inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]' });
    setAgentStarter(async (kind) => {
      started++;
      return start(kind);
    });
    const agent = await agentFor('claude');
    const sessions = await Promise.all([1, 2, 3].map(() => agent.newSession({ cwd: cwd(), mcpServers: [], system: '' })));
    await Promise.all(sessions.map((session) => turn(agent, session.sessionId, 'hi')));
    expect(started).toBe(1);
    expect(await agentWith('claude', undefined, sessions[1]!.sessionId)).toBe(agent);
    expect(await agentWith('claude', undefined, 'unknown')).toBeNull();
  });

  it('reopens a saved session on a new process', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]' }));
    const first = await agentFor('opencode');
    const { sessionId } = await first.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    await stopIdleAgents(true);
    const second = await agentFor('opencode');
    expect(second).not.toBe(first);
    expect(await second.reopen({ sessionId, cwd: cwd(), mcpServers: [], system: '' })).not.toBeNull();
    expect((await turn(second, sessionId, 'again')).stopReason).toBe('end_turn');
  });

  it('closes a session the chat left, and closes idle sessions while the process keeps working', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]', FAKE_ACP_CHUNK_MS: '300' }));
    const agent = await agentFor('claude');
    const left = await agent.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    await closeSession(left.sessionId);
    expect(await agentWith('claude', undefined, left.sessionId)).toBeNull();
    // Closed, not lost: the CLI's store reopens it.
    expect(await agent.reopen({ sessionId: left.sessionId, cwd: cwd(), mcpServers: [], system: '' })).not.toBeNull();

    const idle = await agent.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    const working = await agent.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    const running = turn(agent, working.sessionId, 'long');
    await stopIdleAgents(false, Date.now() + 11 * 60_000);
    expect(agent.alive).toBe(true);
    expect(agent.sessions.has(idle.sessionId)).toBe(false);
    expect(agent.sessions.has(working.sessionId)).toBe(true);
    await running;
    // Nothing running and nothing used for longer than the idle window: the process stops.
    await stopIdleAgents(false, Date.now() + 11 * 60_000);
    await agent.exited;
    expect(agent.alive).toBe(false);
  });

  it('names the models the CLI has when the chosen one is missing, and maps agy names with a level', async () => {
    setAgentStarter(inProcessStarter());
    const agent = await agentFor('antigravity');
    const session = await agent.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    const error = await failure(agent.configure(session.sessionId, session.configOptions, 'nope'));
    expect(error.code).toBe('config');
    expect(error.message).toContain('fake-2');
    await agent.configure(session.sessionId, session.configOptions, 'fake-2-low');
    expect((await turn(agent, session.sessionId, 'x')).reply).toContain('fake-2');
  });

  it('cancels a turn, stops one that goes quiet, and fails with the reason the CLI gave', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]', FAKE_ACP_CHUNK_MS: '400' }));
    const agent = await agentFor('codex');
    const { sessionId } = await agent.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    expect((await failure(turn(agent, sessionId, 'x', { signal: controller.signal }))).code).toBe('cancelled');
    expect((await failure(turn(agent, sessionId, 'x', { idleMs: 150 }))).code).toBe('timeout');

    await stopIdleAgents(true);
    setAgentStarter(inProcessStarter({ FAKE_ACP_FAIL: "You've hit your usage limit. Try again later." }));
    const failing = await agentFor('codex');
    const other = await failing.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    expect((await failure(turn(failing, other.sessionId, 'x'))).code).toBe('rate-limit');
  });

  it('fails a turn with the process reason when the agent dies', async () => {
    setAgentStarter(inProcessStarter({ FAKE_ACP_CHAT_TOOLS: '[]', FAKE_ACP_CHUNK_MS: '400' }));
    const agent = await agentFor('claude');
    const { sessionId } = await agent.newSession({ cwd: cwd(), mcpServers: [], system: '' });
    setTimeout(() => agent.kill(), 100);
    const error = await failure(turn(agent, sessionId, 'x'));
    expect(error.code).toBe('cli');
    expect(error.message).toContain('종료');
  });

  it("reads usage from the protocol, from Grok's own report, and counts an Anthropic-style cache as input", () => {
    expect(readUsage({ usage: { inputTokens: 4, outputTokens: 187, cachedReadTokens: 1585, cachedWriteTokens: 1764, totalTokens: 3540 } })).toEqual({ inputTokens: 3353, outputTokens: 187, cachedInputTokens: 1585 });
    expect(readUsage({ _meta: { usage: { inputTokens: 42586, outputTokens: 647, cachedReadTokens: 23040, reasoningTokens: 508, costUsdTicks: 185279600 } } })).toEqual({
      inputTokens: 42586,
      outputTokens: 647,
      cachedInputTokens: 23040,
      reasoningTokens: 508,
      costUsd: 0.01852796,
    });
    expect(readUsage({})).toEqual({});
  });
});

describe('the fake agent as a process (WORKBENCH_ACP_AGENT)', () => {
  it('starts and answers like a real CLI', async () => {
    process.env.WORKBENCH_ACP_AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-acp.ts');
    try {
      const agent = await agentFor('codex');
      const { sessionId } = await agent.newSession({ cwd: cwd(), mcpServers: [], system: '' });
      expect((await turn(agent, sessionId, '안녕')).reply).toContain('안녕');
    } finally {
      delete process.env.WORKBENCH_ACP_AGENT;
    }
  }, 20_000);
});

describe('what a failed agent says', () => {
  it('names a login only when the CLI says so, not for any JSON-RPC -32000', () => {
    expect(acpError({ code: -32000, message: 'Internal error', data: { details: 'spawn failed' } }).code).toBe('cli');
    expect(acpError({ code: -32000, message: 'Authentication required' }).code).toBe('auth');
    expect(acpError(new Error('x'), 'Error: you are not logged in\n').code).toBe('auth');
    const withMethods = acpError({ code: -32000, message: 'login required' }, '', { authMethods: ['ChatGPT', 'API key'] });
    expect(withMethods.message).toContain('ChatGPT, API key');
  });

  it('reports the exit code, the last stderr lines and the command when the stream closes at once', async () => {
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stderr, kill: () => {} });
    const closed = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    void closed.writable.close();
    const sink = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    // The stream is gone before the process has said anything; stderr and the exit follow a moment later.
    setTimeout(() => {
      stderr.write('boom: cannot find module\n');
      stderr.end();
      setTimeout(() => child.emit('exit', 3), 20);
    }, 30);
    const error = await failure(Agent.over('opencode', child as never, { writable: sink.writable, readable: closed.readable }, 'opencode.cmd acp'));
    expect(error.message).toContain('exit 3');
    expect(error.message).toContain('boom: cannot find module');
    expect(error.message).toContain('opencode.cmd acp');
  });
});

describe('the command a chat agent runs', () => {
  const deps = (files: string[], read: string) => ({ home: 'C:\\Users\\me', exists: (file: string) => files.includes(file), read: () => read, parse: (command: string, args: string[]) => ({ command: 'cmd.exe', args: ['/d', '/s', '/c', `"${command} ${args.join(' ')}"`], options: { windowsVerbatimArguments: true } }) });

  it('keeps windowsVerbatimArguments for a .cmd that cmd.exe has to run (opencode, grok)', () => {
    const command = agentCommand('opencode', 'C:\\tools\\opencode.cmd', { platform: 'win32', env: {}, deps: deps(['C:\\tools\\opencode.cmd'], '@echo off\r\nopencode-real %*') });
    expect(command.file).toBe('cmd.exe');
    expect(command.windowsVerbatimArguments).toBe(true);
    expect(agentCommand('opencode', '/usr/bin/opencode', { platform: 'linux', env: {}, deps: { exists: () => true } }).windowsVerbatimArguments).toBeUndefined();
  });

  it('gives Claude a real executable, never a .cmd', () => {
    const cmdOnly = deps(['C:\\tools\\claude.cmd'], '@echo off\r\nclaude-real %*');
    expect(() => agentCommand('claude', 'C:\\tools\\claude.cmd', { platform: 'win32', env: {}, deps: cmdOnly })).toThrow(/claude\.exe의 전체 경로/);
    const withExe = agentCommand('claude', 'C:\\tools\\claude.cmd', { platform: 'win32', env: {}, deps: deps(['C:\\tools\\claude.cmd', 'C:\\tools\\claude.exe'], '') });
    expect(withExe.env.CLAUDE_CODE_EXECUTABLE).toBe('C:\\tools\\claude.exe');
  });
});
