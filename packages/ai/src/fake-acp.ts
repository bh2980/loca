/**
 * A fake agent CLI speaking ACP, for tests and for trying the project chat end to end without a
 * real CLI, a login or a model call: each turn calls the workbench tools FAKE_ACP_CHAT_TOOLS
 * names (default: find_lines) and streams a short reply that quotes the message and the results.
 *
 * Manual run: start the API with WORKBENCH_ACP_AGENT=<repo>/packages/ai/src/fake-acp.ts; every CLI
 * connection's chat then talks to this agent instead of the real one. FAKE_ACP_CHUNK_MS paces the
 * reply (default 20 ms per piece); FAKE_ACP_FAIL makes every turn fail with that message.
 * FAKE_ACP_IMAGES=off makes the agent say it takes no images (promptCapabilities.image false).
 * FAKE_ACP_AUTH (JSON list of {id, name}) offers login methods and makes sessions fail with "Authentication
 * required" until `authenticate` is called (the reply names the method used); FAKE_ACP_AUTH_FAIL makes it fail.
 */
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

interface FakeSession {
  system: string;
  servers: acp.McpServer[];
  model: string;
  abort?: AbortController;
}

const MODELS = ['fake', 'fake-2', 'fake/fake'];
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

async function connectTools(server: acp.McpServer) {
  if (!('url' in server)) return null;
  const client = new Client({ name: 'fake-acp', version: '0.0.0' });
  const headers = Object.fromEntries(server.headers.map((header) => [header.name, header.value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
  return client;
}

/** Runs the fake agent on a stream (stdio when this file is run directly, in-process in tests). */
export function fakeAgent(stream: acp.Stream, env: Record<string, string | undefined> = process.env) {
  const sessions = new Map<string, FakeSession>();
  const methods = JSON.parse(env.FAKE_ACP_AUTH ?? '[]') as { id: string; name: string }[];
  let loggedInWith: string | undefined;
  const needLogin = () => {
    if (methods.length && !loggedInWith) throw new acp.RequestError(-32000, 'Authentication required · No authentication method selected.');
  };
  return new acp.AgentSideConnection(
    (client) => ({
      initialize: async () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: env.FAKE_ACP_IMAGES !== 'off' }, mcpCapabilities: { http: true }, sessionCapabilities: { resume: {}, close: {}, systemPrompt: { mode: { override: {} } } } },
        authMethods: methods,
      }),
      newSession: async (params) => {
        needLogin();
        const sessionId = randomUUID();
        sessions.set(sessionId, { system: params.systemPrompt?.content.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? '', servers: params.mcpServers, model: MODELS[0]! });
        return { sessionId, configOptions: [{ id: 'model', name: 'Model', type: 'select', currentValue: MODELS[0]!, options: MODELS.map((value) => ({ value, name: value })) }] };
      },
      resumeSession: async (params) => {
        needLogin();
        sessions.set(params.sessionId, { system: params.systemPrompt?.content.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? '', servers: params.mcpServers ?? [], model: MODELS[0]! });
        return {};
      },
      closeSession: async (params) => {
        sessions.delete(params.sessionId);
        return {};
      },
      setSessionConfigOption: async (params) => {
        const session = sessions.get(params.sessionId);
        if (session && params.configId === 'model') session.model = String(params.value);
        return { configOptions: [] };
      },
      authenticate: async (params) => {
        if (env.FAKE_ACP_AUTH_FAIL) throw new acp.RequestError(-32603, env.FAKE_ACP_AUTH_FAIL);
        if (!methods.some((method) => method.id === params.methodId)) throw new acp.RequestError(-32602, `Unknown auth method ${params.methodId}`);
        loggedInWith = params.methodId;
        return {};
      },
      cancel: async (params) => {
        sessions.get(params.sessionId)?.abort?.abort();
      },
      prompt: async (params) => {
        const session = sessions.get(params.sessionId);
        if (!session) throw acp.RequestError.resourceNotFound(params.sessionId);
        const abort = new AbortController();
        session.abort = abort;
        const text = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
        const images = params.prompt.filter((block) => block.type === 'image').length;
        const say = (chunk: string) => client.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } });
        const tools = session.servers[0] ? await connectTools(session.servers[0]) : null;
        try {
          const listed = tools ? (await tools.listTools()).tools : [];
          if (env.FAKE_ACP_FAIL) throw new acp.RequestError(-32603, env.FAKE_ACP_FAIL);
          // A chat turn: call the tools FAKE_ACP_CHAT_TOOLS names (default: look lines up) when offered, then answer in pieces.
          const calls = JSON.parse(env.FAKE_ACP_CHAT_TOOLS ?? '[{"name":"find_lines","arguments":{"limit":3}}]') as { name: string; arguments: Record<string, unknown> }[];
          let found = '';
          for (const call of calls) {
            if (!tools || !listed.some((tool) => tool.name === call.name)) continue;
            const toolCallId = randomUUID();
            await client.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title: `mcp__loca__${call.name}`, status: 'in_progress', rawInput: call.arguments } });
            const result = await tools.callTool(call);
            found += (result.content as { type: string; text?: string }[]).map((part) => part.text ?? '').join('').slice(0, 600);
            await client.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' } });
          }
          const reply = `가짜 ACP 에이전트(${session.model}${loggedInWith ? `, 로그인 ${loggedInWith}` : ''})의 답입니다. 받은 메시지: ${text.slice(-120)}${images ? ` (이미지 ${images}장)` : ''}${found ? `\n\n도구 결과 일부: ${found}` : ''}`;
          for (const piece of reply.match(/.{1,40}/gs) ?? []) {
            if (abort.signal.aborted) return { stopReason: 'cancelled' };
            await say(piece);
            await sleep(Number(env.FAKE_ACP_CHUNK_MS ?? 20), abort.signal);
          }
          if (abort.signal.aborted) return { stopReason: 'cancelled' };
          return { stopReason: 'end_turn', usage: { inputTokens: 1000 + text.length, outputTokens: reply.length, totalTokens: 1000 + text.length + reply.length } };
        } finally {
          await tools?.close();
          session.abort = undefined;
        }
      },
    }),
    stream,
  );
}

if (import.meta.main) fakeAgent(acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
