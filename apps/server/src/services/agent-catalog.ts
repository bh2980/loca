import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { agentTools } from './agent-tools.ts';

/**
 * The chat agent's tools in a framework-neutral form, so CLI chats and the loca CLI get exactly
 * what the in-app AI SDK agent gets. Tools without a server-side execute (edit_workflow_node,
 * which the open editor applies) are left out.
 */
export interface CatalogTool {
  name: string;
  description: string;
  schema: z.ZodType;
  /** Changes the project: never run directly, only through an accepted proposal. */
  changes: boolean;
  run: (input: unknown) => Promise<unknown>;
}

interface SdkTool {
  description?: string;
  inputSchema: z.ZodType;
  needsApproval?: unknown;
  execute?: (input: never, options: never) => unknown;
}

export function agentCatalog(db: Db, projectId: string, author?: { model: string | null }, options?: { unrestricted?: boolean }): CatalogTool[] {
  const tools = agentTools(db, projectId, author, options) as unknown as Record<string, SdkTool>;
  return Object.entries(tools).flatMap(([name, tool]) => {
    const execute = tool.execute;
    if (!execute) return [];
    return [
      {
        name,
        description: tool.description ?? '',
        schema: tool.inputSchema,
        changes: Boolean(tool.needsApproval),
        run: async (input: unknown) => execute(tool.inputSchema.parse(input) as never, { toolCallId: 'catalog', messages: [] } as never),
      },
    ];
  });
}

/** JSON Schema for an input schema, as a CLI agent reads it. */
export const jsonSchemaOf = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
