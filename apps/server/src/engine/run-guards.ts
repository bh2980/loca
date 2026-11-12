import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { estimateTokens, type ModelErrorCode, type RunCaps, type RunLimits } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events, type Topic } from '../events.ts';
import { recordRunEnd } from '../services/chat-run-end.ts';
import { overheadOf } from '../services/preflight.ts';
import { subjectOf } from './subjects.ts';

/*
 * What stops a run before more is spent: a failure the next request would meet too, too many failed
 * requests in a row, and the caps a person set. Every stop is a pause with a notice a person can read.
 */

/**
 * Failures that will not go away by trying the next batch: the run pauses at the first one. A rate
 * limit is not among them: it leaves through the node's "error" exit like any failure (a retry rule
 * can wait and send it again), and an exhausted subscription fails every call at once, which the
 * consecutive-failure guard catches within a few calls.
 */
const STOPPING_CODES: Partial<Record<ModelErrorCode, string>> = { auth: '인증 오류', config: '연결 설정 오류' };

/** Run progress always changes lines (or terms); nodes that write terms or story data add their topic. */
export function notifyRun(db: Db, runId: string, ...topics: Topic[]) {
  const run = db.select({ projectId: s.runs.projectId, subject: s.runs.subject }).from(s.runs).where(eq(s.runs.id, runId)).get();
  events.changed(run?.projectId, 'runs', ...(run ? [subjectOf(run.subject).topic] : []), ...topics);
}

/** Pauses a run on the runner's own decision, saying why. Calls already sent finish and are recorded. */
export function haltRun(db: Db, runId: string, notice: string, cap?: 'calls' | 'input') {
  const run = db.select({ limits: s.runs.limits }).from(s.runs).where(eq(s.runs.id, runId)).get();
  // A cap that stopped the run is remembered in its limits, so the run page can offer to raise it.
  const limits = cap && run?.limits ? { ...run.limits, hit: cap } : undefined;
  const paused = db.update(s.runs).set({ status: 'paused', notice, ...(limits ? { limits } : {}) }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'running'))).run();
  if (paused.changes) recordRunEnd(db, runId);
  notifyRun(db, runId);
}

/** A run's caps with `caps` replacing them (null clears one; a cap not named stays), without the mark of the cap that stopped it. */
export function withCaps(current: RunLimits | null, caps: RunCaps | undefined): RunLimits | null {
  let next = current;
  if (caps) {
    const merged: RunLimits = { ...current };
    for (const key of ['maxCalls', 'maxInputTokens'] as const) {
      if (caps[key] === null) delete merged[key];
      else if (caps[key] !== undefined) merged[key] = caps[key];
    }
    next = merged.maxCalls || merged.maxInputTokens ? merged : null;
  } else if (next) next = { ...next };
  if (next) delete next.hit;
  return next;
}

/** The guards of the runs one runner works on. What it keeps in memory is only about requests in flight: nothing is in flight after a restart. */
export class RunGuards {
  /** Input tokens of calls sent and not yet recorded, by run (estimated), for the pre-call cap check. */
  private inFlight = new Map<string, number>();
  /** Each connection's fixed overhead per request, measured once per run (`run|connection`). */
  private overheads = new Map<string, number>();

  constructor(private db: Db) {}

  /**
   * Checks the run's guards after a call: a failure that retrying cannot fix, too many failures
   * in a row, or a cap the person set. Any of them pauses the run before more is spent.
   */
  afterCall(runId: string, failure?: { code?: string; message: string }) {
    const run = this.db.select({ status: s.runs.status, definition: s.runs.definition, limits: s.runs.limits, continuations: s.runs.continuations }).from(s.runs).where(eq(s.runs.id, runId)).get();
    if (run?.status !== 'running') return;
    const stopping = failure?.code ? STOPPING_CODES[failure.code as ModelErrorCode] : undefined;
    if (stopping) return haltRun(this.db, runId, `${stopping}로 멈췄습니다: ${failure!.message}`);
    const max = run.definition.settings.maxConsecutiveFailures;
    // Insertion order, not finished_at: calls that end in the same millisecond must not swap places.
    // Failures before the person last continued the run (on another model, say) do not count again.
    const since = run.continuations.at(-1)?.at;
    // A failed request whose lines retry rules sent back is neither a failure nor a success here (run_steps.retried).
    const recent = this.db.select({ ok: s.runSteps.ok }).from(s.runSteps).where(and(eq(s.runSteps.runId, runId), since ? gte(s.runSteps.startedAt, new Date(since)) : undefined, eq(s.runSteps.retried, false))).orderBy(desc(sql`rowid`)).limit(max).all();
    if (recent.length === max && recent.every((step) => !step.ok))
      return haltRun(this.db, runId, `호출이 ${max}번 연달아 실패해서 멈췄습니다.${failure ? ` 마지막 오류: ${failure.message}` : ''}`);
    if (!run.limits?.maxCalls && !run.limits?.maxInputTokens) return;
    const used = this.db.select({ calls: sql<number>`count(*)`, input: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)` }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).get()!;
    if (run.limits.maxCalls && used.calls >= run.limits.maxCalls) return haltRun(this.db, runId, `호출 상한(${run.limits.maxCalls.toLocaleString()}회)에 도달해서 멈췄습니다.`, 'calls');
    if (run.limits.maxInputTokens && used.input >= run.limits.maxInputTokens)
      return haltRun(this.db, runId, `입력 토큰 상한(${run.limits.maxInputTokens.toLocaleString()})에 도달해서 멈췄습니다.`, 'input');
  }

  /**
   * Before a request goes out: its estimated input (the prompt plus what the connection adds to every
   * request, measured from past calls as the run dialog's estimate does) is counted against the run's input
   * cap together with the calls still in flight, so a run stops short of the cap instead of finding out
   * afterwards (several calls at once could overshoot by a lot). `over`: why sending would break the cap;
   * otherwise the estimate is held until `release` (the call answered or failed; its real tokens are then
   * recorded with the step).
   */
  reserve(runId: string, connectionId: string | null, prompt: string): { over: string } | { release: () => void } {
    const estimate = estimateTokens(prompt) + this.overheadFor(runId, connectionId);
    const cap = this.db.select({ limits: s.runs.limits }).from(s.runs).where(eq(s.runs.id, runId)).get()?.limits?.maxInputTokens;
    if (cap) {
      const used = this.db.select({ input: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)` }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).get()!.input;
      const pending = this.inFlight.get(runId) ?? 0;
      if (used + pending + estimate > cap)
        return { over: `입력 토큰 상한(${cap.toLocaleString()})을 넘지 않도록 멈췄습니다: 지금까지 ${used.toLocaleString()}${pending ? `, 진행 중 약 ${pending.toLocaleString()}` : ''}, 다음 요청 약 ${estimate.toLocaleString()}.` };
    }
    this.inFlight.set(runId, (this.inFlight.get(runId) ?? 0) + estimate);
    let held = true;
    return {
      release: () => {
        if (!held) return;
        held = false;
        const left = (this.inFlight.get(runId) ?? 0) - estimate;
        if (left > 0) this.inFlight.set(runId, left);
        else this.inFlight.delete(runId);
      },
    };
  }

  private overheadFor(runId: string, connectionId: string | null) {
    if (!connectionId) return 0;
    const key = `${runId}|${connectionId}`;
    if (!this.overheads.has(key)) this.overheads.set(key, overheadOf(this.db, connectionId) ?? 0);
    return this.overheads.get(key)!;
  }

  /** Drops what was kept for a run that is no longer going (measured again if it is continued). */
  forget(runId: string) {
    for (const key of [...this.overheads.keys()]) if (key.startsWith(`${runId}|`)) this.overheads.delete(key);
  }
}
