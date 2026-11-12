import { and, eq } from 'drizzle-orm';
import type { ProposalDetail } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { agentTools, type ToolDef } from './agent-tools.ts';
import { listedProposal } from './proposals.ts';

/**
 * What a proposal's card says it does: the details its tool's own `preview` makes (agent-tools.ts) from the stored
 * input and the project's data as it is now. Nothing here knows a tool by name: a tool without a preview, or an
 * input its preview cannot read, is shown as the input was written.
 */
type Proposal = typeof s.proposals.$inferSelect;
type Tools = Record<string, ToolDef>;

/** As much of an input as a card shows as written. */
const WRITTEN_CHARS = 4_000;
const asWritten = (input: unknown): ProposalDetail[] => {
  const text = JSON.stringify(input, null, 2) ?? '';
  return [{ kind: 'text', format: 'plain', text: text.length > WRITTEN_CHARS ? `${text.slice(0, WRITTEN_CHARS)}\n…` : text }];
};

/** Every tool's definition, whatever the agent may use now: a card says what its proposal does even after the tool was switched off. */
const toolsOf = (db: Db, projectId: string): Tools => agentTools(db, projectId, undefined, { unrestricted: true }) as Tools;

export function proposalDetails(db: Db, proposal: Proposal, tools: Tools = toolsOf(db, proposal.projectId)): ProposalDetail[] {
  const preview = Object.hasOwn(tools, proposal.tool) ? tools[proposal.tool]!.preview : undefined;
  if (!preview) return asWritten(proposal.input);
  try {
    return preview(proposal.input, proposal);
  } catch {
    return asWritten(proposal.input);
  }
}

/** A proposal as its card shows it: the stored row as lists send it, with what it would change. */
export const proposalRow = (db: Db, proposal: Proposal, tools?: Tools) => ({ ...listedProposal(proposal), details: proposalDetails(db, proposal, tools) });

/** The project's proposals by id (the rows the browser's proposals collection holds). */
export function proposalRows(db: Db, projectId: string, ids: readonly string[]) {
  if (!ids.length) return [];
  const tools = toolsOf(db, projectId);
  return db.select().from(s.proposals).where(and(eq(s.proposals.projectId, projectId), inList(s.proposals.id, ids))).all().map((row) => proposalRow(db, row, tools));
}
