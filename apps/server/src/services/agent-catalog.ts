import type { JSONParsed } from 'hono/utils/types';
import { z } from 'zod';
import { toolRoute, type ToolName } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { agentTools, type AgentTools, type ToolDef } from './agent-tools.ts';
import { unchecked, type Prepared } from './proposal-check.ts';
import type { Inverse } from './proposal-undo.ts';
import type { Saver } from './status-by.ts';

/**
 * The agent's tools as every surface calls them (the app's API chat, CLI chats over ACP, the `loca`
 * CLI): the server's definition joined with what its spec says (TOOL_SPECS). Tools the open workflow
 * editor carries out (spec `via: 'editor'`) have no server side and are left out.
 */
export interface CatalogTool {
  name: ToolName;
  description: string;
  schema: z.ZodType;
  /** Goes through the change gate (its spec: not a read, not a direct write): never run directly, only as an accepted proposal. */
  changes: boolean;
  run: (input: unknown) => Promise<unknown>;
  /** The tool's check of a change before it becomes a proposal. */
  check: (input: Record<string, unknown>) => Promise<Prepared>;
  /** How its accepted change is put back. */
  undo?: Inverse;
}

export function catalogOf(tools: Partial<AgentTools>): CatalogTool[] {
  return (Object.entries(tools) as [ToolName, ToolDef][]).flatMap(([name, tool]) => {
    const execute = tool.execute;
    if (!execute || toolRoute(name) === 'editor') return [];
    return [
      {
        name,
        description: tool.description,
        schema: tool.inputSchema,
        changes: toolRoute(name) === 'gate',
        run: async (input: unknown) => execute(tool.inputSchema.parse(input)),
        check: async (input: Record<string, unknown>) => (tool.check ? tool.check(input) : unchecked(input)),
        undo: tool.undo,
      },
    ];
  });
}

export const agentCatalog = (db: Db, projectId: string, author?: { model: string | null; saver?: Saver; sessionId?: string | null }, options?: { unrestricted?: boolean }): CatalogTool[] =>
  catalogOf(agentTools(db, projectId, author, options));

/**
 * The one check every change goes through when it is proposed (tool calls of every chat backend, the
 * CLI's commands and import), so the person decides on something that can be applied: each tool's own
 * `check` (agent-tools.ts). A change to a row that does not exist is refused at once and the agent hears why.
 */
export async function prepareProposal(db: Db, projectId: string, tool: string, input: Record<string, unknown>): Promise<Prepared> {
  const found = agentCatalog(db, projectId, undefined, { unrestricted: true }).find((candidate) => candidate.name === tool);
  if (!found?.changes) return { ok: false, error: `변경 도구가 아닙니다: ${tool}` };
  return found.check(input);
}

/** JSON Schema for an input schema, as a CLI agent reads it. */
export const jsonSchemaOf = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;

/** What each tool takes and answers as the `loca` CLI sees them (after JSON), by tool name. */
export type ToolInputs = { [K in keyof AgentTools]: z.input<AgentTools[K]['inputSchema']> };
export type ToolResults = { [K in keyof AgentTools]: AgentTools[K] extends { execute?: (...args: never[]) => infer R } ? JSONParsed<Awaited<R>> : never };
