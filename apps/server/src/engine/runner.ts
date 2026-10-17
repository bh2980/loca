import { and, asc, desc, eq, gte, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import jsonLogic from 'json-logic-js';
import * as ai from '@tw/ai';
import { analysisSectionsOf, estimateTokens, isAnalysisWorkflow, type IssueKind, batchConfigSchema, FUNCTIONS, choiceKey, isUnknownListener, lineMarksOf, nodeModels, nodeName, type AiNode, type ConditionData, type FunctionName, type FunctionNode, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import { inChunks, inList } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData, ItemState } from '../db/schema.ts';
import { events, type Topic } from '../events.ts';
import { buildContext } from '../services/context.ts';
import { resolveRoutes } from '../services/routes.ts';
import { markConditions } from '../services/line-marks.ts';
import type { SecretStore } from '../services/secrets.ts';
import { runAsyncFunction, syncFunctions, HUMAN_OWNED_NOTE, type FunctionInput, type FunctionResult } from './functions/index.ts';
import { applyRunCandidate } from './apply-candidate.ts';
import { packGroups, planBatches } from './batches.ts';
import { buildPrompt, outputSchema, PER_LINE_OUTPUTS, type KnowledgeOutput, type PromptLine } from './prompts.ts';
import { applyIssueTags } from '../services/issue-tags.ts';
import { logged } from '../services/ai-calls.ts';
import { analysisRequest, analysisToKeys, MIN_ANALYSIS_TIMEOUT_MS, outputCutOff, type Analysis } from '../services/analysis.ts';
import { overheadOf } from '../services/preflight.ts';

export interface ModelPort {
  generate: typeof ai.generate;
  judge: typeof ai.judge;
}

type Run = typeof s.runs.$inferSelect;
type Item = typeof s.runItems.$inferSelect;
type Unit = typeof s.units.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type StepRecord = Omit<typeof s.runSteps.$inferInsert, 'ok' | 'finishedAt'>;
/** A queued line waiting at a slow node, with its script position for batching. */
type Waiting = { id: string; unitId: string; nodeId: string; groupId: string; seq: number; kind: string; tokens: number; since: Date; plan: number | null };

/** Functions that write beyond the line itself, and the change topic they touch. */
const FUNCTION_TOPICS: Record<string, Topic[]> = { addTerms: ['terms'], applyKnowledge: ['knowledge'], saveAnalysis: ['knowledge', 'terms', 'analysis'] };
/** A partial batch waits this long for more lines from upstream before it is sent anyway. */
const GATHER_MS = 5_000;
/** Lines passed through instant nodes per tick; the rest wait for the next tick, so a tick never blocks for long. */
const SETTLE_PER_TICK = 2_000;
/**
 * Failures that will not go away by trying the next batch: the run pauses at the first one. A rate
 * limit is not among them: an API's limit passes with time, and an exhausted subscription fails
 * every call at once, which the consecutive-failure guard catches within a few calls.
 */
const STOPPING_CODES: Record<string, string> = { auth: '인증 오류', config: '연결 설정 오류' };

/** Usage of a call: every attempt that reported some, failed retries included. */
function stepUsage(attempts: ai.Attempt[], fallback: ai.Usage = {}): ai.Usage {
  const reported = attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : []));
  return reported.length ? reported.reduce(ai.addUsage, {}) : fallback;
}
const usageColumns = (usage: ai.Usage) => ({
  inputTokens: usage.inputTokens,
  cachedInputTokens: usage.cachedInputTokens,
  outputTokens: usage.outputTokens,
  reasoningTokens: usage.reasoningTokens,
  costUsd: usage.costUsd,
});
/**
 * How many times a line goes back to its node's queue after a call left it out or failed
 * transiently. It then rides in a later batch with other lines: on an agent CLI every request
 * carries a large fixed overhead, so asking again for one or two lines alone would cost far more.
 */
const MAX_REREQUESTS = 2;
/** Failures worth trying again later; anything else ends the lines through `error`. */
const TRANSIENT = new Set(['rate-limit', 'network', 'timeout']);
/** How many times a malformed answer for several lines is retried as halves. */
const MAX_SPLITS = 2;
/** A script read in halves at scene boundaries: up to 2⁶ parts of the request the model refused. */
const MAX_ANALYSIS_SPLITS = 6;

/** Where to cut a request between scenes, nearest its middle (the middle itself when it is one scene). */
export function sceneHalf(groupIds: string[]) {
  const middle = Math.ceil(groupIds.length / 2);
  let best = -1;
  for (let index = 1; index < groupIds.length; index++)
    if (groupIds[index] !== groupIds[index - 1] && (best < 0 || Math.abs(index - middle) < Math.abs(best - middle))) best = index;
  return best > 0 ? best : middle;
}
const MISSING_WHAT: Record<AiNode['config']['output'], string> = { candidate: '번역', verdict: '판정', listener: '청자', json: '결과', terms: '용어', knowledge: '자료', analysis: '분석' };
const attemptsOf = (error: unknown): ai.Attempt[] => ((error as { attempts?: ai.Attempt[] }).attempts ?? []);

/** A node's result for one line: the exit to take plus what it produced. */
interface Outcome extends FunctionResult {
  /** Candidate provenance when `candidate` is set. */
  origin?: 'ai' | 'tool';
  model?: string;
  error?: string;
}

/** AI calls and slow functions leave the instant pass; everything else settles immediately. */
const isAsync = (node: WorkflowNode) =>
  node.type === 'ai' || (node.type === 'function' && Boolean(FUNCTIONS[node.config.fn as FunctionName]?.async));

/**
 * Executes user workflows. One run item = one source line. Items flow node to node through the exits
 * stored in the run's frozen definition. Every node returns an Outcome; the runner records the
 * candidate/output/issues on the line and routes it. State lives in the database, so a restart
 * resumes from queued items.
 */
export class Runner {
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private inflight = new Map<string, Set<Promise<void>>>();
  private aborts = new Map<string, AbortController>();

  constructor(
    private db: Db,
    private secrets: SecretStore,
    private model: ModelPort = { generate: ai.generate, judge: ai.judge },
  ) {}

  start(intervalMs = 300) {
    // Calls cut off by a restart are retried from the node they were waiting at.
    this.db.update(s.runItems).set({ state: 'queued' }).where(eq(s.runItems.state, 'running')).run();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async stop() {
    clearInterval(this.timer);
    for (const controller of this.aborts.values()) controller.abort();
    await Promise.allSettled([...this.inflight.values()].flatMap((set) => [...set]));
  }

  /** Runs every runnable step until nothing changes. Tests call this directly. */
  async drain(maxRounds = 1000) {
    for (let round = 0; round < maxRounds; round++) {
      const active = await this.tick();
      const pending = [...this.inflight.values()].flatMap((set) => [...set]);
      if (!active && !pending.length) return;
      await Promise.allSettled(pending);
    }
  }

  async tick(): Promise<boolean> {
    if (this.ticking) return true;
    this.ticking = true;
    try {
      let active = false;
      for (const run of this.db.select().from(s.runs).where(eq(s.runs.status, 'running')).all()) {
        // One run's failure (a database error, a bad definition) pauses that run; the others go on.
        try {
          active = this.advance(run) || active;
        } catch (error) {
          console.error(`[runner] run ${run.id}:`, error);
          this.halt(run.id, `실행기 오류로 멈췄습니다: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return active;
    } finally {
      this.ticking = false;
    }
  }

  pause(runId: string) {
    this.db.update(s.runs).set({ status: 'paused' }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'running'))).run();
    this.notify(runId);
  }

  resume(runId: string) {
    // A run still being filled (createRunInSteps) starts by itself once all its lines are in.
    this.db.update(s.runs).set({ status: 'running', notice: null }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'paused'), or(isNull(s.runs.notice), ne(s.runs.notice, FILLING)))).run();
    this.notify(runId);
  }

  /**
   * Continues a paused or finished run (#41), optionally on other models and with its failed lines
   * re-queued at the step they failed in. The new definition and model snapshots are the run's own;
   * the workflow is not changed. Calls already made keep the connection they went out through (run_steps).
   */
  continue(runId: string, next: { definition: WorkflowDefinition; models: Record<string, s.AiSnapshot>; changes: s.RunContinuation['changes']; retryFailed: boolean }) {
    const result = this.db.transaction((tx) => {
      const run = tx.select().from(s.runs).where(eq(s.runs.id, runId)).get();
      if (!run) return { ok: false as const, error: '없는 실행입니다.' };
      if (run.status === 'running') return { ok: false as const, error: '실행 중에는 바꿀 수 없습니다. 먼저 일시정지하세요.' };
      if (run.status === 'cancelled') return { ok: false as const, error: '취소한 실행은 이어서 할 수 없습니다. 새로 실행하세요.' };
      if (run.notice === FILLING) return { ok: false as const, error: '아직 대사를 넣는 중입니다.' };
      let retried = 0;
      if (next.retryFailed) {
        const failed = tx.select().from(s.runItems).where(and(eq(s.runItems.runId, runId), eq(s.runItems.state, 'failed'))).all();
        for (const item of failed) {
          const { [item.nodeId]: _, ...retries } = item.data.retries ?? {};
          tx.update(s.runItems).set({ state: 'queued', error: null, data: { ...item.data, retries } }).where(eq(s.runItems.id, item.id)).run();
        }
        retried = failed.length;
      }
      const open = tx.select({ id: s.runItems.id }).from(s.runItems).where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, ['queued', 'running']))).limit(1).all();
      if (!open.length) return { ok: false as const, error: '이어서 처리할 대사가 없습니다.' };
      const continuation: s.RunContinuation = { at: Date.now(), changes: next.changes, retried };
      tx.update(s.runs)
        .set({ definition: next.definition, models: next.models, status: 'running', notice: null, finishedAt: null, continuations: [...run.continuations, continuation] })
        .where(eq(s.runs.id, runId))
        .run();
      return { ok: true as const, retried };
    });
    if (result.ok) this.notify(runId);
    return result;
  }

  cancel(runId: string) {
    this.aborts.get(runId)?.abort();
    this.db.transaction((tx) => {
      tx.update(s.runs).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(s.runs.id, runId)).run();
      tx.update(s.runItems)
        .set({ state: 'cancelled' })
        .where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, ['queued', 'running'])))
        .run();
    });
    this.notify(runId);
  }

  /** Pauses a run on the runner's own decision, saying why. Calls already sent finish and are recorded. */
  private halt(runId: string, notice: string) {
    this.db.update(s.runs).set({ status: 'paused', notice }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'running'))).run();
    this.notify(runId);
  }

  /**
   * Checks the run's guards after a call: a failure that retrying cannot fix, too many failures
   * in a row, or a cap the person set. Any of them pauses the run before more is spent.
   */
  private guard(runId: string, failure?: { code?: string; message: string }) {
    const run = this.db.select({ status: s.runs.status, definition: s.runs.definition, limits: s.runs.limits, continuations: s.runs.continuations }).from(s.runs).where(eq(s.runs.id, runId)).get();
    if (run?.status !== 'running') return;
    const stopping = failure?.code ? STOPPING_CODES[failure.code] : undefined;
    if (stopping) return this.halt(runId, `${stopping}로 멈췄습니다: ${failure!.message}`);
    const max = run.definition.settings.maxConsecutiveFailures ?? 3;
    // Insertion order, not finished_at: calls that end in the same millisecond must not swap places.
    // Failures before the person last continued the run (on another model, say) do not count again.
    const since = run.continuations.at(-1)?.at;
    const recent = this.db.select({ ok: s.runSteps.ok }).from(s.runSteps).where(and(eq(s.runSteps.runId, runId), since ? gte(s.runSteps.startedAt, new Date(since)) : undefined)).orderBy(desc(sql`rowid`)).limit(max).all();
    if (recent.length === max && recent.every((step) => !step.ok))
      return this.halt(runId, `호출이 ${max}번 연달아 실패해서 멈췄습니다.${failure ? ` 마지막 오류: ${failure.message}` : ''}`);
    if (!run.limits?.maxCalls && !run.limits?.maxInputTokens) return;
    const used = this.db.select({ calls: sql<number>`count(*)`, input: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)` }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).get()!;
    if (run.limits.maxCalls && used.calls >= run.limits.maxCalls) return this.halt(runId, `호출 상한(${run.limits.maxCalls.toLocaleString()}회)에 도달해서 멈췄습니다.`);
    if (run.limits.maxInputTokens && used.input >= run.limits.maxInputTokens)
      return this.halt(runId, `입력 토큰 상한(${run.limits.maxInputTokens.toLocaleString()})에 도달해서 멈췄습니다.`);
  }

  /** Run progress always changes lines; nodes that write terms or story data add their topic. */
  private notify(runId: string, ...topics: Topic[]) {
    const run = this.db.select({ projectId: s.runs.projectId }).from(s.runs).where(eq(s.runs.id, runId)).get();
    events.changed(run?.projectId, 'runs', 'units', ...topics);
  }

  private node(run: Run, nodeId: string): WorkflowNode | undefined {
    return run.definition.nodes.find((node) => node.id === nodeId);
  }

  /** Store what a node produced for a line, then move the line out through the chosen exit. */
  private record(tx: Tx, run: Run, item: Item, outcome: Outcome, origin: 'ai' | 'tool' | 'human' = outcome.origin ?? 'tool') {
    const data: ItemData = { ...item.data, outputs: { ...item.data.outputs } };
    if (outcome.output) data.outputs![item.nodeId] = outcome.output;
    if (outcome.candidate !== undefined) {
      const candidateId = crypto.randomUUID();
      tx.insert(s.candidates)
        .values({ id: candidateId, unitId: item.unitId, text: outcome.candidate, origin, model: outcome.model, runId: run.id, nodeId: item.nodeId })
        .run();
      data.candidateId = candidateId;
      data.candidateText = outcome.candidate;
      data.issues = []; // a new candidate answers the previous issues
      // The produced text goes straight into the line (docs/DESIGN.md 3.5, #42). A person's saved
      // translation in a status-filtered run is kept and the run's text stays a candidate with a note.
      if (!applyRunCandidate(tx, run, item.unitId, candidateId, outcome.candidate).applied) {
        const notes = data.notes ?? [];
        if (!notes.includes(HUMAN_OWNED_NOTE)) data.notes = [...notes, HUMAN_OWNED_NOTE];
      }
    }
    if (outcome.issues?.length) data.issues = outcome.issues;
    if (outcome.issueTags) applyIssueTags(tx, run.projectId, item.unitId, outcome.issueTags);
    this.route(tx, run, { ...item, data }, outcome.port, outcome.error);
  }

  /**
   * Moves an item out through `port`. An exit with no edge ends the item (failed for `error`). An
   * exit with several edges sends the line down each of them: the item takes the first, and a copy
   * of it each of the others (validation keeps those branches apart until they end).
   */
  private route(tx: Tx, run: Run, item: Item, port: string, error?: string) {
    const definition: WorkflowDefinition = run.definition;
    const edges = definition.edges.filter((candidate) => candidate.source === item.nodeId && candidate.sourceHandle === port);
    const path = [...item.data.path, { nodeId: item.nodeId, port, at: Date.now() }].slice(-200);
    const moved = (target: string | undefined) => {
      let state: ItemState = 'queued';
      let nodeId = item.nodeId;
      let message = error ?? null;
      const visits = { ...item.visits };
      if (!target) {
        state = port === 'error' ? 'failed' : 'done';
      } else {
        nodeId = target;
        visits[nodeId] = (visits[nodeId] ?? 0) + 1;
        if (visits[nodeId] > definition.settings.maxVisitsPerNode) {
          const node = this.node(run, nodeId);
          state = 'failed';
          message = `'${node ? nodeName(node) : nodeId}' 노드 방문 상한(${definition.settings.maxVisitsPerNode}회)을 넘었습니다.`;
        }
      }
      return { nodeId, state, visits, data: { ...item.data, path }, error: message };
    };
    tx.update(s.runItems).set(moved(edges[0]?.target)).where(eq(s.runItems.id, item.id)).run();
    for (const edge of edges.slice(1)) tx.insert(s.runItems).values({ runId: run.id, unitId: item.unitId, plan: item.plan, ...moved(edge.target) }).run();
  }

  /** Lines still queued or running, per node. */
  private openByNode(runId: string) {
    const rows = this.db
      .select({ nodeId: s.runItems.nodeId, count: sql<number>`count(*)` })
      .from(s.runItems)
      .where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, ['queued', 'running'])))
      .groupBy(s.runItems.nodeId)
      .all();
    return new Map(rows.map((row) => [row.nodeId, row.count]));
  }

  /** Lines still queued or running, per plan batch and node ("plan|node"). */
  private openByPlanNode(runId: string) {
    const rows = this.db
      .select({ plan: s.runItems.plan, nodeId: s.runItems.nodeId, count: sql<number>`count(*)` })
      .from(s.runItems)
      .where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, ['queued', 'running'])))
      .groupBy(s.runItems.plan, s.runItems.nodeId)
      .all();
    return new Map(rows.map((row) => [`${row.plan}|${row.nodeId}`, row.count]));
  }

  /** Model calls in flight per account (connection id), across runs. */
  private callsByAccount = new Map<string, number>();
  /** HTTP / script function calls in flight per run. */
  private functionsByRun = new Map<string, number>();

  /** The account a model choice's calls count against: its picked route's connection. */
  private accountOf(run: Run, key: string) {
    return run.models[key]?.routes[0]?.connectionId ?? null;
  }

  private upstreams = new Map<string, Map<string, Set<string>>>();
  /** For each node, every node that can reach it through the run's frozen edges. */
  private upstream(run: Run) {
    const known = this.upstreams.get(run.id);
    if (known) return known;
    const into = Map.groupBy(run.definition.edges, (edge) => edge.target);
    const result = new Map<string, Set<string>>();
    for (const node of run.definition.nodes) {
      const seen = new Set<string>();
      const stack = [node.id];
      while (stack.length)
        for (const edge of into.get(stack.pop()!) ?? []) {
          if (seen.has(edge.source)) continue;
          seen.add(edge.source);
          stack.push(edge.source);
        }
      result.set(node.id, seen);
    }
    this.upstreams.set(run.id, result);
    return result;
  }

  /** Queued lines at instant nodes (anything not slow, unknown nodes included so they fail visibly). */
  /** Sends a line back to the queue of the node it is at, or out through `error` once it has been back too often. */
  private retryLater(tx: Tx, run: Run, item: Item, reason: string) {
    const count = (item.data.retries?.[item.nodeId] ?? 0) + 1;
    if (count > MAX_REREQUESTS) return this.route(tx, run, item, 'error', `${reason} (다시 시도 ${MAX_REREQUESTS}번 뒤)`);
    tx.update(s.runItems)
      .set({ state: 'queued', data: { ...item.data, retries: { ...item.data.retries, [item.nodeId]: count } }, error: reason })
      .where(eq(s.runItems.id, item.id))
      .run();
  }

  private queuedInstant(run: Run, slowIds: string[], limit: number) {
    const conditions = [eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued')];
    if (slowIds.length) conditions.push(notInArray(s.runItems.nodeId, slowIds));
    return this.db.select().from(s.runItems).where(and(...conditions)).limit(limit).all();
  }

  /** Queued lines at slow nodes, light rows in script order (scene order, then line order). */
  private waiting(run: Run, slowIds: string[]): Waiting[] {
    if (!slowIds.length) return [];
    return this.db
      .select({
        id: s.runItems.id,
        unitId: s.runItems.unitId,
        nodeId: s.runItems.nodeId,
        groupId: s.units.groupId,
        seq: s.units.seq,
        kind: s.units.kind,
        // estimateTokens without loading the text: UTF-8 bytes / 4.
        tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4`,
        since: s.runItems.updatedAt,
        plan: s.runItems.plan,
      })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.unitId))
      .where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued'), inArray(s.runItems.nodeId, slowIds)))
      .orderBy(asc(s.units.seq))
      .all();
  }

  private advance(run: Run): boolean {
    const slowIds = run.definition.nodes.filter(isAsync).map((node) => node.id);
    // Instant nodes settle first, possibly several hops, before slow work is handed out; a bounded
    // number per tick so a 50,000-line run never holds the event loop.
    let changed = false;
    let settled = 0;
    const touched = new Set<Topic>();
    while (settled < SETTLE_PER_TICK) {
      const instant = this.queuedInstant(run, slowIds, SETTLE_PER_TICK - settled);
      if (!instant.length) break;
      for (const topic of this.settle(run, instant)) touched.add(topic);
      settled += instant.length;
      changed = true;
    }
    if (settled >= SETTLE_PER_TICK) {
      this.notify(run.id, ...touched);
      return true;
    }

    // Slots: model calls are limited per account (connection), shared by every run; HTTP and
    // script functions by the workflow's own setting. A full account does not hold up nodes
    // that use another one.
    const busy = this.inflight.get(run.id)?.size ?? 0;
    const accounts = new Map(this.db.select({ id: s.connections.id, concurrency: s.connections.concurrency }).from(s.connections).all().map((row) => [row.id, row.concurrency]));
    const canSend = (node: WorkflowNode) => {
      if (node.type === 'ai') return this.freeModel(run, node, accounts) !== null;
      return (this.functionsByRun.get(run.id) ?? 0) < run.definition.settings.concurrency;
    };
    const slow = run.definition.nodes.filter(isAsync);
    if (slow.length && !slow.some(canSend)) {
      if (changed) this.notify(run.id, ...touched);
      return true;
    }

    const waiting = this.waiting(run, slowIds);
    if (!waiting.length) {
      if (busy) return true;
      const open = this.db
        .select({ id: s.runItems.id })
        .from(s.runItems)
        .where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['queued', 'running'])))
        .limit(1)
        .all();
      if (!open.length) {
        this.db.update(s.runs).set({ status: 'completed', finishedAt: new Date() }).where(eq(s.runs.id, run.id)).run();
        this.notify(run.id);
      } else if (changed) this.notify(run.id, ...touched);
      return false;
    }

    // Lines move in the run plan's batches: a node sends a plan batch once none of its members can
    // still arrive from upstream, packing ready batches up to the node's limits. Full requests go
    // first; a short last one waits while upstream can still feed the node, unless it has waited
    // GATHER_MS or nothing else is running. Runs started before plans batch on the fly.
    const open = this.openByNode(run.id);
    const openByPlan = this.openByPlanNode(run.id);
    const upstream = this.upstream(run);
    const now = Date.now();
    const idle = busy === 0;
    const stale = (lines: Waiting[]) => lines.some((line) => now - line.since.getTime() >= GATHER_MS);
    // Per node: full requests from plan batches that are ready (no member can still arrive from
    // upstream, or waited GATHER_MS), then a short last request if upstream cannot feed it any more.
    const full = new Map<string, { node: WorkflowNode; requests: Waiting[][] }>();
    const short = new Map<string, { node: WorkflowNode; requests: Waiting[][] }>();
    const held = new Map<string, { node: WorkflowNode; lines: Waiting[] }>();
    for (const [nodeId, lines] of Map.groupBy(waiting, (line) => line.nodeId)) {
      const node = this.node(run, nodeId);
      if (!node) continue;
      held.set(nodeId, { node, lines });
      const config = node.type === 'ai' ? batchConfigSchema.parse(node.config.batch ?? {}) : null;
      const before = [...(upstream.get(nodeId) ?? [])].filter((id) => id !== nodeId);
      let batches: Waiting[][];
      if (!config) batches = lines.map((line) => [line]);
      else if (lines.every((line) => line.plan !== null)) {
        const groups = [...Map.groupBy(lines, (line) => line.plan!).entries()];
        const ready = groups.filter(([plan, members]) => stale(members) || !before.some((id) => (openByPlan.get(`${plan}|${id}`) ?? 0) > 0));
        batches = packGroups(ready.map(([, members]) => members), config);
      } else batches = planBatches(lines, config);
      for (const [index, batch] of batches.entries()) {
        const tokens = () => batch.reduce((sum, line) => sum + line.tokens, 0);
        const complete = !config || config.mode === 'unit' || (config.mode === 'whole' ? tokens() >= config.maxTokens : batch.length >= config.size || (config.mode === 'group' && tokens() >= config.maxTokens));
        const target = index < batches.length - 1 || complete ? full : short;
        if (target === short && before.some((id) => (open.get(id) ?? 0) > 0) && !stale(batch)) continue;
        if (!target.has(nodeId)) target.set(nodeId, { node, requests: [] });
        target.get(nodeId)!.requests.push(batch);
      }
    }
    // Round robin across nodes, downstream first, full requests before short ones: lines finish
    // sooner, no node takes every slot, and small requests do not jump ahead of full ones.
    const depth = (nodeId: string) => upstream.get(nodeId)?.size ?? 0;
    const roundRobin = (queues: Map<string, { node: WorkflowNode; requests: Waiting[][] }>) => {
      const order = [...queues.keys()].sort((a, b) => depth(b) - depth(a));
      for (let sent = true; sent; ) {
        sent = false;
        for (const nodeId of order) {
          const queue = queues.get(nodeId)!;
          if (!queue.requests.length || !canSend(queue.node)) continue;
          this.dispatch(run, queue.node, queue.requests.shift()!, accounts);
          changed = sent = true;
        }
      }
    };
    roundRobin(full);
    roundRobin(short);
    // Nothing of this run is running and nothing above could go: waiting would never end (e.g. a
    // loop whose members sit at both ends). Send the most downstream node's lines as they are.
    if (!(this.inflight.get(run.id)?.size ?? 0) && held.size) {
      const [, { node, lines }] = [...held.entries()].sort(([a], [b]) => depth(b) - depth(a))[0];
      const config = node.type === 'ai' ? batchConfigSchema.parse(node.config.batch ?? {}) : null;
      const first = config ? (packGroups([...Map.groupBy(lines, (line) => line.plan ?? -1).values()], config)[0] ?? []) : lines.slice(0, 1);
      if (first.length && canSend(node)) {
        this.dispatch(run, node, first, accounts);
        changed = true;
      }
    }
    if (changed) this.notify(run.id, ...touched);
    return true;
  }

  /** Runs instant nodes for `items`; returns the extra topics their functions wrote to. */
  private settle(run: Run, items: Item[]): Set<Topic> {
    const topics = new Set<Topic>();
    for (const item of items) {
      const node = this.node(run, item.nodeId);
      for (const topic of node?.type === 'function' ? (FUNCTION_TOPICS[node.config.fn] ?? []) : []) topics.add(topic);
    }
    this.db.transaction((tx) => {
      const unitRows = new Map(inChunks(items.map((item) => item.unitId), (ids) => tx.select().from(s.units).where(inArray(s.units.id, ids)).all()).map((unit) => [unit.id, unit]));
      const tagRows = Map.groupBy(inChunks([...unitRows.keys()], (ids) => tx.select().from(s.unitTags).where(inArray(s.unitTags.unitId, ids)).all()), (row) => row.unitId);
      for (const item of items) {
        const node = this.node(run, item.nodeId);
        const unit = unitRows.get(item.unitId);
        if (!node || !unit) {
          tx.update(s.runItems).set({ state: 'failed', error: '노드 또는 원문이 없습니다.' }).where(eq(s.runItems.id, item.id)).run();
          continue;
        }
        this.runInstant(tx, run, node, item, unit, (tagRows.get(unit.id) ?? []).map((row) => row.tagId));
      }
    });
    return topics;
  }

  private runInstant(tx: Tx, run: Run, node: WorkflowNode, item: Item, unit: Unit, tagIds: string[]) {
    switch (node.type) {
      case 'entry':
        return this.route(tx, run, item, 'out');
      case 'end':
        return tx.update(s.runItems).set({ state: 'done' }).where(eq(s.runItems.id, item.id)).run();
      case 'condition': {
        const finalStatus = tx.select({ kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.id, unit.statusId)).get()?.kind === 'final';
        // Lines that need no listener (narration, format tokens only) count as known: nothing to guess.
        const rules = tx.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, run.projectId)).get()?.rules;
        const listenerKnown = !isUnknownListener(unit, rules);
        const marks = lineMarksOf(unit, finalStatus, rules);
        const data: ConditionData = {
          visits: item.visits,
          outputs: item.data.outputs ?? {},
          candidate: item.data.candidateText ?? unit.translation,
          issues: item.data.issues ?? [],
          unit: { kind: unit.kind, speaker: unit.speaker, statusId: unit.statusId, tagIds, marks },
          listenerKnown,
        };
        try {
          return this.route(tx, run, item, jsonLogic.apply(node.config.expression as jsonLogic.RulesLogic, data) ? 'true' : 'false');
        } catch (error) {
          return this.route(tx, run, item, 'error', `조건식 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      case 'function': {
        const fn = syncFunctions[node.config.fn as FunctionName];
        if (!fn) return this.route(tx, run, item, 'error', `알 수 없는 함수입니다: ${node.config.fn}`);
        try {
          return this.record(tx, run, item, fn(tx, node.config.params, { unit, item, tagIds, projectId: run.projectId, runId: run.id }));
        } catch (error) {
          return this.route(tx, run, item, 'error', error instanceof Error ? error.message : String(error));
        }
      }
      default:
        return this.route(tx, run, item, 'error', '즉시 실행할 수 없는 노드입니다.');
    }
  }

  /**
   * The model an AI node's next request goes to (its choiceKey): of the node's models whose account
   * has a free slot, the one with the most room left (so work spreads over the accounts). Null when none has.
   */
  private freeModel(run: Run, node: AiNode, accounts: Map<string, number>) {
    let best: { key: string; room: number } | null = null;
    for (const key of nodeModels(node).map(choiceKey)) {
      const account = this.accountOf(run, key);
      // A model without a connection (missing from the snapshot) fails the request visibly.
      const room = account ? (accounts.get(account) ?? 2) - (this.callsByAccount.get(account) ?? 0) : 1;
      if (room > 0 && (!best || room > best.room)) best = { key, room };
    }
    return best?.key ?? null;
  }

  private dispatch(run: Run, node: WorkflowNode, lines: Waiting[], accounts: Map<string, number>) {
    const ids = lines.map((line) => line.id);
    const byId = new Map(this.db.select().from(s.runItems).where(inArray(s.runItems.id, ids)).all().map((item) => [item.id, item]));
    const batch = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    this.db.update(s.runItems).set({ state: 'running' }).where(inArray(s.runItems.id, ids)).run();
    let controller = this.aborts.get(run.id);
    if (!controller || controller.signal.aborted) this.aborts.set(run.id, (controller = new AbortController()));
    const set = this.inflight.get(run.id) ?? new Set();
    this.inflight.set(run.id, set);
    const modelKey = node.type === 'ai' ? (this.freeModel(run, node, accounts) ?? choiceKey(node.config.model)) : null;
    const account = modelKey ? this.accountOf(run, modelKey) : null;
    const counts = account ? this.callsByAccount : this.functionsByRun;
    const key = account ?? run.id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const work = node.type === 'ai' ? this.executeAi(run, node, modelKey!, batch, controller.signal) : this.executeFunction(run, node as FunctionNode, batch[0], controller.signal);
    const task = work.finally(() => {
      set.delete(task);
      counts.set(key, (counts.get(key) ?? 1) - 1);
    });
    set.add(task);
  }

  private async executeFunction(run: Run, node: FunctionNode, item: Item, signal: AbortSignal) {
    const startedAt = new Date();
    const unit = this.db.select().from(s.units).where(eq(s.units.id, item.unitId)).get();
    const step: StepRecord = { runId: run.id, nodeId: node.id, unitIds: [item.unitId], startedAt };
    if (!unit) return this.failBatch(run, [item], step, new Error('원문이 없습니다.'));
    const tagIds = this.db.select({ tagId: s.unitTags.tagId }).from(s.unitTags).where(eq(s.unitTags.unitId, unit.id)).all().map((row) => row.tagId);
    const input: FunctionInput = { unit, item, tagIds, projectId: run.projectId, runId: run.id };
    try {
      const outcome = await runAsyncFunction(node.config.fn as FunctionName, node.config.params, input, { db: this.db, secrets: this.secrets, signal });
      this.db.transaction((tx) => {
        this.record(tx, run, item, outcome);
        tx.insert(s.runSteps).values({ ...step, ok: true, output: outcome, finishedAt: new Date() }).run();
      });
      this.notify(run.id);
      this.guard(run.id);
    } catch (error) {
      if (signal.aborted) return;
      this.failBatch(run, [item], step, error);
    }
  }

  private async executeAi(run: Run, node: AiNode, modelKey: string, batch: Item[], signal: AbortSignal) {
    const model = run.models[modelKey];
    if (!model) return this.failBatch(run, batch, { runId: run.id, nodeId: node.id, unitIds: batch.map((item) => item.unitId), startedAt: new Date() }, new Error('이 노드의 AI 연결이 실행을 시작할 때 없었습니다. 노드에서 연결과 모델을 다시 고르고 새로 실행하세요.'));
    const routes = resolveRoutes(model, this.secrets);
    if (routes[0]?.kind === 'systemone') return this.judgeLines(run, node, batch, model, routes, signal);
    await this.callLines(run, node, model, routes, batch, signal, 0);
  }

  /** The lines of `items` as the prompt numbers them, in batch (script) order. */
  private promptLines(items: Item[]) {
    const units = new Map(this.db.select().from(s.units).where(inArray(s.units.id, items.map((item) => item.unitId))).all().map((unit) => [unit.id, unit]));
    const rows = items.map((item) => units.get(item.unitId)!);
    const lines: PromptLine[] = items.map((item, index) => {
      const unit = units.get(item.unitId)!;
      return { id: String(index + 1), unitId: unit.id, groupId: unit.groupId, key: unit.key, kind: unit.kind, speaker: unit.speaker, source: unit.source, candidate: item.data.candidateText ?? unit.translation ?? undefined, issues: item.data.issues };
    });
    return { rows, lines };
  }

  /** Lines this call did not finish go back to the queue when the run was paused meanwhile. */
  private stillRunning(runId: string, items: Item[]) {
    const status = this.db.select({ status: s.runs.status }).from(s.runs).where(eq(s.runs.id, runId)).get()?.status;
    if (status === 'running') return true;
    if (status === 'paused')
      this.db.update(s.runItems).set({ state: 'queued' }).where(and(inArray(s.runItems.id, items.map((item) => item.id)), eq(s.runItems.state, 'running'))).run();
    return false;
  }

  /**
   * One model request for `items`. Lines a per-line answer left out (or answered empty) go back to
   * the node's queue for a later batch (see MAX_REREQUESTS); answered lines move on at once. A
   * malformed answer for several lines is retried right away as two halves, MAX_SPLITS levels deep,
   * so one bad line does not fail a whole batch. Every request is recorded as its own step.
   */
  /** Input tokens of calls sent and not yet recorded, by run (estimated), for the pre-call cap check. */
  private inFlight = new Map<string, number>();

  private overheads = new Map<string, number>();
  /** The connection's fixed overhead per request, measured once per run. */
  private overheadFor(runId: string, connectionId: string | null) {
    if (!connectionId) return 0;
    const key = `${runId}|${connectionId}`;
    if (!this.overheads.has(key)) this.overheads.set(key, overheadOf(this.db, connectionId) ?? 0);
    return this.overheads.get(key)!;
  }

  /** Why sending `estimate` more input tokens would break the run's input cap, or null when it would not. */
  private overInputCap(runId: string, estimate: number) {
    const cap = this.db.select({ limits: s.runs.limits }).from(s.runs).where(eq(s.runs.id, runId)).get()?.limits?.maxInputTokens;
    if (!cap) return null;
    const used = this.db.select({ input: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)` }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).get()!.input;
    const pending = this.inFlight.get(runId) ?? 0;
    if (used + pending + estimate <= cap) return null;
    return `입력 토큰 상한(${cap.toLocaleString()})을 넘지 않도록 멈췄습니다: 지금까지 ${used.toLocaleString()}${pending ? `, 진행 중 약 ${pending.toLocaleString()}` : ''}, 다음 요청 약 ${estimate.toLocaleString()}.`;
  }

  private async callLines(run: Run, node: AiNode, model: s.AiSnapshot, routes: ai.ResolvedRoute[], items: Item[], signal: AbortSignal, depth: number): Promise<void> {
    const project = this.db.select().from(s.projects).where(eq(s.projects.id, run.projectId)).get()!;
    const { rows, lines } = this.promptLines(items);
    const round = Math.max(0, ...items.map((item) => item.data.retries?.[node.id] ?? 0));
    const step: StepRecord = { runId: run.id, nodeId: node.id, connectionId: routes[0]?.connectionId ?? null, model: routes[0]?.model ?? null, unitIds: items.map((item) => item.unitId), startedAt: new Date(), round };
    // A work analysis reads its lines as compact script text with its own rules (services/analysis.ts);
    // the script is its context. Every other node gets the batch prompt with the context it asks for.
    const analysis = node.config.output === 'analysis' ? analysisRequest(this.db, run.projectId, items.map((item) => item.unitId), node.config.sections, node.config.instructions) : null;
    let built: { system: string; prompt: string };
    if (analysis) built = analysis;
    else {
      const context = buildContext(this.db, run.projectId, rows, node.config.context);
      step.context = context.items;
      built = buildPrompt(node, { source: project.sourceLanguage, target: project.targetLanguage }, context, lines);
    }
    const { system, prompt } = built;
    const perLine = PER_LINE_OUTPUTS.has(node.config.output);
    // A whole-script read takes minutes; the connection's per-call timeout is for single scenes.
    const timeoutMs = analysis ? Math.max(model.timeoutSeconds * 1000, MIN_ANALYSIS_TIMEOUT_MS) : model.timeoutSeconds * 1000;
    const request = { system, prompt, schema: analysis?.schema ?? outputSchema(node, perLine ? lines.map((line) => line.id) : undefined), maxOutputTokens: model.maxOutputTokens, temperature: node.config.temperature, timeoutMs, signal };
    step.prompt = `${system}\n\n${prompt}`;
    // The input cap is checked before sending, counting calls still in flight, so a run stops short
    // of it instead of finding out afterwards (several calls at once could overshoot by a lot).
    // Plus what the connection adds to every request (tool and system preamble, measured from past calls, as the run dialog's estimate does).
    const estimate = estimateTokens(step.prompt) + this.overheadFor(run.id, step.connectionId ?? null);
    const over = this.overInputCap(run.id, estimate);
    if (over) {
      this.halt(run.id, over);
      this.stillRunning(run.id, items);
      return;
    }
    this.inFlight.set(run.id, (this.inFlight.get(run.id) ?? 0) + estimate);
    let sent = true;
    // Released once the call has answered or failed (its real tokens are then recorded with the step).
    const release = () => {
      if (!sent) return;
      sent = false;
      const left = (this.inFlight.get(run.id) ?? 0) - estimate;
      if (left > 0) this.inFlight.set(run.id, left);
      else this.inFlight.delete(run.id);
    };

    try {
      // Analysis reads are logged as such: their pace (minutes per script) would skew the run estimates.
      const call = { projectId: run.projectId, kind: analysis ? ('analysis' as const) : ('run' as const), refId: run.id, label: `${nodeName(node)} · ${items.length.toLocaleString()}줄` };
      const result = await ai.withFallback(routes, model.maxAttempts, (route) => logged(this.db, call, route, () => this.model.generate(route, request)), signal).finally(release);
      const raw = result.result.object;
      const outcomes = this.readAiOutput(node, raw, lines, result.route.model, analysis?.keyOf);
      const answered = outcomes.filter(Boolean).length;
      this.db.transaction((tx) => {
        items.forEach((item, index) => {
          const outcome = outcomes[index];
          if (outcome) this.record(tx, run, item, outcome);
          else this.retryLater(tx, run, item, `모델 응답에 이 대사의 ${MISSING_WHAT[node.config.output]}이(가) 없습니다.`);
        });
        tx.insert(s.runSteps)
          .values({ ...step, ok: true, connectionId: result.route.connectionId ?? step.connectionId, model: result.route.model, output: raw, attempts: result.attempts, returnedLines: perLine ? answered : null, ...usageColumns(stepUsage(result.attempts, result.result.usage)), finishedAt: new Date() })
          .run();
      });
      this.notify(run.id);
      this.guard(run.id);
    } catch (error) {
      if (signal.aborted) return;
      // A malformed answer or a request longer than the model's window: smaller requests may pass.
      const code = (error as { code?: string }).code;
      // A work analysis whose answer was cut off at the model's output limit (a whole game's listeners
      // and terms can be as long as the script) is read again in halves too, cut between scenes.
      const splittable = code === 'invalid-output' || code === 'too-long' || (analysis !== null && outputCutOff(error));
      if (!(splittable && items.length > 1 && depth < (analysis ? MAX_ANALYSIS_SPLITS : MAX_SPLITS))) return this.failBatch(run, items, { ...step, attempts: attemptsOf(error) }, error);
      // Record the failed request, then try each half on its own.
      const message = error instanceof Error ? error.message : String(error);
      this.db.insert(s.runSteps).values({ ...step, ok: false, error: `${message} (반으로 나눠 다시 보냄)`, attempts: attemptsOf(error), ...usageColumns(stepUsage(attemptsOf(error), (error as { usage?: ai.Usage }).usage)), finishedAt: new Date() }).run();
      this.guard(run.id, { code, message });
      const half = analysis ? sceneHalf(rows.map((row) => row.groupId)) : Math.ceil(items.length / 2);
      for (const part of [items.slice(0, half), items.slice(half)]) {
        if (!this.stillRunning(run.id, part)) return;
        await this.callLines(run, node, model, routes, part, signal, depth + 1);
      }
    }
  }

  /** A judge model (System One) answers one line at a time and only supports verdicts. */
  private async judgeLines(run: Run, node: AiNode, batch: Item[], model: s.AiSnapshot, routes: ai.ResolvedRoute[], signal: AbortSignal) {
    const step: StepRecord = { runId: run.id, nodeId: node.id, connectionId: routes[0]?.connectionId ?? null, model: routes[0]?.model ?? null, unitIds: batch.map((item) => item.unitId), startedAt: new Date() };
    if (node.config.output !== 'verdict') return this.failBatch(run, batch, step, new Error('System One 연결은 출력 형태가 "판정"인 AI 노드에서만 쓸 수 있습니다.'));
    const { rows, lines } = this.promptLines(batch);
    const context = buildContext(this.db, run.projectId, rows, node.config.context);
    step.context = context.items;
    try {
      const outcomes: Outcome[] = [];
      let attempts: ai.Attempt[] = [];
      const judged: ai.Usage[] = [];
      for (const line of lines) {
        const outcome = await ai.withFallback(
          routes,
          model.maxAttempts,
          (route) =>
            logged(this.db, { projectId: run.projectId, kind: 'run', refId: run.id, label: `${nodeName(node)} · 판정 1줄` }, route, () => this.model.judge(route, {
              state: { source: line.source, translation: line.candidate ?? '', speaker: line.speaker, context: { scene: context.scenes[line.groupId] ?? null, characters: context.characters, glossary: context.terms } },
              instructions: node.config.instructions.trim() || 'Is this translation acceptable as is?',
              timeoutMs: model.timeoutSeconds * 1000,
              signal,
            })),
          signal,
        );
        attempts = [...attempts, ...outcome.attempts];
        judged.push(outcome.result.usage);
        const issues = outcome.result.passed ? [] : ['System One이 수정 필요로 판정했습니다.'];
        outcomes.push({ port: outcome.result.passed ? 'pass' : 'fail', issues, output: { passed: outcome.result.passed, issues, confidence: outcome.result.confidence } });
      }
      this.db.transaction((tx) => {
        batch.forEach((item, index) => this.record(tx, run, item, outcomes[index]));
        tx.insert(s.runSteps)
          .values({ ...step, ok: true, model: routes[0]?.model, prompt: null, output: outcomes, attempts, returnedLines: outcomes.length, ...usageColumns(stepUsage(attempts, judged.reduce(ai.addUsage, {}))), finishedAt: new Date() })
          .run();
      });
      this.notify(run.id);
      this.guard(run.id);
    } catch (error) {
      if (signal.aborted) return;
      this.failBatch(run, batch, { ...step, attempts: attemptsOf(error) }, error);
    }
  }

  /** Turn the model's structured answer into one Outcome per line, by output kind. Null: the answer left the line out. */
  private readAiOutput(node: AiNode, raw: unknown, lines: PromptLine[], model: string, analysisKeys?: Map<string, string>): (Outcome | null)[] {
    const missing = (_what: string) => null;
    const value = raw as { translations?: { id: string; text: string }[]; results?: ({ id: string } & Record<string, unknown>)[]; terms?: unknown[]; listeners?: { id: string; listener: unknown; confidence: unknown }[] };
    switch (node.config.output) {
      case 'candidate':
        return lines.map((line) => {
          const text = value.translations?.find((entry) => entry.id === line.id)?.text;
          return text === undefined || !text.trim() ? missing('번역') : { port: 'out', candidate: text, origin: 'ai', model, output: { text } };
        });
      case 'verdict':
        return lines.map((line) => {
          const result = value.results?.find((entry) => entry.id === line.id) as { passed: boolean; issues: string[]; categories?: IssueKind[] } | undefined;
          if (!result) return missing('판정');
          // A review covers every kind: passing clears them, failing names what it found (기타 when it did not say).
          const kinds = result.categories?.length ? [...new Set(result.categories)] : (['other'] as IssueKind[]);
          return {
            port: result.passed ? 'pass' : 'fail',
            issues: result.passed ? undefined : result.issues,
            output: { passed: result.passed, issues: result.issues, ...(!result.passed && { categories: kinds }) },
            issueTags: result.passed ? { clear: 'all' } : { add: kinds },
          };
        });
      case 'terms': {
        const terms = (value.terms ?? []) as unknown[];
        return lines.map((_, index) => ({ port: 'out', output: { terms, batchLeader: index === 0 } }));
      }
      case 'knowledge': {
        // Like terms, the change set describes the whole batch; line ids become line keys so it outlives the prompt.
        const keyOf = new Map(lines.map((line) => [line.id, line.key]));
        const known = (id: string | null | undefined) => (id ? (keyOf.get(id) ?? null) : null);
        const found = raw as KnowledgeOutput;
        const knowledge = {
          characters: (found.characters ?? []).map((c) => ({
            ...c,
            evidence: ((c as { evidence?: string[] }).evidence ?? []).flatMap((id) => (keyOf.get(id) ? [keyOf.get(id)!] : [])),
          })),
          relationships: (found.relationships ?? []).map((rel) => ({ ...rel, at: known(rel.at), evidence: (rel.at && keyOf.get(rel.at) ? [keyOf.get(rel.at)!] : []) })),
          events: (found.events ?? []).map((event) => ({ ...event, evidence: event.evidence.flatMap((id) => (keyOf.get(id) ? [keyOf.get(id)!] : [])) })),
          speechRules: (found.speechRules ?? []).map((rule) => ({ ...rule, start: known(rule.start), evidence: (rule.start && keyOf.get(rule.start) ? [keyOf.get(rule.start)!] : []) })),
        };
        return lines.map((_, index) => ({
          port: 'out',
          // To save space in run_items.data (H7), only the first line carries the full payload;
          // subsequent lines carry an empty payload with batchLeader: false so downstream nodes skip redundant writes.
          output: index === 0
            ? { knowledge, batchLeader: true }
            : { knowledge: { characters: [], relationships: [], events: [], speechRules: [] }, batchLeader: false },
        }));
      }
      case 'analysis': {
        // One answer for the whole request, its line ids turned into line keys; only the first line
        // carries it (H7) and `saveAnalysis` stores it once.
        const analysis = analysisToKeys(raw as Partial<Analysis>, analysisKeys ?? new Map());
        const sections = analysisSectionsOf(node.config.sections);
        return lines.map((_, index) => ({ port: 'out', output: index === 0 ? { analysis, sections, batchLeader: true } : { analysis: null, batchLeader: false } }));
      }
      case 'listener':
        return lines.map((line) => {
          const entry = value.listeners?.find((candidate) => candidate.id === line.id);
          if (!entry) return missing('청자');
          const listener = typeof entry.listener === 'string' && entry.listener.trim() ? entry.listener.trim() : null;
          return { port: 'out', output: { listener, confidence: Math.min(1, Math.max(0, Number(entry.confidence) || 0)) } };
        });
      case 'json':
        return lines.map((line) => {
          const result = value.results?.find((entry) => entry.id === line.id);
          if (!result) return missing('결과');
          const { id: _id, ...fields } = result;
          return { port: 'out', output: fields };
        });
    }
  }

  /** Every line of a failed call leaves through `error`; the call is recorded with whatever usage the connection reported. */
  private failBatch(run: Run, batch: Item[], step: StepRecord, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const usage = stepUsage(attemptsOf(error), (error as { usage?: ai.Usage }).usage);
    const transient = TRANSIENT.has((error as { code?: string }).code ?? '');
    this.db.transaction((tx) => {
      // A rate limit or a dropped connection is not the lines' fault: they wait for a later batch.
      for (const item of batch) transient ? this.retryLater(tx, run, item, message) : this.route(tx, run, item, 'error', message);
      tx.insert(s.runSteps).values({ ...step, ok: false, error: message, ...usageColumns(usage), finishedAt: new Date() }).run();
    });
    this.notify(run.id);
    this.guard(run.id, { code: (error as { code?: string }).code, message });
  }
}

/** Selects the lines a run starts with: scope ∩ entry status filter. */
export function selectRunUnits(db: Db, projectId: string, definition: WorkflowDefinition, scope: s.RunScope): string[] {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const statusIds = entry?.type === 'entry' ? entry.config.statusIds : [];
  const conditions = [eq(s.units.projectId, projectId)];
  if (statusIds.length && !scope.ignoreStatus) {
    conditions.push(inArray(s.units.statusId, statusIds));
    // A line a person translated is not "untranslated", even while it still sits in an initial status:
    // the entry filter must not pick it again and overwrite what they wrote (docs/DESIGN.md 3.5).
    const initial = db.select({ id: s.statuses.id }).from(s.statuses).where(eq(s.statuses.kind, 'initial'));
    conditions.push(or(notInArray(s.units.statusId, initial), ne(s.units.statusBy, 'human'), sql`coalesce(trim(${s.units.translation}), '') = ''`)!);
  }
  // A scope can name every line of a large project; long lists travel as one JSON parameter.
  if (scope.groupIds?.length) conditions.push(inList(s.units.groupId, scope.groupIds));
  if (scope.unitIds?.length) conditions.push(inList(s.units.id, scope.unitIds));
  // Tags and marks combine with AND, like the line list's filter: a line must carry every one picked.
  for (const tagId of scope.tagIds ?? []) conditions.push(inArray(s.units.id, db.select({ id: s.unitTags.unitId }).from(s.unitTags).where(eq(s.unitTags.tagId, tagId))));
  conditions.push(...markConditions(projectId, scope.marks));
  return db.select({ id: s.units.id }).from(s.units).where(and(...conditions)).all().map((row) => row.id);
}

/**
 * Direct transitions between scenes in the dialogue graph: an edge from a node of one group to a
 * node of another. Links through hubs (nodes outside every scene) are left out on purpose: a menu
 * or return point would otherwise make every scene "related" to every other.
 */
export function sceneLinks(db: Db | Tx, lines: { groupId: string }[]) {
  const groups = new Set(lines.map((line) => line.groupId));
  const pairs = new Set<string>();
  if (groups.size > 1) {
    // The project's scene transitions in one pass, filtered here: a 2,000-scene IN list made the
    // join slow (160 ms for a 50k-line run).
    const projectId = db.select({ projectId: s.groups.projectId }).from(s.groups).where(eq(s.groups.id, groups.values().next().value!)).get()?.projectId;
    const fromNode = alias(s.graphNodes, 'from_node');
    const toNode = alias(s.graphNodes, 'to_node');
    const rows = projectId
      ? db
          .selectDistinct({ from: fromNode.groupId, to: toNode.groupId })
          .from(s.graphEdges)
          .innerJoin(fromNode, eq(fromNode.id, s.graphEdges.fromId))
          .innerJoin(toNode, eq(toNode.id, s.graphEdges.toId))
          .where(and(eq(s.graphEdges.projectId, projectId), sql`${fromNode.groupId} <> ${toNode.groupId}`))
          .all()
      : [];
    for (const row of rows) if (row.from && row.to && groups.has(row.from)) pairs.add(`${row.from}|${row.to}`);
  }
  return (a: string, b: string) => pairs.has(`${a}|${b}`);
}

/**
 * Lines by id for planning: a run over most of a project reads the project's lines once and keeps
 * the wanted ones (ids in chunks of 5,000 took 140 ms for 50k lines); a small run reads by id.
 */
export function planLines(db: Db | Tx, unitIds: string[]) {
  const columns = { id: s.units.id, groupId: s.units.groupId, seq: s.units.seq, kind: s.units.kind, speaker: s.units.speaker, tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4` };
  if (unitIds.length < 2_000) return inChunks(unitIds, (ids) => db.select(columns).from(s.units).where(inArray(s.units.id, ids)).all());
  const projectId = db.select({ projectId: s.units.projectId }).from(s.units).where(eq(s.units.id, unitIds[0])).get()?.projectId;
  if (!projectId) return [];
  const wanted = new Set(unitIds);
  return db.select(columns).from(s.units).where(eq(s.units.projectId, projectId)).all().filter((line) => wanted.has(line.id));
}

/**
 * The run plan: which lines travel together through every AI node. Planned once, when the run
 * starts, with the batch settings of the first AI node the lines reach (see planBatches): script
 * order, scenes kept whole, dialogue apart from documents and UI, unrelated scenes not mixed.
 * Every node then moves lines by these batches, so a scene that was translated together is
 * reviewed together. Returns unit id → batch number; empty when the workflow has no AI node.
 */
export function planRun(db: Db | Tx, definition: WorkflowDefinition, unitIds: string[]) {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const seen = new Set<string>();
  const queue = entry ? [entry.id] : [];
  let first: AiNode | undefined;
  while (queue.length && !first) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = definition.nodes.find((candidate) => candidate.id === id);
    if (node?.type === 'ai') first = node;
    else for (const edge of definition.edges) if (edge.source === id) queue.push(edge.target);
  }
  if (!first) return new Map<string, number>();
  const lines = planLines(db, unitIds);
  const batches = planBatches(lines, batchConfigSchema.parse(first.config.batch ?? {}), sceneLinks(db, lines));
  return new Map(batches.flatMap((batch, index) => batch.map((line) => [line.id, index] as const)));
}

type RunInput = { projectId: string; workflow: typeof s.workflows.$inferSelect; models: Record<string, s.AiSnapshot>; scope: s.RunScope; limits?: s.RunLimits };

/** The run's lines and their plan batches, and the run row to store. */
function runRows(db: Db, input: RunInput) {
  const entry = input.workflow.definition.nodes.find((node) => node.type === 'entry');
  if (!entry) throw new Error('진입 노드가 없습니다.');
  const unitIds = selectRunUnits(db, input.projectId, input.workflow.definition, input.scope);
  if (!unitIds.length) throw new Error('조건에 맞는 대사가 없습니다.');
  const runId = crypto.randomUUID();
  const plan = planRun(db, input.workflow.definition, unitIds);
  const run = {
    id: runId,
    projectId: input.projectId,
    workflowId: input.workflow.id,
    workflowName: input.workflow.name,
    workflowVersion: input.workflow.version,
    definition: input.workflow.definition,
    models: input.models,
    scope: input.scope,
    status: 'running' as s.RunStatus,
    total: unitIds.length,
    limits: input.limits ?? null,
  };
  const items = unitIds.map((unitId) => ({ runId, unitId, nodeId: entry.id, state: 'queued' as const, visits: { [entry.id]: 1 }, data: { path: [], outputs: {} } as ItemData, plan: plan.get(unitId) ?? null }));
  return { run, items };
}

/** Creates a run with all its lines in one transaction (tests, scripts and small runs). */
export function createRun(db: Db, input: RunInput) {
  const { run, items } = runRows(db, input);
  db.transaction((tx) => {
    tx.insert(s.runs).values(run).run();
    for (let index = 0; index < items.length; index += 400) tx.insert(s.runItems).values(items.slice(index, index + 400)).run();
  });
  events.changed(input.projectId, 'runs');
  return { runId: run.id, total: run.total };
}

export const ANALYSIS_BUSY = '이미 진행 중인 작품 분석이 있습니다.';

/**
 * One work analysis at a time per project (#47), whoever starts it: the 작품 분석 button, the run
 * dialog or the agent's start_run. A run still filling its lines counts as running; so does a job
 * of the old analysis service that is still marked running.
 */
export const runActive = (run: { status: string; notice: string | null }) => run.status === 'running' || (run.status === 'paused' && run.notice === FILLING);

export function refuseSecondAnalysis(db: Db, projectId: string) {
  const runs = db.select({ status: s.runs.status, notice: s.runs.notice, definition: s.runs.definition }).from(s.runs).where(and(eq(s.runs.projectId, projectId), inArray(s.runs.status, ['running', 'paused']))).all();
  const busy = runs.some((run) => runActive(run) && isAnalysisWorkflow(run.definition));
  if (busy || db.select({ id: s.analysisJobs.id }).from(s.analysisJobs).where(and(eq(s.analysisJobs.projectId, projectId), eq(s.analysisJobs.status, 'running'))).get()) throw new Error(ANALYSIS_BUSY);
}

/** Lines stored per step when a run is created from the app or a chat. */
const FILL_STEP = 2_000;
export const FILLING = '대사를 넣는 중입니다.';

/**
 * createRun for the app and chats: a 50k-line run is stored FILL_STEP lines at a time with the
 * event loop handed back in between (one transaction took about a second, holding up every
 * request). The run waits paused, saying so, until all its lines are in.
 */
export async function createRunInSteps(db: Db, input: RunInput) {
  // Checked and inserted with no await in between, so two starts at once cannot both pass.
  if (isAnalysisWorkflow(input.workflow.definition)) refuseSecondAnalysis(db, input.projectId);
  const { run, items } = runRows(db, input);
  db.insert(s.runs).values({ ...run, status: 'paused', notice: FILLING }).run();
  events.changed(input.projectId, 'runs');
  for (let start = 0; start < items.length; start += FILL_STEP) {
    await new Promise((resolve) => setImmediate(resolve));
    db.transaction((tx) => {
      const part = items.slice(start, start + FILL_STEP);
      for (let index = 0; index < part.length; index += 400) tx.insert(s.runItems).values(part.slice(index, index + 400)).run();
    });
  }
  db.update(s.runs).set({ status: 'running', notice: null }).where(and(eq(s.runs.id, run.id), eq(s.runs.status, 'paused'), eq(s.runs.notice, FILLING))).run();
  events.changed(input.projectId, 'runs');
  return { runId: run.id, total: run.total };
}
