import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import jsonLogic from 'json-logic-js';
import * as ai from '@tw/ai';
import { batchConfigSchema, FUNCTIONS, nodeName, nodeProfileIds, type AiNode, type ConditionData, type FunctionName, type FunctionNode, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import { inChunks, inList } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData, ItemState } from '../db/schema.ts';
import { events, type Topic } from '../events.ts';
import { buildContext } from '../services/context.ts';
import { resolveRoutes } from '../services/routes.ts';
import { knownListener } from '../services/speech.ts';
import type { SecretStore } from '../services/secrets.ts';
import { runAsyncFunction, syncFunctions, type FunctionInput, type FunctionResult } from './functions/index.ts';
import { packGroups, planBatches } from './batches.ts';
import { buildPrompt, outputSchema, PER_LINE_OUTPUTS, type KnowledgeOutput, type PromptLine } from './prompts.ts';

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
type Waiting = { id: string; unitId: string; nodeId: string; groupId: string; seq: number; tokens: number; since: Date; plan: number | null };

/** Functions that write beyond the line itself, and the change topic they touch. */
const FUNCTION_TOPICS: Record<string, Topic> = { addTerms: 'terms', applyKnowledge: 'knowledge' };
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
const MISSING_WHAT: Record<AiNode['config']['output'], string> = { candidate: '번역', verdict: '판정', listener: '청자', json: '결과', terms: '용어', knowledge: '자료' };
const attemptsOf = (error: unknown): ai.Attempt[] => ((error as { attempts?: ai.Attempt[] }).attempts ?? []);

/** A node's result for one line: the exit to take plus what it produced. */
interface Outcome extends FunctionResult {
  /** Candidate provenance when `candidate` is set. */
  origin?: 'ai' | 'tool';
  profileId?: string;
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
    this.db.update(s.runs).set({ status: 'running', notice: null }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'paused'))).run();
    this.notify(runId);
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
    const run = this.db.select({ status: s.runs.status, definition: s.runs.definition, limits: s.runs.limits }).from(s.runs).where(eq(s.runs.id, runId)).get();
    if (run?.status !== 'running') return;
    const stopping = failure?.code ? STOPPING_CODES[failure.code] : undefined;
    if (stopping) return this.halt(runId, `${stopping}로 멈췄습니다: ${failure!.message}`);
    const max = run.definition.settings.maxConsecutiveFailures ?? 3;
    // Insertion order, not finished_at: calls that end in the same millisecond must not swap places.
    const recent = this.db.select({ ok: s.runSteps.ok }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).orderBy(desc(sql`rowid`)).limit(max).all();
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
        .values({ id: candidateId, unitId: item.unitId, text: outcome.candidate, origin, profileId: outcome.profileId, model: outcome.model, runId: run.id, nodeId: item.nodeId })
        .run();
      data.candidateId = candidateId;
      data.candidateText = outcome.candidate;
      data.issues = []; // a new candidate answers the previous issues
    }
    if (outcome.issues?.length) data.issues = outcome.issues;
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

  /** The account a profile's calls count against: its primary route's connection. */
  private accountOfProfile(run: Run, profileId: string) {
    return run.profiles[profileId]?.routes[0]?.connectionId ?? null;
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
      if (node.type === 'ai') return this.freeProfile(run, node, accounts) !== null;
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
        const complete = !config || config.mode === 'unit' || batch.length >= config.size || (config.mode === 'group' && batch.reduce((sum, line) => sum + line.tokens, 0) >= config.maxTokens);
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
      const topic = node?.type === 'function' ? FUNCTION_TOPICS[node.config.fn] : undefined;
      if (topic) topics.add(topic);
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
        const data: ConditionData = {
          visits: item.visits,
          outputs: item.data.outputs ?? {},
          candidate: item.data.candidateText ?? unit.translation,
          issues: item.data.issues ?? [],
          unit: { kind: unit.kind, speaker: unit.speaker, statusId: unit.statusId, tagIds },
          listenerKnown: unit.kind !== 'dialogue' || knownListener(unit) !== null,
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
   * The profile an AI node's next request goes to: of the node's profiles whose account has a free
   * slot, the one with the most room left (so work spreads over the accounts). Null when none has.
   */
  private freeProfile(run: Run, node: AiNode, accounts: Map<string, number>) {
    let best: { profileId: string; room: number } | null = null;
    for (const profileId of nodeProfileIds(node)) {
      const account = this.accountOfProfile(run, profileId);
      // A profile without a connection (missing from the snapshot) fails the request visibly.
      const room = account ? (accounts.get(account) ?? 2) - (this.callsByAccount.get(account) ?? 0) : 1;
      if (room > 0 && (!best || room > best.room)) best = { profileId, room };
    }
    return best?.profileId ?? null;
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
    const profileId = node.type === 'ai' ? (this.freeProfile(run, node, accounts) ?? node.config.profileId) : null;
    const account = profileId ? this.accountOfProfile(run, profileId) : null;
    const counts = account ? this.callsByAccount : this.functionsByRun;
    const key = account ?? run.id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const work = node.type === 'ai' ? this.executeAi(run, node, profileId!, batch, controller.signal) : this.executeFunction(run, node as FunctionNode, batch[0], controller.signal);
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

  private async executeAi(run: Run, node: AiNode, profileId: string, batch: Item[], signal: AbortSignal) {
    const profile = run.profiles[profileId];
    if (!profile) return this.failBatch(run, batch, { runId: run.id, nodeId: node.id, unitIds: batch.map((item) => item.unitId), startedAt: new Date() }, new Error('AI 프로필이 실행 스냅샷에 없습니다.'));
    const routes = resolveRoutes(profile, this.secrets);
    if (routes[0]?.kind === 'systemone') return this.judgeLines(run, node, batch, profile, routes, signal);
    await this.callLines(run, node, profile, routes, batch, signal, 0);
  }

  /** The lines of `items` as the prompt numbers them, in batch (script) order. */
  private promptLines(items: Item[]) {
    const units = new Map(this.db.select().from(s.units).where(inArray(s.units.id, items.map((item) => item.unitId))).all().map((unit) => [unit.id, unit]));
    const rows = items.map((item) => units.get(item.unitId)!);
    const lines: PromptLine[] = items.map((item, index) => {
      const unit = units.get(item.unitId)!;
      return { id: String(index + 1), unitId: unit.id, groupId: unit.groupId, key: unit.key, speaker: unit.speaker, source: unit.source, candidate: item.data.candidateText ?? unit.translation ?? undefined, issues: item.data.issues };
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
  private async callLines(run: Run, node: AiNode, profile: s.ProfileSnapshot, routes: ai.ResolvedRoute[], items: Item[], signal: AbortSignal, depth: number): Promise<void> {
    const project = this.db.select().from(s.projects).where(eq(s.projects.id, run.projectId)).get()!;
    const { rows, lines } = this.promptLines(items);
    const round = Math.max(0, ...items.map((item) => item.data.retries?.[node.id] ?? 0));
    const step: StepRecord = { runId: run.id, nodeId: node.id, unitIds: items.map((item) => item.unitId), startedAt: new Date(), round };
    const context = buildContext(this.db, run.projectId, rows, node.config.context);
    step.context = context.items;
    const { system, prompt } = buildPrompt(node, profile.instructions, { source: project.sourceLanguage, target: project.targetLanguage }, context, lines);
    const perLine = PER_LINE_OUTPUTS.has(node.config.output);
    const request = { system, prompt, schema: outputSchema(node, perLine ? lines.map((line) => line.id) : undefined), maxOutputTokens: profile.maxOutputTokens, temperature: profile.temperature ?? undefined, timeoutMs: profile.timeoutSeconds * 1000, signal };
    step.prompt = `${system}\n\n${prompt}`;

    try {
      const result = await ai.withFallback(routes, profile.maxAttempts, (route) => this.model.generate(route, request), signal);
      const raw = result.result.object;
      const outcomes = this.readAiOutput(node, raw, lines, profile.id, result.route.model);
      const answered = outcomes.filter(Boolean).length;
      this.db.transaction((tx) => {
        items.forEach((item, index) => {
          const outcome = outcomes[index];
          if (outcome) this.record(tx, run, item, outcome);
          else this.retryLater(tx, run, item, `모델 응답에 이 대사의 ${MISSING_WHAT[node.config.output]}이(가) 없습니다.`);
        });
        tx.insert(s.runSteps)
          .values({ ...step, ok: true, model: result.route.model, output: raw, attempts: result.attempts, returnedLines: perLine ? answered : null, ...usageColumns(stepUsage(result.attempts, result.result.usage)), finishedAt: new Date() })
          .run();
      });
      this.notify(run.id);
      this.guard(run.id);
    } catch (error) {
      if (signal.aborted) return;
      // A malformed answer or a request longer than the model's window: smaller requests may pass.
      const code = (error as { code?: string }).code;
      const splittable = code === 'invalid-output' || code === 'too-long';
      if (!(splittable && items.length > 1 && depth < MAX_SPLITS)) return this.failBatch(run, items, { ...step, attempts: attemptsOf(error) }, error);
      // Record the failed request, then try each half on its own.
      const message = error instanceof Error ? error.message : String(error);
      this.db.insert(s.runSteps).values({ ...step, ok: false, error: `${message} (반으로 나눠 다시 보냄)`, attempts: attemptsOf(error), ...usageColumns(stepUsage(attemptsOf(error), (error as { usage?: ai.Usage }).usage)), finishedAt: new Date() }).run();
      this.guard(run.id, { code, message });
      const half = Math.ceil(items.length / 2);
      for (const part of [items.slice(0, half), items.slice(half)]) {
        if (!this.stillRunning(run.id, part)) return;
        await this.callLines(run, node, profile, routes, part, signal, depth + 1);
      }
    }
  }

  /** A judge model (System One) answers one line at a time and only supports verdicts. */
  private async judgeLines(run: Run, node: AiNode, batch: Item[], profile: s.ProfileSnapshot, routes: ai.ResolvedRoute[], signal: AbortSignal) {
    const step: StepRecord = { runId: run.id, nodeId: node.id, unitIds: batch.map((item) => item.unitId), startedAt: new Date() };
    if (node.config.output !== 'verdict') return this.failBatch(run, batch, step, new Error('System One 프로필은 출력 형태가 "판정"인 AI 노드에서만 쓸 수 있습니다.'));
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
          profile.maxAttempts,
          (route) =>
            this.model.judge(route, {
              state: { source: line.source, translation: line.candidate ?? '', speaker: line.speaker, context: { scene: context.scenes[line.groupId] ?? null, characters: context.characters, glossary: context.terms } },
              instructions: [node.config.instructions, profile.instructions].filter(Boolean).join('\n') || 'Is this translation acceptable as is?',
              timeoutMs: profile.timeoutSeconds * 1000,
              signal,
            }),
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
  private readAiOutput(node: AiNode, raw: unknown, lines: PromptLine[], profileId: string, model: string): (Outcome | null)[] {
    const missing = (_what: string) => null;
    const value = raw as { translations?: { id: string; text: string }[]; results?: ({ id: string } & Record<string, unknown>)[]; terms?: unknown[]; listeners?: { id: string; listener: unknown; confidence: unknown }[] };
    switch (node.config.output) {
      case 'candidate':
        return lines.map((line) => {
          const text = value.translations?.find((entry) => entry.id === line.id)?.text;
          return text === undefined || !text.trim() ? missing('번역') : { port: 'out', candidate: text, origin: 'ai', profileId, model, output: { text } };
        });
      case 'verdict':
        return lines.map((line) => {
          const result = value.results?.find((entry) => entry.id === line.id) as { passed: boolean; issues: string[] } | undefined;
          if (!result) return missing('판정');
          return { port: result.passed ? 'pass' : 'fail', issues: result.passed ? undefined : result.issues, output: { passed: result.passed, issues: result.issues } };
        });
      case 'terms':
        // Terms describe the whole batch; every line carries them so later nodes and scripts can read them.
        return lines.map(() => ({ port: 'out', output: { terms: value.terms ?? [] } }));
      case 'knowledge': {
        // Like terms, the change set describes the whole batch; line ids become line keys so it outlives the prompt.
        const keyOf = new Map(lines.map((line) => [line.id, line.key]));
        const known = (id: string | null | undefined) => (id ? (keyOf.get(id) ?? null) : null);
        const found = raw as KnowledgeOutput;
        const knowledge = {
          characters: found.characters ?? [],
          relationships: (found.relationships ?? []).map((rel) => ({ ...rel, at: known(rel.at) })),
          events: (found.events ?? []).map((event) => ({ ...event, evidence: event.evidence.flatMap((id) => (keyOf.get(id) ? [keyOf.get(id)!] : [])) })),
          speechRules: (found.speechRules ?? []).map((rule) => ({ ...rule, start: known(rule.start) })),
        };
        return lines.map(() => ({ port: 'out', output: { knowledge } }));
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
  if (statusIds.length && !scope.ignoreStatus) conditions.push(inArray(s.units.statusId, statusIds));
  // A scope can name every line of a large project; long lists travel as one JSON parameter.
  if (scope.groupIds?.length) conditions.push(inList(s.units.groupId, scope.groupIds));
  if (scope.unitIds?.length) conditions.push(inList(s.units.id, scope.unitIds));
  if (scope.tagIds?.length) conditions.push(inArray(s.units.id, db.select({ id: s.unitTags.unitId }).from(s.unitTags).where(inList(s.unitTags.tagId, scope.tagIds))));
  return db.select({ id: s.units.id }).from(s.units).where(and(...conditions)).all().map((row) => row.id);
}

/**
 * Direct transitions between scenes in the dialogue graph: an edge from a node of one group to a
 * node of another. Links through hubs (nodes outside every scene) are left out on purpose: a menu
 * or return point would otherwise make every scene "related" to every other.
 */
export function sceneLinks(db: Db | Tx, lines: { groupId: string }[]) {
  const groups = [...new Set(lines.map((line) => line.groupId))];
  const pairs = new Set<string>();
  if (groups.length > 1) {
    const fromNode = alias(s.graphNodes, 'from_node');
    const toNode = alias(s.graphNodes, 'to_node');
    const rows = db
      .selectDistinct({ from: fromNode.groupId, to: toNode.groupId })
      .from(s.graphEdges)
      .innerJoin(fromNode, eq(fromNode.id, s.graphEdges.fromId))
      .innerJoin(toNode, eq(toNode.id, s.graphEdges.toId))
      .where(and(inList(fromNode.groupId, groups), sql`${fromNode.groupId} <> ${toNode.groupId}`))
      .all();
    for (const row of rows) if (row.from && row.to) pairs.add(`${row.from}|${row.to}`);
  }
  return (a: string, b: string) => pairs.has(`${a}|${b}`);
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
  const lines = inChunks(unitIds, (ids) =>
    db
      .select({ id: s.units.id, groupId: s.units.groupId, seq: s.units.seq, kind: s.units.kind, speaker: s.units.speaker, tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4` })
      .from(s.units)
      .where(inArray(s.units.id, ids))
      .all(),
  );
  const batches = planBatches(lines, batchConfigSchema.parse(first.config.batch ?? {}), sceneLinks(db, lines));
  return new Map(batches.flatMap((batch, index) => batch.map((line) => [line.id, index] as const)));
}

export function createRun(db: Db, input: { projectId: string; workflow: typeof s.workflows.$inferSelect; profiles: Record<string, s.ProfileSnapshot>; scope: s.RunScope; limits?: s.RunLimits }) {
  const entry = input.workflow.definition.nodes.find((node) => node.type === 'entry');
  if (!entry) throw new Error('진입 노드가 없습니다.');
  const unitIds = selectRunUnits(db, input.projectId, input.workflow.definition, input.scope);
  if (!unitIds.length) throw new Error('조건에 맞는 대사가 없습니다.');
  const runId = crypto.randomUUID();
  db.transaction((tx) => {
    tx.insert(s.runs)
      .values({
        id: runId,
        projectId: input.projectId,
        workflowId: input.workflow.id,
        workflowName: input.workflow.name,
        workflowVersion: input.workflow.version,
        definition: input.workflow.definition,
        profiles: input.profiles,
        scope: input.scope,
        status: 'running',
        total: unitIds.length,
        limits: input.limits ?? null,
      })
      .run();
    const plan = planRun(tx, input.workflow.definition, unitIds);
    const rows = unitIds.map((unitId) => ({ runId, unitId, nodeId: entry.id, state: 'queued' as const, visits: { [entry.id]: 1 }, data: { path: [], outputs: {} } as ItemData, plan: plan.get(unitId) ?? null }));
    for (let index = 0; index < rows.length; index += 400) tx.insert(s.runItems).values(rows.slice(index, index + 400)).run();
  });
  events.changed(input.projectId, 'runs');
  return { runId, total: unitIds.length };
}
