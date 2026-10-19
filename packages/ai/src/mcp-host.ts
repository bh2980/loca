import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** A tool an ACP agent calls through our MCP server. */
export interface HostedTool {
  name: string;
  description: string;
  /** JSON Schema of the input; MCP wants an object at the root. */
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
}

/** What `session/new` gets for a tool set: an HTTP MCP server only its bearer token opens. */
export interface HostedServer {
  type: 'http';
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

/** Tool sets by token. The list is read on every request, so a set can change between calls. */
const sets = new Map<string, () => HostedTool[]>();
let listening: Promise<string> | undefined;

/**
 * One loopback HTTP listener for every tool set (stateless Streamable HTTP: each request gets
 * its own MCP server). Agents reach it on 127.0.0.1 only; the token decides which tools they see.
 */
function listen(): Promise<string> {
  listening ??= new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
      const tools = token ? sets.get(token) : undefined;
      if (!tools) {
        res.writeHead(401).end();
        return;
      }
      void serve(tools, req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.on('error', (error) => {
      listening = undefined;
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`));
    server.unref();
  });
  return listening;
}

async function serve(tools: () => HostedTool[], req: http.IncomingMessage, res: http.ServerResponse) {
  const server = new Server({ name: 'loca', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as { type: 'object' } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools().find((candidate) => candidate.name === request.params.name);
    if (!tool) return { isError: true, content: [{ type: 'text', text: `알 수 없는 도구입니다: ${request.params.name}` }] };
    try {
      const result = await tool.run(request.params.arguments ?? {});
      return { isError: Boolean(result.isError), content: [{ type: 'text', text: result.text }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/** Serves `tools` until `dispose`; pass `server` to the agent's session. */
export async function hostTools(name: string, tools: () => HostedTool[]): Promise<{ server: HostedServer; dispose: () => void }> {
  const url = await listen();
  const token = randomUUID();
  sets.set(token, tools);
  return { server: { type: 'http', name, url, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }, dispose: () => sets.delete(token) };
}
