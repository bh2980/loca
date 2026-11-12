import { tool, type ToolSet } from 'ai';
import type { Db } from '../db/index.ts';
import type * as s from '../db/schema.ts';
import { catalogOf, type CatalogTool } from './agent-catalog.ts';
import { agentTools, type ToolDef } from './agent-tools.ts';
import { proposeChange } from './change-gate.ts';
import { refusalText } from './proposal-check.ts';
import { fitResult } from './tool-output.ts';

/**
 * Calling a catalogue tool, the same way from every surface: the app's API chat (`api`), a CLI chat
 * over ACP (`acp`) and the `loca` CLI (`terminal`). The input is checked against the tool's schema; a
 * change goes to the change gate; anything else runs at once and its result is fitted to what the
 * surface can take. Only how the outcome is worded differs per surface.
 */
export type ToolSurface = 'api' | 'acp' | 'terminal';

/**
 * How much of a result a surface is given (characters of JSON). A model reads a part and is told how to
 * get the rest (a CLI agent has less room: its own prompt and tools ride along). The terminal gets the
 * whole result: its JSON goes into files and back into other commands, which a cut would break.
 */
const RESULT_CHARS: Record<ToolSurface, number | null> = { api: 30_000, acp: 20_000, terminal: null };

/** How change tools are described to a model in a chat (the terminal lists them as changes instead). */
export const CHANGE_NOTE = '대화의 권한 모드에 따라 바로 반영되거나, 사용자가 카드에서 결정할 때까지 제안으로 기다립니다. 어느 쪽인지는 도구 결과에 나옵니다';
export const describeTool = (entry: Pick<CatalogTool, 'description' | 'changes'>, surface: ToolSurface) => (entry.changes && surface !== 'terminal' ? `${entry.description} (${CHANGE_NOTE})` : entry.description);

export interface ToolCaller {
  projectId: string;
  surface: ToolSurface;
  /** The conversation that calls; null for the terminal, whose changes follow the project's terminal permission mode. */
  sessionId: string | null;
  model?: string | null;
}

export type ToolOutcome =
  /** The input does not fit the tool's schema. */
  | { kind: 'invalid'; error: string }
  /** It ran at once (a read, or a direct write): the result, fitted to the surface. */
  | { kind: 'result'; result: unknown }
  /** A change the gate did not take: why, and (hint) how the agent can fix it. */
  | { kind: 'refused'; error: string; hint?: string }
  /** A change that became a proposal: applied now or waiting, as the permission mode decided. `text` says so to an agent. */
  | { kind: 'proposal'; proposalId: string; applied: boolean; status: s.ProposalStatus; result?: unknown; review?: string; text: string; report: s.ProposalReport | null };

export async function callTool(db: Db, caller: ToolCaller, entry: CatalogTool, raw: unknown): Promise<ToolOutcome> {
  const parsed = entry.schema.safeParse(raw);
  if (!parsed.success) return { kind: 'invalid', error: `입력이 맞지 않습니다: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}` };
  if (entry.changes) {
    const gate = await proposeChange(db, {
      projectId: caller.projectId,
      sessionId: caller.sessionId,
      model: caller.model,
      source: caller.surface === 'api' ? 'api' : 'cli',
      tool: entry.name,
      input: parsed.data as Record<string, unknown>,
      terminal: caller.surface === 'terminal',
    });
    if (!gate.ok) return { kind: 'refused', error: gate.error, ...(gate.hint && { hint: gate.hint }) };
    return { kind: 'proposal', proposalId: gate.proposalId, applied: gate.applied, status: gate.status, result: gate.result, review: gate.review, text: gate.text, report: gate.report };
  }
  const result = await entry.run(parsed.data);
  const limit = RESULT_CHARS[caller.surface];
  return { kind: 'result', result: limit === null ? result : fitResult(result, limit) };
}

/** A tool call's outcome as the chat panel shows it (the tool part's output). */
export function panelOutput(outcome: ToolOutcome): unknown {
  if (outcome.kind === 'result') return outcome.result;
  if (outcome.kind === 'proposal') return { proposalId: outcome.proposalId, applied: outcome.applied, status: outcome.status, note: outcome.text };
  // The panel shows the plain reason; the ids to fix it with are for the agent (hint).
  return { ok: false, error: outcome.kind === 'refused' ? `제안하지 못했습니다: ${outcome.error}` : outcome.error, ...(outcome.kind === 'refused' && outcome.hint && { hint: outcome.hint }) };
}

/** The same outcome as text, for an agent that reads tool results as text (a CLI chat); `isError` when nothing came of the call. */
export function agentText(outcome: ToolOutcome): { text: string; isError: boolean } {
  if (outcome.kind === 'result') return { text: JSON.stringify(outcome.result) ?? 'null', isError: false };
  if (outcome.kind === 'proposal') return { text: outcome.text, isError: false };
  return { text: outcome.kind === 'refused' ? `제안을 만들지 않았습니다 — ${refusalText(outcome)}` : `실패 — ${outcome.error}`, isError: true };
}

/**
 * The agent's tools for the API chat (AI SDK): every call goes through callTool, so a change is decided
 * by the conversation's permission mode like on the other surfaces (the SDK's own approval step is not
 * used). A tool the open workflow editor carries out has no execute: the browser answers the call.
 */
export function apiChatTools(db: Db, projectId: string, sessionId: string, author: { model: string | null }): ToolSet {
  const caller: ToolCaller = { projectId, surface: 'api', sessionId, model: author.model };
  const definitions = agentTools(db, projectId, author);
  const catalog = new Map(catalogOf(definitions).map((entry) => [entry.name as string, entry]));
  return Object.fromEntries(
    (Object.entries(definitions) as [string, ToolDef][]).map(([name, definition]) => {
      const entry = catalog.get(name);
      if (!entry) return [name, tool({ description: definition.description, inputSchema: definition.inputSchema })];
      return [name, tool({ description: describeTool(entry, 'api'), inputSchema: definition.inputSchema, execute: async (input: unknown) => panelOutput(await callTool(db, caller, entry, input)) })];
    }),
  ) as ToolSet;
}
