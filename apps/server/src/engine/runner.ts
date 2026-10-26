import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import jsonLogic from 'json-logic-js';
import * as ai from '@tw/ai';
import { estimateTokens, batchConfigSchema, batchTokens, lineCostIn, FUNCTIONS, functionTakes, INPUT_TYPES, choiceKey, lineMarksOf, runNodeName, type AiNode, type ConditionData, type FunctionName, type ItemErrorKind, pickPaths, previousStepId, retryModel, type FunctionNode, type RetryNode, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
type GatherNode = Extract<WorkflowNode, { type: 'gather' }>;
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData, ItemState } from '../db/schema.ts';
import { events, type Topic } from '../events.ts';
import { buildContext, runPairLines } from '../services/context.ts';
import { resolveRoute } from '../services/routes.ts';
import type { SecretStore } from '../services/secrets.ts';
import { runAsyncFunction, syncFunctions, type FunctionInput } from './functions/index.ts';
import { APPLY_TOPICS } from './functions/apply.ts';
import { packGroups, planBatches, scaleBatch } from './batches.ts';
import { readAiOutput, type Outcome } from './ai-output.ts';
import { buildPrompt, isBatchScope, outputSchema, promptLineId, type PromptLine } from './prompts.ts';
import { wholeScriptRequest } from './whole-script.ts';
import { resolveChoiceOptions } from '../services/choice-options.ts';
import { logged } from '../services/ai-calls.ts';
import { outputCutOff } from '../services/whole-script-limits.ts';
import { loadTerms, RETRY_FACTOR, RETRY_MODEL, termCondition, termInput, termPrompt, waitingTerms } from './subjects.ts';
import { overheadOf } from '../services/preflight.ts';
import type { ModelPort } from './model-port.ts';
export type { ModelPort } from './model-port.ts';
import { FILLING } from './run-create.ts';

type Run = typeof s.runs.$inferSelect;
type Item = typeof s.runItems.$inferSelect;
type Unit = typeof s.units.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type StepRecord = Omit<typeof s.runSteps.$inferInsert, 'ok' | 'finishedAt'>;
/** A queued line waiting at a slow node, with its script position for batching. */
type Waiting = { id: string; unitId: string; nodeId: string; groupId: string; seq: number; kind: string; tokens: number; since: Date; plan: number | null; factor: number; /** The model a 재요청 node sends it to this node on (a run.models key); null: the node's own. */ model: string | null };

/** Functions that write beyond the line itself, and the change topic they touch. */
const FUNCTION_TOPICS: Record<string, Topic[]> = { ...APPLY_TOPICS, setStatus: ['terms'] };
/** A partial batch waits this long for more lines from upstream before it is sent anyway. */
const GATHER_MS = 5_000;
/** Lines passed through instant nodes per tick; the rest wait for the next tick, so a tick never blocks for long. */
const SETTLE_PER_TICK = 2_000;
/**
 * Failures that will not go away by trying the next batch: the run pauses at the first one. A rate
 * limit is not among them: it leaves through the node's "error" exit like any failure (a 재요청 node
 * can wait and send it again), and an exhausted subscription fails every call at once, which the
 * consecutive-failure guard catches within a few calls.
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
/** The kind a failed call gives its lines, as conditions read it. */
export function errorKindOf(error: unknown): ItemErrorKind {
  if (outputCutOff(error)) return 'cut-off';
  const code = (error as { code?: string }).code;
  if (code === 'invalid-output' || code === 'too-long' || code === 'timeout' || code === 'rate-limit' || code === 'network') return code;
  // A model that declines to answer (an API's content filter, a CLI's refusal stop reason).
  if (/거절|refus|content[_ ]filter/i.test(error instanceof Error ? error.message : String(error))) return 'refused';
  return 'other';
}

/**
 * The result of the step before `node` on the item's way here (input.previous), trimmed to input.fields:
 * the last node it passed that leaves a result (leavesResult), not through that node's error exit.
 * Undefined when there is none, or when that step answered for a whole batch and the answer rides on
 * another item (only a batch's first item carries it).
 */
function previousOf(item: Item, definition: WorkflowDefinition, node?: AiNode) {
  const input = node?.config.input;
  if (!input?.previous) return undefined;
  const step = previousStepId(definition, item.data.path);
  if (!step) return undefined;
  const { batchLeader, ...output } = item.data.outputs?.[step] ?? { batchLeader: false };
  return batchLeader === false ? undefined : pickPaths(output, input.fields);
}
/** Prompt items with the previous step's result for them. */
const withPrevious = (lines: PromptLine[], items: Item[], definition: WorkflowDefinition, node: AiNode) =>
  lines.map((line, index) => {
    const previous = previousOf(items[index]!, definition, node);
    return previous === undefined ? line : { ...line, previous };
  });

const MISSING_WHAT: Record<AiNode['config']['output'], string> = { text: '번역', verdict: '판정', choice: '선택', json: '결과' };
const attemptsOf = (error: unknown): ai.Attempt[] => ((error as { attempts?: ai.Attempt[] }).attempts ?? []);


/** Why a node of the other input sends an item out through "error" (validation keeps such nodes out; a safety net). */
const unsupported = (definition: WorkflowDefinition, node: WorkflowNode, subject: Run['subject']) => `'${runNodeName(definition, node)}' 노드는 ${subject === 'terms' ? '용어' : '대사'}에 쓸 수 없어 오류 출구로 보냈습니다.`;

/** An AI node's batching for this run, within the batch modes of its input (validation keeps others out; a safety net). */
const runBatch = (run: Run, node: AiNode) => {
  const config = batchConfigSchema.parse(node.config.batch ?? {});
  return (INPUT_TYPES[run.subject].batchModes as readonly string[]).includes(config.mode) ? config : { ...config, mode: 'count' as const };
};

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
  /** Runs with nothing to do until lines held by a 재요청 node's wait are due: when, and the timer that ticks then. No polling meanwhile. */
  private sleeping = new Map<string, { until: number; timer: NodeJS.Timeout }>();

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
    for (const runId of [...this.sleeping.keys()]) this.wake(runId);
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
        // A run whose lines all wait for a 재요청 node's wait does nothing until the first is due.
        const asleep = this.sleeping.get(run.id);
        if (asleep) {
          if (asleep.until > Date.now()) continue;
          this.wake(run.id);
        }
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

  /** Puts a run to sleep until `until` (ms): its timer ticks then. */
  private sleepUntil(runId: string, until: number) {
    const known = this.sleeping.get(runId);
    if (known?.until === until) return;
    clearTimeout(known?.timer);
    const timer = setTimeout(() => {
      this.sleeping.delete(runId);
      void this.tick();
    }, Math.max(0, until - Date.now()));
    timer.unref?.();
    this.sleeping.set(runId, { until, timer });
  }

  private wake(runId: string) {
    clearTimeout(this.sleeping.get(runId)?.timer);
    this.sleeping.delete(runId);
  }

  pause(runId: string) {
    this.db.update(s.runs).set({ status: 'paused' }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'running'))).run();
    this.notify(runId);
  }

  /** `limits` replaces the run's caps first (null clears one); a cap not named stays. */
  resume(runId: string, limits?: { maxCalls?: number | null; maxInputTokens?: number | null }) {
    // A run still being filled (createRunInSteps) starts by itself once all its lines are in.
    const current = this.db.select({ status: s.runs.status, limits: s.runs.limits }).from(s.runs).where(eq(s.runs.id, runId)).get();
    let next = current?.limits ?? null;
    if (limits && current?.status === 'paused') {
      const merged: s.RunLimits = { ...current.limits };
      for (const key of ['maxCalls', 'maxInputTokens'] as const) {
        if (limits[key] === null) delete merged[key];
        else if (limits[key] !== undefined) merged[key] = limits[key];
      }
      next = merged.maxCalls || merged.maxInputTokens ? merged : null;
    } else if (next) next = { ...next };
    if (next) delete next.hit;
    this.wake(runId);
    this.db.update(s.runs).set({ status: 'running', notice: null, limits: next }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'paused'), or(isNull(s.runs.notice), ne(s.runs.notice, FILLING)))).run();
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
        // Failed lines, and lines a pause caught on their way through an error path (queued with a failure).
        const failed = tx
          .select()
          .from(s.runItems)
          .where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, ['failed', 'queued'])))
          .all()
          .filter((item) => item.state === 'failed' || item.data.error);
        // A line goes back to the node that failed it,
        // arriving there as for the first time so the workflow's retry path applies again.
        const known = new Set(next.definition.nodes.map((node) => node.id));
        for (const item of failed) {
          const failedAt = item.data.error?.nodeId;
          const nodeId = failedAt && known.has(failedAt) ? failedAt : item.nodeId;
          tx.update(s.runItems)
            .set({ state: 'queued', nodeId, error: null, notBefore: null, visits: { ...item.visits, [nodeId]: 1 }, data: { ...item.data, retry: undefined, error: undefined } })
            .where(eq(s.runItems.id, item.id))
            .run();
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
    if (result.ok) {
      this.wake(runId);
      this.notify(runId);
    }
    return result;
  }

  cancel(runId: string) {
    this.aborts.get(runId)?.abort();
    this.wake(runId);
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
  private halt(runId: string, notice: string, cap?: 'calls' | 'input') {
    const run = this.db.select({ limits: s.runs.limits }).from(s.runs).where(eq(s.runs.id, runId)).get();
    // A cap that stopped the run is remembered in its limits, so the run page can offer to raise it.
    const limits = cap && run?.limits ? { ...run.limits, hit: cap } : undefined;
    this.db.update(s.runs).set({ status: 'paused', notice, ...(limits ? { limits } : {}) }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'running'))).run();
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
    // A failed request whose lines a 재요청 node sends back is neither a failure nor a success here (retriedSteps).
    const skipped = [...(this.retriedSteps.get(runId) ?? [])];
    const recent = this.db.select({ ok: s.runSteps.ok }).from(s.runSteps).where(and(eq(s.runSteps.runId, runId), since ? gte(s.runSteps.startedAt, new Date(since)) : undefined, skipped.length ? notInArray(s.runSteps.id, skipped) : undefined)).orderBy(desc(sql`rowid`)).limit(max).all();
    if (recent.length === max && recent.every((step) => !step.ok))
      return this.halt(runId, `호출이 ${max}번 연달아 실패해서 멈췄습니다.${failure ? ` 마지막 오류: ${failure.message}` : ''}`);
    if (!run.limits?.maxCalls && !run.limits?.maxInputTokens) return;
    const used = this.db.select({ calls: sql<number>`count(*)`, input: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)` }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).get()!;
    if (run.limits.maxCalls && used.calls >= run.limits.maxCalls) return this.halt(runId, `호출 상한(${run.limits.maxCalls.toLocaleString()}회)에 도달해서 멈췄습니다.`, 'calls');
    if (run.limits.maxInputTokens && used.input >= run.limits.maxInputTokens)
      return this.halt(runId, `입력 토큰 상한(${run.limits.maxInputTokens.toLocaleString()})에 도달해서 멈췄습니다.`, 'input');
  }

  /** Run progress always changes lines; nodes that write terms or story data add their topic. */
  private notify(runId: string, ...topics: Topic[]) {
    const run = this.db.select({ projectId: s.runs.projectId, subject: s.runs.subject }).from(s.runs).where(eq(s.runs.id, runId)).get();
    events.changed(run?.projectId, 'runs', run?.subject === 'terms' ? 'terms' : 'units', ...topics);
  }

  private node(run: Run, nodeId: string): WorkflowNode | undefined {
    return run.definition.nodes.find((node) => node.id === nodeId);
  }

  /** Store what a node produced for a line, then move the line out through the chosen exit. */
  private record(tx: Tx, run: Run, item: Item, outcome: Outcome) {
    const data: ItemData = { ...item.data, outputs: { ...item.data.outputs } };
    if (outcome.output) data.outputs![item.nodeId] = outcome.output;
    // A returned "text" is the line's working text (an HTTP call or a script that rewrites it), like an AI translation.
    const returned = (outcome.output as { text?: unknown } | undefined)?.text;
    if (outcome.candidate === undefined && typeof returned === 'string' && returned !== item.data.candidateText) outcome = { ...outcome, candidate: returned };
    if (outcome.candidate !== undefined) {
      // The run's working text only; the line itself changes in an apply node ("번역 저장").
      data.candidateText = outcome.candidate;
      data.issues = []; // a new text answers the previous issues
    }
    if (outcome.issues?.length) data.issues = outcome.issues;
    this.route(tx, run, { ...item, data }, outcome.port, outcome.error, outcome.errorKind);
  }

  /**
   * Moves an item out through `port`. An exit with no edge ends the item (failed while it carries a failure). An
   * exit with several edges sends the line down each of them: the item takes the first, and a copy
   * of it each of the others (validation keeps those branches apart until they end).
   */
  private route(tx: Tx, run: Run, item: Item, port: string, error?: string, kind?: ItemErrorKind, notBefore?: number) {
    const definition: WorkflowDefinition = run.definition;
    // What conditions read as error: set by an "error" exit (a node without its own kind keeps the
    // failure it was sent with), kept through conditions (they only route the
    // line), cleared once a working node handles it.
    const previous = item.data.error;
    const routing = this.node(run, item.nodeId)?.type === 'condition';
    const failure =
      port === 'error' ? (kind || !previous ? { kind: kind ?? 'other', message: error ?? '', nodeId: item.nodeId } : { ...previous, message: error || previous.message }) : routing ? previous : undefined;
    item = { ...item, data: { ...item.data, error: failure } };
    const edges = definition.edges.filter((candidate) => candidate.source === item.nodeId && candidate.sourceHandle === port);
    const path = [...item.data.path, { nodeId: item.nodeId, port, at: Date.now() }].slice(-200);
    const moved = (target: string | undefined) => {
      let state: ItemState = 'queued';
      let nodeId = item.nodeId;
      let message = failure?.message || error || null;
      const visits = { ...item.visits };
      if (!target) {
        // An exit with nothing after it ends the line: failed when it still carries a failure (an
        // "error" exit, or a condition it reached from one), else done.
        state = failure ? 'failed' : 'done';
      } else {
        nodeId = target;
        visits[nodeId] = (visits[nodeId] ?? 0) + 1;
        if (visits[nodeId] > definition.settings.maxVisitsPerNode) {
          const node = this.node(run, nodeId);
          state = 'failed';
          message = `'${node ? runNodeName(definition, node) : nodeId}' 노드 방문 상한(${definition.settings.maxVisitsPerNode}회)을 넘었습니다.`;
        }
      }
      return { nodeId, state, visits, data: { ...item.data, path }, error: message, notBefore: notBefore ? new Date(notBefore) : null };
    };
    tx.update(s.runItems).set(moved(edges[0]?.target)).where(eq(s.runItems.id, item.id)).run();
    for (const edge of edges.slice(1)) tx.insert(s.runItems).values({ runId: run.id, subjectId: item.subjectId, plan: item.plan, ...moved(edge.target) }).run();
  }

  /**
   * Closes every gather whose upstream nodes have nothing open left: the answers its items carry
   * from the previous step (each item's result node before it; batch answers once, from their first item) become outputs.<gather> = { parts,
   * count, failed } on one item, which leaves through "out"; the others end at the gather.
   * True when one closed.
   */
  private closeGathers(run: Run, gathers: GatherNode[]) {
    const open = this.openByNode(run.id);
    const upstream = this.upstream(run);
    let closed = false;
    for (const gather of gathers) {
      if (!(open.get(gather.id) ?? 0)) continue;
      const before = [...(upstream.get(gather.id) ?? [])].filter((id) => id !== gather.id);
      if (before.some((id) => (open.get(id) ?? 0) > 0)) continue;
      this.db.transaction((tx) => {
        const items = tx.select().from(s.runItems).where(and(eq(s.runItems.runId, run.id), eq(s.runItems.nodeId, gather.id), eq(s.runItems.state, 'queued'))).orderBy(asc(sql`rowid`)).all();
        const { fields } = gather.config;
        // Each item's previous step: the result node before the gather on its way here.
        const parts = items.flatMap((item) => {
          const from = previousStepId(run.definition, item.data.path);
          const output = from ? item.data.outputs?.[from] : undefined;
          if (!output || (output as { batchLeader?: boolean }).batchLeader === false) return [];
          const { batchLeader: _leader, ...answer } = output as Record<string, unknown>;
          return [pickPaths(answer, fields)];
        });
        // Items that ended failed on the way here: a condition after the gather can stop on them.
        const failed = tx.select({ count: count() }).from(s.runItems).where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'failed'), inArray(s.runItems.nodeId, before.length ? before : ['']))).get()!.count;
        const [carrier, ...rest] = items;
        if (!carrier) return;
        for (const item of rest)
          tx.update(s.runItems).set({ state: 'done', data: { ...item.data, path: [...item.data.path, { nodeId: gather.id, port: 'gathered', at: Date.now() }].slice(-200) } }).where(eq(s.runItems.id, item.id)).run();
        this.record(tx, run, carrier, { port: 'out', output: { parts, count: parts.length, failed, batchLeader: true } });
      });
      closed = true;
    }
    return closed;
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

  /** Failed steps per run that a 재요청 node takes back: they do not count toward 연속 실패. */
  private retriedSteps = new Map<string, Set<string>>();
  /** Requests in flight per run and node: how many of a node's batches are being worked on at once. */
  private callsByNode = new Map<string, Map<string, number>>();

  /** Requests in flight per node of a run (only nodes with one). */
  liveCalls(runId: string): Record<string, number> {
    return Object.fromEntries([...(this.callsByNode.get(runId) ?? [])].filter(([, count]) => count > 0));
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
  private queuedInstant(run: Run, slowIds: string[], limit: number) {
    const conditions = [eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued')];
    if (slowIds.length) conditions.push(notInArray(s.runItems.nodeId, slowIds));
    return this.db.select().from(s.runItems).where(and(...conditions)).limit(limit).all();
  }

  /** Queued lines at slow nodes, light rows in script order (scene order, then line order). */
  private waiting(run: Run, slowIds: string[]): Waiting[] {
    if (!slowIds.length) return [];
    const now = new Date();
    if (run.subject === 'terms') return waitingTerms(this.db, run.id, slowIds, now);
    return this.db
      .select({
        id: s.runItems.id,
        unitId: s.runItems.subjectId,
        nodeId: s.runItems.nodeId,
        groupId: s.units.groupId,
        seq: s.units.seq,
        kind: s.units.kind,
        // estimateTokens without loading the text: UTF-8 bytes / 4.
        tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4`,
        since: s.runItems.updatedAt,
        plan: s.runItems.plan,
        factor: RETRY_FACTOR,
        model: RETRY_MODEL,
      })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.subjectId))
      .where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued'), inArray(s.runItems.nodeId, slowIds), or(isNull(s.runItems.notBefore), lte(s.runItems.notBefore, now))))
      .orderBy(asc(s.units.seq))
      .all();
  }

  private advance(run: Run): boolean {
    const slowIds = run.definition.nodes.filter(isAsync).map((node) => node.id);
    const gathers = run.definition.nodes.filter((node): node is GatherNode => node.type === 'gather');
    // Instant nodes settle first, possibly several hops, before slow work is handed out; a bounded
    // number per tick so a 50,000-line run never holds the event loop. Items at a gather wait for it.
    let changed = false;
    let settled = 0;
    const touched = new Set<Topic>();
    while (settled < SETTLE_PER_TICK) {
      const instant = this.queuedInstant(run, [...slowIds, ...gathers.map((node) => node.id)], SETTLE_PER_TICK - settled);
      if (!instant.length) break;
      for (const topic of this.settle(run, instant)) touched.add(topic);
      settled += instant.length;
      changed = true;
    }
    if (settled >= SETTLE_PER_TICK) {
      this.notify(run.id, ...touched);
      return true;
    }
    // A gather whose upstream is done closes now; its one item moves on with the next tick's instant pass.
    if (gathers.length && this.closeGathers(run, gathers)) {
      this.notify(run.id, ...touched);
      return true;
    }

    // Slots: an AI node sends up to its own 동시 처리 수 at once (other runs and chats do not count);
    // an HTTP or script node sends up to its own. A full node does not hold up the others.
    const busy = this.inflight.get(run.id)?.size ?? 0;
    const canSend = (node: WorkflowNode) => {
      const limit = node.type === 'ai' ? node.config.concurrency : node.type === 'function' ? node.config.concurrency : 1;
      return (this.callsByNode.get(run.id)?.get(node.id) ?? 0) < limit;
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
      } else {
        // Lines held by a 재요청 node's wait: nothing to do until the first is due.
        const due = this.db
          .select({ at: sql<number>`min(${s.runItems.notBefore})` })
          .from(s.runItems)
          .where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued'), gt(s.runItems.notBefore, new Date())))
          .get()?.at;
        if (due) this.sleepUntil(run.id, due);
        if (changed) this.notify(run.id, ...touched);
      }
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
      const before = [...(upstream.get(nodeId) ?? [])].filter((id) => id !== nodeId);
      // Lines a 재요청 node sent back are batched apart from the others, by a smaller budget (their factor), and apart by the model they will go to.
      for (const sized of Map.groupBy(lines, (line) => `${line.factor}|${line.model ?? ''}`).values()) {
        const config = node.type === 'ai' ? scaleBatch(runBatch(run, node), sized[0]!.factor) : null;
        let batches: Waiting[][];
        if (!config) batches = sized.map((line) => [line]);
        else if (sized.every((line) => line.plan !== null)) {
          const groups = [...Map.groupBy(sized, (line) => line.plan!).entries()];
          const ready = groups.filter(([plan, members]) => stale(members) || !before.some((id) => (openByPlan.get(`${plan}|${id}`) ?? 0) > 0));
          batches = packGroups(ready.map(([, members]) => members), config);
        } else batches = planBatches(sized, config);
        for (const [index, batch] of batches.entries()) {
          const tokens = () => batch.reduce((sum, line) => sum + lineCostIn(config?.mode ?? 'group')(line), 0);
          // A full request: "count" by its line count, the others by tokens (no line-count cap).
          const complete = !config || config.mode === 'unit' || (config.mode === 'count' ? batch.length >= config.size : tokens() >= batchTokens(config));
          const target = index < batches.length - 1 || complete ? full : short;
          if (target === short && before.some((id) => (open.get(id) ?? 0) > 0) && !stale(batch)) continue;
          if (!target.has(nodeId)) target.set(nodeId, { node, requests: [] });
          target.get(nodeId)!.requests.push(batch);
        }
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
          this.dispatch(run, queue.node, queue.requests.shift()!);
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
      const same = lines.filter((line) => line.factor === lines[0]!.factor && line.model === lines[0]!.model);
      const config = node.type === 'ai' ? scaleBatch(runBatch(run, node), lines[0]!.factor) : null;
      const first = config ? (packGroups([...Map.groupBy(same, (line) => line.plan ?? -1).values()], config)[0] ?? []) : same.slice(0, 1);
      if (first.length && canSend(node)) {
        this.dispatch(run, node, first);
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
      if (run.subject === 'terms') {
        const { terms, tagsOf } = loadTerms(tx, items.map((item) => item.subjectId));
        for (const item of items) {
          const node = this.node(run, item.nodeId);
          const term = terms.get(item.subjectId);
          if (!node || !term) {
            tx.update(s.runItems).set({ state: 'failed', error: '노드 또는 용어가 없습니다.' }).where(eq(s.runItems.id, item.id)).run();
            continue;
          }
          this.runInstant(tx, run, node, item, termInput(run, item, term, tagsOf(term.id)));
        }
        return;
      }
      const unitRows = new Map(inChunks(items.map((item) => item.subjectId), (ids) => tx.select().from(s.units).where(inArray(s.units.id, ids)).all()).map((unit) => [unit.id, unit]));
      const tagRows = Map.groupBy(inChunks([...unitRows.keys()], (ids) => tx.select().from(s.unitTags).where(inArray(s.unitTags.unitId, ids)).all()), (row) => row.unitId);
      for (const item of items) {
        const node = this.node(run, item.nodeId);
        const unit = unitRows.get(item.subjectId);
        if (!node || !unit) {
          tx.update(s.runItems).set({ state: 'failed', error: '노드 또는 원문이 없습니다.' }).where(eq(s.runItems.id, item.id)).run();
          continue;
        }
        this.runInstant(tx, run, node, item, { subject: 'lines', unit, item, tagIds: (tagRows.get(unit.id) ?? []).map((row) => row.tagId), projectId: run.projectId, runId: run.id });
      }
    });
    return topics;
  }

  private runInstant(tx: Tx, run: Run, node: WorkflowNode, item: Item, input: FunctionInput) {
    switch (node.type) {
      case 'entry':
        return this.route(tx, run, item, 'out');
      case 'end':
        return tx.update(s.runItems).set({ state: 'done' }).where(eq(s.runItems.id, item.id)).run();
      case 'condition': {
        const common = { visits: item.visits, outputs: item.data.outputs ?? {}, issues: item.data.issues ?? [], error: item.data.error ?? null };
        let data: ConditionData;
        if (input.subject === 'terms') data = { ...common, candidate: item.data.candidateText ?? (input.term.target || null), term: termCondition(input.term, input.tagIds) };
        else {
          const unit = input.unit;
          const finalStatus = tx.select({ kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.id, unit.statusId)).get()?.kind === 'final';
          const rules = tx.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, run.projectId)).get()?.rules;
          const marks = lineMarksOf(unit, finalStatus, rules);
          data = { ...common, candidate: item.data.candidateText ?? unit.translation, unit: { kind: unit.kind, speaker: unit.speaker, listener: unit.listener, statusId: unit.statusId, tagIds: input.tagIds, marks } };
        }
        try {
          return this.route(tx, run, item, jsonLogic.apply(node.config.expression as jsonLogic.RulesLogic, data) ? 'true' : 'false');
        } catch (error) {
          return this.route(tx, run, item, 'error', `조건식 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      case 'retry': {
        // Sent back while the failure is one of its kinds and the node's times are not used up; else on through
        // its error exit (the next 재요청 node of a chain, or the workflow's failure path), untouched.
        if (!this.accepts(node, item)) return this.route(tx, run, item, 'error');
        const error = item.data.error!;
        const { wait } = node.config;
        // The AI node the lines go back to, and the model they go on there (none picked: that node's own).
        const target = run.definition.edges.find((edge) => edge.source === node.id && edge.sourceHandle === 'retry')?.target;
        const picked = retryModel(node);
        const retry: NonNullable<ItemData['retry']> = {
          times: { ...item.data.retry?.times, [node.id]: (item.data.retry?.times[node.id] ?? 0) + 1 },
          factor: (item.data.retry?.factor ?? 1) * node.config.scale,
          last: { kind: error.kind, message: error.message, nodeId: node.id, ...(wait > 0 && { waitSeconds: wait }) },
          ...(picked && target && { model: { nodeId: target, key: choiceKey(picked) } }),
        };
        return this.route(tx, run, { ...item, data: { ...item.data, retry } }, 'retry', undefined, undefined, wait > 0 ? Date.now() + wait * 1000 : undefined);
      }
      case 'function': {
        if (!functionTakes(node.config.fn, run.subject)) return this.route(tx, run, item, 'error', unsupported(run.definition, node, run.subject), 'unsupported');
        const fn = syncFunctions[node.config.fn as FunctionName];
        if (!fn) return this.route(tx, run, item, 'error', `알 수 없는 함수입니다: ${node.config.fn}`);
        try {
          return this.record(tx, run, item, fn(tx, node.config.params, input));
        } catch (error) {
          return this.route(tx, run, item, 'error', error instanceof Error ? error.message : String(error));
        }
      }
      default:
        return this.route(tx, run, item, 'error', '즉시 실행할 수 없는 노드입니다.');
    }
  }

  /** Whether a 재요청 node sends the item back: its failure is one of the node's kinds and the item has not used up the node's times. */
  private accepts(node: RetryNode, item: Item) {
    return Boolean(item.data.error && node.config.kinds.includes(item.data.error.kind) && (item.data.retry?.times[node.id] ?? 0) < node.config.maxTimes);
  }

  private dispatch(run: Run, node: WorkflowNode, lines: Waiting[]) {
    const ids = lines.map((line) => line.id);
    const byId = new Map(this.db.select().from(s.runItems).where(inArray(s.runItems.id, ids)).all().map((item) => [item.id, item]));
    const batch = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    this.db.update(s.runItems).set({ state: 'running' }).where(inArray(s.runItems.id, ids)).run();
    let controller = this.aborts.get(run.id);
    if (!controller || controller.signal.aborted) this.aborts.set(run.id, (controller = new AbortController()));
    const set = this.inflight.get(run.id) ?? new Set();
    this.inflight.set(run.id, set);
    // Lines sent back on a model of a 재요청 node go together on that model (the batches were grouped by it).
    const modelKey = node.type === 'ai' ? (lines[0]?.model ?? choiceKey(node.config.model)) : null;
    const byNode = this.callsByNode.get(run.id) ?? new Map<string, number>();
    this.callsByNode.set(run.id, byNode);
    byNode.set(node.id, (byNode.get(node.id) ?? 0) + 1);
    const work = node.type === 'ai' ? this.executeAi(run, node, modelKey!, batch, controller.signal) : this.executeFunction(run, node as FunctionNode, batch[0], controller.signal);
    const task = work.finally(() => {
      set.delete(task);
      byNode.set(node.id, (byNode.get(node.id) ?? 1) - 1);
    });
    set.add(task);
  }

  private async executeFunction(run: Run, node: FunctionNode, item: Item, signal: AbortSignal) {
    const startedAt = new Date();
    const step: StepRecord = { runId: run.id, nodeId: node.id, subjectIds: [item.subjectId], startedAt };
    let input: FunctionInput;
    if (run.subject === 'terms') {
      const { terms, tagsOf } = loadTerms(this.db, [item.subjectId]);
      const term = terms.get(item.subjectId);
      if (!term) return this.failBatch(run, [item], step, new Error('용어가 없습니다.'));
      input = termInput(run, item, term, tagsOf(term.id));
    } else {
      const unit = this.db.select().from(s.units).where(eq(s.units.id, item.subjectId)).get();
      if (!unit) return this.failBatch(run, [item], step, new Error('원문이 없습니다.'));
      const tagIds = this.db.select({ tagId: s.unitTags.tagId }).from(s.unitTags).where(eq(s.unitTags.unitId, unit.id)).all().map((row) => row.tagId);
      input = { subject: 'lines', unit, item, tagIds, projectId: run.projectId, runId: run.id };
    }
    // Like an AI node's input: the result of the step before it on the item's way here.
    const previousStep = previousStepId(run.definition, item.data.path);
    if (previousStep) input = { ...input, previous: item.data.outputs?.[previousStep] as Record<string, unknown> | undefined };
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
    if (!model) return this.failBatch(run, batch, { runId: run.id, nodeId: node.id, subjectIds: batch.map((item) => item.subjectId), startedAt: new Date() }, new Error('이 노드의 AI 연결이 실행을 시작할 때 없었습니다. 노드에서 연결과 모델을 다시 고르고 새로 실행하세요.'));
    const route = resolveRoute(model, this.secrets);
    if (route.kind === 'systemone') {
      if (run.subject !== 'lines') return this.failBatch(run, batch, { runId: run.id, nodeId: node.id, subjectIds: batch.map((item) => item.subjectId), startedAt: new Date() }, new Error('System One 연결은 대사 워크플로에서만 쓸 수 있습니다.'));
      return this.judgeLines(run, node, batch, route, signal);
    }
    await this.callLines(run, node, model, route, batch, signal);
  }

  /** The lines of `items` as the prompt numbers them, in batch (script) order. */
  private promptLines(items: Item[], definition: WorkflowDefinition, node?: AiNode) {
    const units = new Map(this.db.select().from(s.units).where(inArray(s.units.id, items.map((item) => item.subjectId))).all().map((unit) => [unit.id, unit]));
    const rows = items.map((item) => units.get(item.subjectId)!);
    const lines: PromptLine[] = items.map((item, index) => {
      const unit = units.get(item.subjectId)!;
      const previous = previousOf(item, definition, node);
      return {
        id: promptLineId(index),
        unitId: unit.id,
        groupId: unit.groupId,
        key: unit.key,
        kind: unit.kind,
        speaker: unit.speaker,
        source: unit.source,
        candidate: item.data.candidateText ?? unit.translation ?? undefined,
        issues: item.data.issues,
        ...(previous !== undefined && { previous }),
      };
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

  /**
   * One model request for `items`, recorded as its own step. Answered lines move on at once; a line
   * a per-line answer left out (or answered empty) leaves through "error" with kind "missing", and a
   * failed request sends all its lines there with the failure's kind (errorKindOf).
   */
  private async callLines(run: Run, node: AiNode, model: s.AiSnapshot, route: ai.ResolvedRoute, items: Item[], signal: AbortSignal): Promise<void> {
    const project = this.db.select().from(s.projects).where(eq(s.projects.id, run.projectId)).get()!;
    // Terms: the term items and the context their example lines call for (engine/subjects.ts).
    const terms = run.subject === 'terms' ? termPrompt(this.db, run.projectId, items, node) : null;
    const { rows, lines } = terms ? { rows: [], lines: withPrevious(terms.lines, items, run.definition, node) } : this.promptLines(items, run.definition, node);
    const round = Math.max(0, ...items.map((item) => Object.values(item.data.retry?.times ?? {}).reduce((sum, n) => sum + n, 0)));
    const step: StepRecord = { runId: run.id, nodeId: node.id, connectionId: route.connectionId ?? null, model: route.model, subjectIds: items.map((item) => item.subjectId), startedAt: new Date(), round };
    const languages = { source: project.sourceLanguage, target: project.targetLanguage };
    const choiceOptions = node.config.output === 'choice' ? resolveChoiceOptions(this.db, run.projectId, node.config.choice) : undefined;
    // A node reading the script whole sends it as compact script text (engine/whole-script.ts), its
    // lines numbered L1…; every other node gets the batch prompt with the context it asks for.
    const whole = !terms && node.config.batch.mode === 'whole' ? wholeScriptRequest(this.db, run.projectId, node, languages, rows, choiceOptions) : null;
    let built: { system: string; prompt: string };
    if (whole) {
      for (const line of lines) line.id = whole.idOf.get(line.key) ?? line.id;
      step.context = whole.context.items;
      built = whole;
    } else {
      // A request that reads earlier results instead of lines (a merge) asks about the people those results name.
      const parts = !node.config.input.lines && node.config.input.previous ? JSON.stringify(lines.flatMap((line) => (line.previous === undefined ? [] : [line.previous]))) : undefined;
      const context = terms?.context ?? buildContext(this.db, run.projectId, rows, node.config.context, parts, parts !== undefined && node.config.context.pairs ? runPairLines(this.db, run.id) : undefined);
      step.context = context.items;
      built = buildPrompt(node, languages, context, lines, choiceOptions);
    }
    const { system, prompt } = built;
    const perLine = !isBatchScope(node);
    const timeoutMs = node.config.timeoutMinutes * 60_000;
    const request = { system, prompt, schema: outputSchema(node, perLine && !whole ? lines.map((line) => line.id) : undefined, choiceOptions), maxOutputTokens: model.maxOutputTokens, temperature: node.config.temperature, timeoutMs, signal };
    step.prompt = `${system}\n\n${prompt}`;
    // The input cap is checked before sending, counting calls still in flight, so a run stops short
    // of it instead of finding out afterwards (several calls at once could overshoot by a lot).
    // Plus what the connection adds to every request (tool and system preamble, measured from past calls, as the run dialog's estimate does).
    const estimate = estimateTokens(step.prompt) + this.overheadFor(run.id, step.connectionId ?? null);
    const over = this.overInputCap(run.id, estimate);
    if (over) {
      this.halt(run.id, over, 'input');
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
      // Whole-script reads are logged as such: their pace (minutes per script) would skew the run estimates.
      const call = { projectId: run.projectId, kind: whole ? ('whole' as const) : ('run' as const), refId: run.id, label: `${runNodeName(run.definition, node)} · ${items.length.toLocaleString()}줄` };
      const result = await ai.callOnce(route, (route) => logged(this.db, call, route, () => this.model.generate(route, request)), signal).finally(release);
      const raw = result.result.object;
      const outcomes = readAiOutput(node, raw, lines, result.route.model, choiceOptions);
      const answered = outcomes.filter(Boolean).length;
      this.db.transaction((tx) => {
        items.forEach((item, index) => {
          const outcome = outcomes[index];
          if (outcome) {
            this.record(tx, run, item, outcome);
          } else this.route(tx, run, item, 'error', `모델 응답에 이 대사의 ${MISSING_WHAT[node.config.output]}이(가) 없습니다.`, 'missing');
        });
        tx.insert(s.runSteps)
          .values({ ...step, ok: true, connectionId: result.route.connectionId ?? step.connectionId, model: result.route.model, output: raw, attempts: result.attempts, returnedItems: perLine ? answered : null, ...usageColumns(stepUsage(result.attempts, result.result.usage)), finishedAt: new Date() })
          .run();
      });
      this.notify(run.id);
      this.guard(run.id);
    } catch (error) {
      if (signal.aborted) return;
      this.failBatch(run, items, { ...step, attempts: attemptsOf(error) }, error);
    }
  }

  /** A judge model (System One) answers one line at a time and only supports verdicts. */
  private async judgeLines(run: Run, node: AiNode, batch: Item[], route: ai.ResolvedRoute, signal: AbortSignal) {
    const step: StepRecord = { runId: run.id, nodeId: node.id, connectionId: route.connectionId ?? null, model: route.model, subjectIds: batch.map((item) => item.subjectId), startedAt: new Date() };
    if (node.config.output !== 'verdict') return this.failBatch(run, batch, step, new Error('System One 연결은 출력 형태가 "판정"인 AI 노드에서만 쓸 수 있습니다.'));
    const { rows, lines } = this.promptLines(batch, run.definition, node);
    const context = buildContext(this.db, run.projectId, rows, node.config.context);
    step.context = context.items;
    try {
      const outcomes: Outcome[] = [];
      let attempts: ai.Attempt[] = [];
      const judged: ai.Usage[] = [];
      for (const line of lines) {
        const outcome = await ai.callOnce(
          route,
          (route) =>
            logged(this.db, { projectId: run.projectId, kind: 'run', refId: run.id, label: `${runNodeName(run.definition, node)} · 판정 1줄` }, route, () => this.model.judge(route, {
              state: { source: line.source, translation: line.candidate ?? '', speaker: line.speaker, context: { scene: context.scenes[line.groupId] ?? null, characters: context.characters, glossary: context.terms } },
              instructions: node.config.instructions.trim() || 'Is this translation acceptable as is?',
              timeoutMs: node.config.timeoutMinutes * 60_000,
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
          .values({ ...step, ok: true, model: route.model, prompt: null, output: outcomes, attempts, returnedItems: outcomes.length, ...usageColumns(stepUsage(attempts, judged.reduce(ai.addUsage, {}))), finishedAt: new Date() })
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
  /** Every line of a failed call leaves through `error`; the call is recorded with whatever usage the connection reported. */
  private failBatch(run: Run, batch: Item[], step: StepRecord, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const usage = stepUsage(attemptsOf(error), (error as { usage?: ai.Usage }).usage);
    const kind = errorKindOf(error);
    const stepId = crypto.randomUUID();
    this.db.transaction((tx) => {
      for (const item of batch) this.route(tx, run, item, 'error', message, kind);
      tx.insert(s.runSteps).values({ ...step, id: stepId, ok: false, error: message, errorKind: kind, ...usageColumns(usage), finishedAt: new Date() }).run();
    });
    if (this.takenBack(run, step.nodeId, batch, kind)) this.retriedSteps.set(run.id, (this.retriedSteps.get(run.id) ?? new Set()).add(stepId));
    this.notify(run.id);
    this.guard(run.id, { code: (error as { code?: string }).code, message });
  }

  /**
   * Whether every one of these lines (as they were before this failure) is sent back by the 재요청 nodes
   * after `nodeId`'s error exit, for a failure of `kind`: the first node of the chain takes it, or else the next one, and so on.
   */
  private takenBack(run: Run, nodeId: string, batch: Item[], kind: ItemErrorKind) {
    return batch.every((item) => {
      const seen = new Set<string>();
      for (let from = nodeId; ; ) {
        const next = this.node(run, run.definition.edges.find((edge) => edge.source === from && edge.sourceHandle === 'error')?.target ?? '');
        if (next?.type !== 'retry' || seen.has(next.id)) return false;
        seen.add(next.id);
        if (this.accepts(next, { ...item, data: { ...item.data, error: { kind, message: '', nodeId } } })) return true;
        from = next.id;
      }
    });
  }
}
