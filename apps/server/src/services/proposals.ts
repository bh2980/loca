import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { agentCatalog } from './agent-catalog.ts';

export function propose(db: Db, input: { projectId: string; sessionId: string | null; source: 'pi' | 'cli'; tool: string; input: Record<string, unknown> }) {
  const row = db.insert(s.proposals).values(input).returning().get();
  events.changed(input.projectId, 'proposals');
  return row;
}

/** What an agent is told when it proposes a change instead of making it. */
export const proposedText = (id: string) =>
  `제안을 올렸습니다 (proposal ${id}). 아직 반영되지 않았습니다. 사용자가 작업실 채팅 패널에서 수락하면 반영됩니다. 같은 제안을 반복하지 마세요.`;

/** Accept runs the tool the agent asked for with the stored input; reject only records the decision. */
export async function decideProposal(db: Db, id: string, accept: boolean) {
  const proposal = db.select().from(s.proposals).where(eq(s.proposals.id, id)).get();
  if (!proposal) throw new Error('제안을 찾을 수 없습니다.');
  if (proposal.status !== 'pending') throw new Error('이미 결정한 제안입니다.');
  let status: 'accepted' | 'rejected' | 'failed' = accept ? 'accepted' : 'rejected';
  let result: unknown = null;
  if (accept) {
    const tool = agentCatalog(db, proposal.projectId).find((candidate) => candidate.name === proposal.tool && candidate.changes);
    try {
      if (!tool) throw new Error(`알 수 없는 도구입니다: ${proposal.tool}`);
      result = await tool.run(proposal.input);
      if (result && typeof result === 'object' && (result as { ok?: boolean }).ok === false) status = 'failed';
    } catch (error) {
      status = 'failed';
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const row = db
    .update(s.proposals)
    .set({ status, result, decidedAt: new Date() })
    .where(and(eq(s.proposals.id, id), eq(s.proposals.status, 'pending')))
    .returning()
    .get();
  events.changed(proposal.projectId, 'proposals');
  return row;
}

/**
 * Decisions the chat's agent has not heard about yet, as a line for its next prompt. A decided
 * proposal is reported once: `reportedAt` would need a column, so the caller passes what it already said.
 */
export function decisionsSince(db: Db, sessionId: string, since: Date) {
  return db
    .select()
    .from(s.proposals)
    .where(eq(s.proposals.sessionId, sessionId))
    .all()
    .filter((proposal) => proposal.decidedAt && proposal.decidedAt > since);
}
