import { and, eq, inArray, isNull } from 'drizzle-orm';
import { itemCount, PERMISSION_MODE_INFO, toolClass, toolRoute, toolSpec, type PermissionMode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog, prepareProposal } from './agent-catalog.ts';
import { checkAgentPermission, projectAgentSettings } from './agent-permission-check.ts';
import { reportText, type BatchCheck } from './proposal-check.ts';
import { dropConflicts, isRecord, orderedCalls, rebaseLineCall, rememberLineRevisions } from './proposal-undo.ts';
import { decideProposal, propose, proposedText } from './proposals.ts';
import { fitText } from './tool-output.ts';

/**
 * The one way an agent's change reaches the project (#45), from every surface (the app's API chat, CLI
 * chats, the `loca` CLI): check it (its tool's check), store it as a proposal, then let the permission
 * mode decide (the conversation's, or the project's terminal mode): ask → the person decides on the
 * card (#43 tells the agent); auto → applied now when the review below passes, otherwise asked; bypass
 * → applied now. Applied changes are proposals too (decided_by auto/bypass), so the change log is one
 * and the agent hears the result in the same turn. Undoing an accepted change is a path of the same
 * gate (undoChanges).
 */

/** A batch larger than this is never applied without asking in auto review. */
export const AUTO_MAX_ITEMS = 20;

/**
 * Auto review: what may apply without asking. Running a workflow (AI cost) and deleting always ask;
 * so do large batches and anything the check warned about or partly dropped. What kind of change it
 * is and how many items it touches come from the tool's spec for this input.
 */
export function autoReview(tool: string, input: Record<string, unknown>, report: s.ProposalReport | null): { pass: boolean; reason: string } {
  const kind = toolClass(tool, input);
  if (kind === 'run') return { pass: false, reason: '실행은 AI 비용이 들어 묻습니다.' };
  if (kind === 'delete') return { pass: false, reason: '삭제·병합은 묻습니다.' };
  const count = itemCount(tool, input);
  if (count > AUTO_MAX_ITEMS) return { pass: false, reason: `${count.toLocaleString()}개를 한꺼번에 바꾸는 큰 변경이라 묻습니다(자동은 ${AUTO_MAX_ITEMS}개까지).` };
  const warnings = report?.warnings.length ?? 0;
  const dropped = report?.dropped.length ?? 0;
  if (warnings) return { pass: false, reason: `검사 경고 ${warnings}건이 있어 묻습니다.` };
  if (dropped) return { pass: false, reason: `검사에서 ${dropped}개를 뺐기 때문에 묻습니다.` };
  return { pass: true, reason: count > 1 ? `검사 통과(${count}개)` : '검사 통과' };
}

export const permissionModeOf = (db: Db, sessionId: string | null): PermissionMode =>
  (sessionId && db.select({ mode: s.chatSessions.permissionMode }).from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get()?.mode) || 'ask';

export type GateResult =
  /** `empty`: nothing to change (not a mistake); `batch`: a line batch's full report, either way. */
  | { ok: false; error: string; hint?: string; empty?: true; batch?: BatchCheck }
  | { ok: true; proposalId: string; applied: boolean; status: s.ProposalStatus; result?: unknown; review?: string; text: string; report: s.ProposalReport | null; batch?: BatchCheck };

/** The terminal has no conversation: its changes follow the project's terminal permission mode. */
export const terminalPermissionMode = (db: Db, projectId: string): PermissionMode => projectAgentSettings(db, projectId).terminalPermissionMode;

export async function proposeChange(db: Db, request: { projectId: string; sessionId: string | null; model?: string | null; source: 'cli' | 'api'; tool: string; input: Record<string, unknown>; terminal?: boolean }): Promise<GateResult> {
  if (toolRoute(request.tool) !== 'gate') return { ok: false, error: `변경 도구가 아닙니다: ${request.tool}` };
  const denied = checkAgentPermission(db, request.projectId, request.tool, request.input);
  if (denied) return { ok: false, error: denied };
  const prepared = await prepareProposal(db, request.projectId, request.tool, request.input);
  if (!prepared.ok) return prepared;
  // Read now, not at turn start: switching to bypass while the agent works applies from its next change.
  const mode = request.terminal ? terminalPermissionMode(db, request.projectId) : permissionModeOf(db, request.sessionId);
  const review = mode === 'auto' ? autoReview(request.tool, prepared.input, prepared.report) : null;
  const proposal = propose(db, { projectId: request.projectId, sessionId: request.sessionId, model: request.model, source: request.source, tool: request.tool, input: prepared.input, report: prepared.report, review: review?.reason ?? null });
  if (mode === 'bypass' || review?.pass) {
    const row = await decideProposal(db, proposal.id, true, mode === 'bypass' ? 'bypass' : 'auto');
    // The agent gets the result in this tool call; it is not told again on the next turn.
    db.update(s.proposals).set({ reportedAt: new Date() }).where(eq(s.proposals.id, proposal.id)).run();
    const how = PERMISSION_MODE_INFO[mode].label;
    const done = toolSpec(request.tool)?.candidateOnly ? 'AI 제안으로 올렸습니다(현재 번역은 그대로, 사람이 적용·거절)' : '바로 반영했습니다';
    const text = row.status === 'accepted' ? `${how} 모드로 ${done} (proposal ${proposal.id}). 결과: ${fitText(row.result, 4_000)}` : `${how} 모드로 반영하려 했지만 실패했습니다 (proposal ${proposal.id}): ${fitText(row.result, 2_000)}`;
    return { ok: true, proposalId: proposal.id, applied: row.status === 'accepted', status: row.status, result: row.result, review: review?.reason, text: text + reportText(prepared.report), report: prepared.report, batch: prepared.batch };
  }
  const held = review ? `\n자동 검토가 사용자에게 넘겼습니다: ${review.reason}` : '';
  return { ok: true, proposalId: proposal.id, applied: false, status: 'pending', review: review?.reason, text: proposedText(proposal.id) + reportText(prepared.report) + held, report: prepared.report, batch: prepared.batch };
}

/**
 * Who decides an undo, for the whole inverse at once (half an undo is worse than none). A person who
 * presses 되돌리기 in the app asked for exactly this, so it is theirs and no mode asks again. The
 * terminal's follows the project's terminal mode like any other change: the agent's permissions hold,
 * 매번 묻기 leaves it to the person, 자동 검토 reviews every restoring call (a delete or a large batch
 * goes to the person), 바로 반영 applies it. Where the gate would ask, the person undoes it on the
 * proposal's card in the app, which is the app's way of asking about an undo.
 */
function undoVerdict(db: Db, projectId: string, terminal: boolean, calls: s.UndoCall[]): { by: 'person' | 'auto' | 'bypass' } | { held: string } {
  if (!terminal) return { by: 'person' };
  for (const call of calls) {
    const denied = checkAgentPermission(db, projectId, call.tool, call.input);
    if (denied) return { held: denied };
  }
  const mode = terminalPermissionMode(db, projectId);
  if (mode === 'ask') return { held: '터미널 권한 모드가 매번 묻기라 앱에서 되돌립니다' };
  if (mode === 'bypass') return { by: 'bypass' };
  const stopped = calls.map((call) => autoReview(call.tool, call.input, null)).find((review) => !review.pass);
  return stopped ? { held: `자동 검토가 넘겼습니다(${stopped.reason}) 앱에서 되돌리세요` } : { by: 'auto' };
}

/**
 * Undoes accepted changes of a conversation (owner: its id) or of the terminal (`{ terminal: projectId }`),
 * newest first. Each restoring call (the tool's `undo`) is stored and applied as a proposal like any
 * change, recorded as decided by who decided it (undoVerdict); a line or item changed since is skipped.
 * Asked from the terminal, only what its permission mode applied is undone: a change a person accepted
 * is undone by a person, in the app (`by: 'person'`, the app's 되돌리기 on a terminal proposal).
 */
export async function undoChanges(db: Db, owner: string | { terminal: string; by?: 'person' }, ids: string[]) {
  const sessionId = typeof owner === 'string' ? owner : null;
  const terminal = typeof owner !== 'string' && owner.by !== 'person';
  const ownedBy = typeof owner === 'string' ? eq(s.proposals.sessionId, owner) : and(isNull(s.proposals.sessionId), eq(s.proposals.projectId, owner.terminal), eq(s.proposals.source, 'cli'));
  const rows = db.select().from(s.proposals)
    .where(and(ownedBy, inArray(s.proposals.id, ids))).all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const results: { id: string; ok: boolean; error?: string; skipped?: string[] }[] = [];
  const rebasedLines = new Map<string, { before: number; now: number }>();
  for (const original of rows) {
    if (terminal && original.decidedBy === 'person') {
      results.push({ id: original.id, ok: false, error: '사람이 수락한 제안이라 앱에서 되돌립니다' });
      continue;
    }
    if (original.status !== 'accepted' || original.undoneAt) {
      const error = original.undoneAt ? '이미 되돌렸습니다' : '수락된 제안이 아닙니다';
      results.push({ id: original.id, ok: false, error });
      continue;
    }
    if (!original.undo || 'none' in original.undo) {
      results.push({ id: original.id, ok: false,
        error: original.undo && 'none' in original.undo ? original.undo.none : '되돌리기 정보를 찾을 수 없습니다' });
      continue;
    }
    const calls = orderedCalls(original.undo.calls);
    const verdict = undoVerdict(db, original.projectId, terminal, calls);
    if ('held' in verdict) {
      results.push({ id: original.id, ok: false, error: verdict.held });
      continue;
    }
    // Each tool's own way to leave out what a person changed since (its `undo.trim`).
    const trims = new Map(agentCatalog(db, original.projectId, undefined, { unrestricted: true }).map((tool) => [tool.name as string, tool.undo?.trim]));
    const skipped: string[] = [];
    let failedTool: string | null = null;
    let completedCalls = 0;
    try {
      for (const inverseCall of calls) {
        const rebased = rebaseLineCall(inverseCall, rebasedLines);
        const filtered = dropConflicts(db, original.projectId, rebased, trims.get(rebased.tool));
        skipped.push(...filtered.dropped);
        if (!filtered.call) continue;
        failedTool = filtered.call.tool;
        const inverse = propose(db, {
          projectId: original.projectId, sessionId, source: original.source,
          tool: filtered.call.tool, input: filtered.call.input,
          review: `되돌리기 (proposal ${original.id})`,
        });
        // A person's own undo is not bound by what the agent may do (the inverse of a creation is a delete).
        const applied = await decideProposal(db, inverse.id, true, verdict.by, null, { unrestricted: !terminal });
        db.update(s.proposals).set({ reportedAt: new Date() }).where(eq(s.proposals.id, inverse.id)).run();
        if (applied.status !== 'accepted') {
          const value = isRecord(applied.result) && typeof applied.result.error === 'string'
            ? applied.result.error : '도구 실행에 실패했습니다';
          throw new Error(value);
        }
        if (isRecord(applied.result) && Array.isArray(applied.result.skipped)) {
          for (const item of applied.result.skipped) {
            if (isRecord(item) && typeof item.key === 'string') skipped.push(item.key);
            else if (isRecord(item) && typeof item.id === 'string') skipped.push(item.id);
          }
        }
        rememberLineRevisions(db, original, filtered.call, applied.result, rebasedLines);
        completedCalls++;
      }
      db.update(s.proposals).set({ undoneAt: new Date(), reportedAt: null })
        .where(eq(s.proposals.id, original.id)).run();
      results.push({ id: original.id, ok: true, ...(skipped.length && { skipped }) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const partial = completedCalls ? '일부만 되돌렸습니다: ' : '';
      results.push({ id: original.id, ok: false,
        error: `${partial}${failedTool ?? '되돌리기'} 실패 — ${detail}` });
    }
  }
  for (const id of ids) {
    if (!rows.some((row) => row.id === id)) results.push({ id, ok: false, error: '제안을 찾을 수 없습니다' });
  }
  return results;
}
