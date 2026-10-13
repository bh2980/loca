import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { agentCatalog } from './agent-catalog.ts';

/** Stores a proposal; callers check it first with prepareProposal (proposal-check.ts). */
export function propose(db: Db, input: { projectId: string; sessionId: string | null; source: 'pi' | 'cli'; tool: string; input: Record<string, unknown>; report?: s.ProposalReport | null }) {
  const row = db.insert(s.proposals).values(input).returning().get();
  events.changed(input.projectId, 'proposals');
  return row;
}

/** Lines of a batch proposal sent with the list; the panel previews these and shows the counts. */
const PREVIEW_CHANGES = 50;

/**
 * A batch proposal can carry a whole game (50k lines, several MB): the list sends its counts and
 * the first lines, and accepting still runs the stored input.
 */
export function listedProposal(proposal: typeof s.proposals.$inferSelect) {
  // The check's report can name every line too (a warning per line): first entries plus counts.
  const report = proposal.report;
  if (report && (report.dropped.length > PREVIEW_CHANGES || report.warnings.length > PREVIEW_CHANGES))
    proposal = { ...proposal, report: { dropped: report.dropped.slice(0, PREVIEW_CHANGES), warnings: report.warnings.slice(0, PREVIEW_CHANGES), counts: { dropped: report.dropped.length, warnings: report.warnings.length } } as s.ProposalReport };
  const changes = (proposal.input as { changes?: { translation?: string; status?: string; addTags?: string[]; removeTags?: string[] }[] }).changes;
  if (!Array.isArray(changes) || changes.length <= PREVIEW_CHANGES) return proposal;
  const counts = {
    lines: changes.length,
    translations: changes.filter((change) => change.translation !== undefined).length,
    statuses: changes.filter((change) => change.status).length,
    tagged: changes.filter((change) => change.addTags?.length || change.removeTags?.length).length,
  };
  return { ...proposal, input: { ...proposal.input, changes: changes.slice(0, PREVIEW_CHANGES), counts } };
}

/** What an agent is told when it proposes a change instead of making it. */
export const proposedText = (id: string) =>
  `제안을 올렸습니다 (proposal ${id}). 아직 반영되지 않았습니다. 사용자가 작업실 채팅 패널에서 수락하면 반영됩니다. 같은 제안을 반복하지 마세요.`;

/**
 * Accept runs the tool the agent asked for with the stored input; reject only records the decision.
 * The decision is claimed first with one conditional UPDATE (pending → running, or pending → rejected), so
 * of two requests for the same proposal (two windows, a resent click, accept against reject) only one runs
 * the tool; the other gets the row as it stands (running, or already decided) instead of running it again.
 */
export async function decideProposal(db: Db, id: string, accept: boolean) {
  const proposal = db.select().from(s.proposals).where(eq(s.proposals.id, id)).get();
  if (!proposal) throw new Error('제안을 찾을 수 없습니다.');
  const claimed = db
    .update(s.proposals)
    .set(accept ? { status: 'running' } : { status: 'rejected', decidedAt: new Date() })
    .where(and(eq(s.proposals.id, id), eq(s.proposals.status, 'pending')))
    .returning()
    .get();
  if (!claimed) return db.select().from(s.proposals).where(eq(s.proposals.id, id)).get()!;
  events.changed(proposal.projectId, 'proposals');
  if (!accept) return claimed;
  let status: 'accepted' | 'failed' = 'accepted';
  let result: unknown = null;
  const tool = agentCatalog(db, proposal.projectId).find((candidate) => candidate.name === proposal.tool && candidate.changes);
  try {
    if (!tool) throw new Error(`알 수 없는 도구입니다: ${proposal.tool}`);
    result = await tool.run(proposal.input);
    if (result && typeof result === 'object' && (result as { ok?: boolean }).ok === false) status = 'failed';
  } catch (error) {
    status = 'failed';
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const row = db.update(s.proposals).set({ status, result, decidedAt: new Date() }).where(eq(s.proposals.id, id)).returning().get();
  events.changed(proposal.projectId, 'proposals');
  return row;
}

export const INTERRUPTED_PROPOSAL = '적용하는 중에 서버가 꺼져 결과를 알 수 없습니다. 일부만 반영됐을 수 있으니 내용을 확인하고, 필요하면 다시 제안하세요.';

/**
 * Proposals a stopped server was still applying. They are closed as failed, not run again: the tool may
 * have changed part of the project before the stop, and running it twice is what the claim above prevents.
 * The message tells the person (and the agent, through decisionsSince) to check what landed.
 */
export function closeInterruptedProposals(db: Db) {
  const rows = db
    .update(s.proposals)
    .set({ status: 'failed', result: { ok: false, error: INTERRUPTED_PROPOSAL }, decidedAt: new Date() })
    .where(eq(s.proposals.status, 'running'))
    .returning()
    .all();
  for (const projectId of new Set(rows.map((row) => row.projectId))) events.changed(projectId, 'proposals');
  return rows.length;
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
