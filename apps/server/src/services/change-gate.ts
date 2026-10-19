import { checkAgentPermission } from './agent-permission-check.ts';
import { tool, type ToolSet } from 'ai';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AGENT_TOOLS, agentSettingsSchema, CANDIDATE_ONLY_TOOLS, PERMISSION_MODE_INFO, type PermissionMode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { prepareProposal, reportText } from './proposal-check.ts';
import { decideProposal, propose, proposedText } from './proposals.ts';
import { fitText } from './tool-output.ts';
import { agentTools } from './agent-tools.ts';

/**
 * The one way an agent's change reaches the project (#45), for every chat backend (API, pi, CLI):
 * check it (prepareProposal), store it as a proposal, then let the conversation's permission mode
 * decide: ask → the person decides on the card (#43 tells the agent); auto → applied now when the
 * review below passes, otherwise asked; bypass → applied now. Applied changes are proposals too
 * (decided_by auto/bypass), so the change log is one and the agent hears the result in the same turn.
 */

/** How change tools are described to every backend. */
export const CHANGE_NOTE = '대화의 권한 모드에 따라 바로 반영되거나, 사용자가 카드에서 결정할 때까지 제안으로 기다립니다. 어느 쪽인지는 도구 결과에 나옵니다';

/** A batch larger than this is never applied without asking in auto review. */
export const AUTO_MAX_ITEMS = 20;

/** How many things a change touches, for the review. */
const KNOWLEDGE_KEYS = ['characters', 'relationships', 'speechRules', 'events', 'documents'];
export function itemCount(input: Record<string, unknown>) {
  const knowledge = KNOWLEDGE_KEYS.reduce((sum, key) => sum + (Array.isArray(input[key]) ? (input[key] as unknown[]).length : 0), 0);
  if (knowledge) return knowledge;
  for (const key of ['changes', 'terms', 'ids', 'items']) {
    const value = input[key];
    if (Array.isArray(value)) return value.length;
  }
  return 1;
}

/**
 * Auto review: what may apply without asking. Running a workflow (AI cost) and deleting always ask;
 * so do large batches and anything the check warned about or partly dropped.
 */
export function autoReview(tool: string, input: Record<string, unknown>, report: s.ProposalReport | null): { pass: boolean; reason: string } {
  const action = AGENT_TOOLS[tool]?.action;
  if (action === 'run') return { pass: false, reason: '실행은 AI 비용이 들어 묻습니다.' };
  if (action === 'delete') return { pass: false, reason: '삭제·병합은 묻습니다.' };
  const count = itemCount(input);
  if (count > AUTO_MAX_ITEMS) return { pass: false, reason: `${count.toLocaleString()}개를 한꺼번에 바꾸는 큰 변경이라 묻습니다(자동은 ${AUTO_MAX_ITEMS}개까지).` };
  const warnings = report?.warnings.length ?? 0;
  const dropped = report?.dropped.length ?? 0;
  if (warnings) return { pass: false, reason: `검사 경고 ${warnings}건이 있어 묻습니다.` };
  if (dropped) return { pass: false, reason: `검사에서 ${dropped}개를 뺐기 때문에 묻습니다.` };
  return { pass: true, reason: count > 1 ? `검사 통과(${count}개)` : '검사 통과' };
}

export const permissionModeOf = (db: Db, sessionId: string | null): PermissionMode =>
  (sessionId && db.select({ mode: s.chatSessions.permissionMode }).from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get()?.mode) || 'ask';

/** What bypass has done in a conversation: changes it applied (or tried), and the cost its connections reported (chat calls and the runs it started). */
export function bypassUsage(db: Db, sessionId: string): { changes: number; costUsd: number } {
  // Running ones count too: concurrent tool calls claim their row before the next one checks (#99 review).
  const proposals = db.select({ tool: s.proposals.tool, input: s.proposals.input, result: s.proposals.result, status: s.proposals.status }).from(s.proposals)
    .where(and(eq(s.proposals.sessionId, sessionId), eq(s.proposals.decidedBy, 'bypass'), inArray(s.proposals.status, ['accepted', 'failed', 'running']))).all();
  const runIds = proposals.filter((proposal) => proposal.tool === 'start_run' && proposal.status === 'accepted')
    .map((proposal) => (proposal.result as { runId?: string } | null)?.runId).filter((id): id is string => !!id);
  const chatCost = db.select({ cost: sql<number>`coalesce(sum(${s.aiCalls.costUsd}), 0)` }).from(s.aiCalls)
    .where(eq(s.aiCalls.refId, sessionId)).get()?.cost ?? 0;
  const runCost = runIds.length ? db.select({ cost: sql<number>`coalesce(sum(${s.runSteps.costUsd}), 0)` }).from(s.runSteps)
    .where(inArray(s.runSteps.runId, runIds)).get()?.cost ?? 0 : 0;
  // A batch counts its items, not one (#99 review).
  return { changes: proposals.reduce((sum, proposal) => sum + itemCount(proposal.input), 0), costUsd: chatCost + runCost };
}

/** `incoming` is the size of the change being decided: one that would go past the limit asks too. */
export function bypassCapReason(limits: { changes: number; costUsd: number | null }, usage: { changes: number; costUsd: number }, incoming = 1): string | null {
  if (usage.changes + incoming > limits.changes) return `자동 반영 한도에 닿아 묻습니다: 이 대화에서 바로 반영한 변경 ${usage.changes}개${incoming > 1 ? ` + 이번 ${incoming}개` : ''} (한도 ${limits.changes}개)`;
  if (limits.costUsd !== null && usage.costUsd >= limits.costUsd) return `자동 반영 한도에 닿아 묻습니다: 측정된 비용 $${usage.costUsd.toFixed(2)} (한도 $${limits.costUsd})`;
  return null;
}

/** Why bypass asks this conversation's next change instead of applying it; null while under the project's limits. */
function bypassCap(db: Db, projectId: string, sessionId: string, input: Record<string, unknown>) {
  const settings = db.select({ settings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.settings;
  // Rows saved before the limits existed get the defaults.
  return bypassCapReason(agentSettingsSchema.parse(settings ?? {}).bypassLimits, bypassUsage(db, sessionId), itemCount(input));
}

export type GateResult =
  | { ok: false; error: string; hint?: string }
  | { ok: true; proposalId: string; applied: boolean; status: s.ProposalStatus; result?: unknown; review?: string; text: string; report: s.ProposalReport | null };

export async function proposeChange(db: Db, request: { projectId: string; sessionId: string | null; model?: string | null; source: 'pi' | 'cli' | 'api'; tool: string; input: Record<string, unknown> }): Promise<GateResult> {
  const denied = checkAgentPermission(db, request.projectId, request.tool, request.input);
  if (denied) return { ok: false, error: denied };
  const prepared = await prepareProposal(db, request.projectId, request.tool, request.input);
  if (!prepared.ok) return prepared;
  // Read now, not at turn start: switching to bypass while the agent works applies from its next change.
  const mode = permissionModeOf(db, request.sessionId);
  const review = mode === 'auto' ? autoReview(request.tool, prepared.input, prepared.report) : null;
  const capReason = mode === 'bypass' && request.sessionId ? bypassCap(db, request.projectId, request.sessionId, prepared.input) : null;
  const heldReason = review?.reason ?? capReason;
  const proposal = propose(db, { projectId: request.projectId, sessionId: request.sessionId, model: request.model, source: request.source, tool: request.tool, input: prepared.input, report: prepared.report, review: heldReason });
  if ((mode === 'bypass' && !capReason) || review?.pass) {
    const row = await decideProposal(db, proposal.id, true, mode === 'bypass' ? 'bypass' : 'auto');
    // The agent gets the result in this tool call; it is not told again on the next turn.
    db.update(s.proposals).set({ reportedAt: new Date() }).where(eq(s.proposals.id, proposal.id)).run();
    events.changed(request.projectId, 'proposals');
    const how = PERMISSION_MODE_INFO[mode].label;
    const done = CANDIDATE_ONLY_TOOLS.has(request.tool) ? '바로 후보에 추가했습니다(현재 번역은 그대로)' : '바로 반영했습니다';
    const text = row.status === 'accepted' ? `${how} 모드로 ${done} (proposal ${proposal.id}). 결과: ${fitText(row.result, 4_000)}` : `${how} 모드로 반영하려 했지만 실패했습니다 (proposal ${proposal.id}): ${fitText(row.result, 2_000)}`;
    return { ok: true, proposalId: proposal.id, applied: row.status === 'accepted', status: row.status, result: row.result, review: review?.reason, text: text + reportText(prepared.report), report: prepared.report };
  }
  const held = heldReason ? `\n${capReason ? '자동 반영 한도로 사용자에게 넘겼습니다' : '자동 검토가 사용자에게 넘겼습니다'}: ${heldReason}` : '';
  return { ok: true, proposalId: proposal.id, applied: false, status: 'pending', review: heldReason ?? undefined, text: proposedText(proposal.id) + reportText(prepared.report) + held, report: prepared.report };
}

/**
 * The agent's tools for the API chat (AI SDK): change tools go through proposeChange like pi's and
 * the CLI's, instead of the SDK's own approval step, so the three backends decide changes the same
 * way. edit_workflow_node has no execute (the open editor applies it) and stays as it is.
 */
export function gatedTools(db: Db, projectId: string, sessionId: string, author: { model: string | null }): ToolSet {
  const raw = agentTools(db, projectId, author) as unknown as Record<string, { description?: string; inputSchema: z.ZodType; needsApproval?: unknown; execute?: unknown }>;
  return Object.fromEntries(
    Object.entries(raw).map(([name, original]) => {
      if (!original.execute || !original.needsApproval) return [name, original];
      const gated = tool({
        description: `${original.description ?? ''} (${CHANGE_NOTE})`,
        inputSchema: original.inputSchema as z.ZodType<Record<string, unknown>>,
        execute: async (input: Record<string, unknown>) => {
          const gate = await proposeChange(db, { projectId, sessionId, model: author.model, source: 'api', tool: name, input });
          if (!gate.ok) return { ok: false, error: `제안하지 못했습니다: ${gate.error}`, ...(gate.hint && { hint: gate.hint }) };
          return { proposalId: gate.proposalId, applied: gate.applied, status: gate.status, note: gate.text };
        },
      });
      return [name, gated];
    }),
  ) as ToolSet;
}
