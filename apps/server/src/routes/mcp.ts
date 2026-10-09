import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq } from 'drizzle-orm';
import { found, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from '../services/agent-catalog.ts';
import { AGENT_SYSTEM } from '../services/agent-tools.ts';
import { propose, proposedText } from '../services/proposals.ts';

/**
 * The project's agent tools over MCP (streamable HTTP, stateless), for any MCP client:
 * Claude Code, Codex, Cursor… Reading runs directly; changes become proposals that a person
 * accepts in the workbench's chat panel. Local only, like the rest of the API.
 */
function serverFor(db: Parameters<typeof agentCatalog>[0], projectId: string, projectName: string) {
  const server = new McpServer(
    { name: 'translation-workbench', version: '1.0.0' },
    {
      instructions: `${AGENT_SYSTEM}\n\n프로젝트: ${projectName}. 프로젝트를 바꾸는 도구는 바로 실행되지 않고 제안으로 올라가며, 사용자가 작업실 채팅 패널에서 수락해야 반영됩니다.`,
    },
  );
  for (const tool of agentCatalog(db, projectId)) {
    server.registerTool(
      tool.name,
      {
        description: tool.changes ? `${tool.description} (제안으로 올라가며 사용자가 작업실에서 수락해야 반영됩니다.)` : tool.description,
        inputSchema: tool.schema as never,
        annotations: { readOnlyHint: !tool.changes },
      },
      (async (input: Record<string, unknown>) => {
        try {
          if (tool.changes) {
            const proposal = propose(db, { projectId, sessionId: null, source: 'mcp', tool: tool.name, input });
            return { content: [{ type: 'text' as const, text: proposedText(proposal.id) }] };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(await tool.run(input)) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
        }
      }) as never,
    );
  }
  return server;
}

export const mcpRoutes = new Hono<Env>().all('/projects/:projectId/mcp', async (c) => {
  const { db } = c.var.deps;
  const projectId = c.req.param('projectId');
  const project = found(db.select({ name: s.projects.name }).from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
  // Stateless: a fresh server and transport per request, so tools always reflect current data.
  const server = serverFor(db, projectId, project.name);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c);
});
