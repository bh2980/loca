import { and, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { batchTokens, choiceKey, lineCostIn, nodeCallsOut, nodeConcurrency, type WorkflowNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { recordRunEnd } from '../services/chat-run-end.ts';
import type { SecretStore } from '../services/secrets.ts';
import { packGroups, planBatches, scaleBatch, subjectBatch } from './batches.ts';
import type { ModelPort } from './model-port.ts';
import { RunCalls } from './run-calls.ts';
import { closeUnpreparedRuns } from './run-create.ts';
import { haltRun, RunGuards } from './run-guards.ts';
import { closeGathers, settle, type GatherNode } from './run-instant.ts';
import { nodeOf, type Run } from './run-state.ts';
import { onRunWake } from './run-wake.ts';
import { subjectOf, type Waiting } from './subjects.ts';
export type { ModelPort } from './model-port.ts';

/** A partial batch waits this long for more lines from upstream before it is sent anyway. */
const GATHER_MS = 5_000;
/**
 * Instant nodes run on the server's one thread (SQLite is synchronous), so a run's tick passes lines
 * through them in transactions of SETTLE_CHUNK and stops after SETTLE_BUDGET_MS; the next tick follows
 * as soon as waiting requests and events are served. A 9,000-line run otherwise held the server up to a second.
 */
const SETTLE_CHUNK = 100;
const SETTLE_BUDGET_MS = 25;
/** The pause before that next tick: a request takes several event-loop turns, and back-to-back ticks would hold up each of them. */
const SETTLE_GAP_MS = 10;

/** For each node, every node that can reach it through the run's frozen edges. */
function upstreamOf(run: Run) {
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
  return result;
}

/**
 * Executes user workflows. One run item = one source line (or term). Items flow node to node through
 * the exits stored in the run's frozen definition. State lives in the database, so a restart resumes
 * from queued items.
 *
 * This is the scheduler: which runs tick, which lines settle at instant nodes (run-instant.ts), which
 * requests go out next and how many at once, and when a run sleeps or ends. What a node's outcome does
 * to a line is the state machine's (run-state.ts); a request itself, start to recorded outcome, is
 * run-calls.ts; what pauses a run is run-guards.ts.
 */
export class Runner {
  private timer?: NodeJS.Timeout;
  private ticking = false;
  /** A tick stopped at SETTLE_BUDGET_MS with instant work left; the next one is already queued. */
  private followUp?: NodeJS.Timeout;
  /** Requests in flight per run, each with the node it is for: how many of a node's batches are being worked on at once. Nothing is in flight after a restart. */
  private inflight = new Map<string, Set<{ nodeId: string; done: Promise<void> }>>();
  /** One abort signal per run with requests out: cancelling the run, or stopping the server, ends them. */
  private aborts = new Map<string, AbortController>();
  /** Runs with nothing to do until lines held by a retry rule's wait are due: when, and the timer that ticks then. No polling meanwhile; a restart finds the wait again in the lines' not_before. */
  private sleeping = new Map<string, { until: number; timer: NodeJS.Timeout }>();
  /** Each run's upstream nodes (upstreamOf), from its frozen edges. */
  private upstreams = new Map<string, Map<string, Set<string>>>();
  private guards: RunGuards;
  private calls: RunCalls;
  private stopHearing?: () => void;

  constructor(
    private db: Db,
    secrets: SecretStore,
    model: ModelPort = { generate: ai.generate, ask: ai.ask },
  ) {
    this.guards = new RunGuards(db);
    this.calls = new RunCalls(db, secrets, model, this.guards);
  }

  start(intervalMs = 300) {
    // What a server that stopped left behind: runs it was still storing are closed, and calls it cut off
    // are retried from the node they were waiting at.
    closeUnpreparedRuns(this.db);
    this.db.update(s.runItems).set({ state: 'queued' }).where(eq(s.runItems.state, 'running')).run();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    clearTimeout(this.followUp);
    for (const runId of [...this.sleeping.keys()]) this.wake(runId);
    for (const controller of this.aborts.values()) controller.abort();
    await Promise.allSettled(this.pending());
  }

  private pending() {
    return [...this.inflight.values()].flatMap((tasks) => [...tasks].map((task) => task.done));
  }

  /** Runs every runnable step until nothing changes. Tests call this directly. */
  async drain(maxRounds = 1000) {
    for (let round = 0; round < maxRounds; round++) {
      const active = await this.tick();
      const pending = this.pending();
      if (!active && !pending.length) return;
      await Promise.allSettled(pending);
    }
  }

  async tick(): Promise<boolean> {
    if (this.ticking) return true;
    this.ticking = true;
    try {
      let active = false;
      const running = this.db.select().from(s.runs).where(eq(s.runs.status, 'running')).all();
      for (const run of running) {
        // A run whose lines all wait for a retry rule's wait does nothing until the first is due.
        const asleep = this.sleeping.get(run.id);
        if (asleep) {
          if (asleep.until > Date.now()) continue;
          this.wake(run.id);
        }
        // One run's failure (a database error, a definition that cannot be read) pauses that run; the others go on.
        try {
          const unreadable = s.definitionProblem(run.definition);
          if (unreadable) haltRun(this.db, run.id, `이 실행의 워크플로 정의를 읽을 수 없어 멈췄습니다: ${unreadable}`);
          else active = this.advance(run) || active;
        } catch (error) {
          console.error(`[runner] run ${run.id}:`, error);
          haltRun(this.db, run.id, `실행기 오류로 멈췄습니다: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this.forgetEnded(new Set(running.map((run) => run.id)));
      return active;
    } finally {
      this.ticking = false;
    }
  }

  /** Drops what is kept in memory for runs that are no longer going and have nothing in flight; a run continued later starts these again. */
  private forgetEnded(running: Set<string>) {
    for (const runId of new Set([...this.upstreams.keys(), ...this.aborts.keys()])) {
      if (running.has(runId) || this.inflight.has(runId)) continue;
      this.upstreams.delete(runId);
      this.aborts.delete(runId);
      this.guards.forget(runId);
    }
  }

  /** Puts a run to sleep until `until` (ms): its timer ticks then. */
  private sleepUntil(runId: string, until: number) {
    const known = this.sleeping.get(runId);
    if (known?.until === until) return;
    clearTimeout(known?.timer);
    const timer = setTimeout(() => {
      this.wake(runId);
      void this.tick();
    }, Math.max(0, until - Date.now()));
    timer.unref?.();
    this.sleeping.set(runId, { until, timer });
    // While a run sleeps the runner hears runs set going outside it (continueRun): that run is taken up now, not when its wait ends.
    this.stopHearing ??= onRunWake((woken) => this.wake(woken));
  }

  private wake(runId: string) {
    clearTimeout(this.sleeping.get(runId)?.timer);
    this.sleeping.delete(runId);
    if (!this.sleeping.size) {
      this.stopHearing?.();
      this.stopHearing = undefined;
    }
  }

  pause(runId: string) {
    this.db.update(s.runs).set({ status: 'paused' }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'running'))).run();
  }

  cancel(runId: string) {
    this.aborts.get(runId)?.abort();
    this.wake(runId);
    const wasGoing = ['preparing', 'running', 'paused'].includes(this.db.select({ status: s.runs.status }).from(s.runs).where(eq(s.runs.id, runId)).get()?.status ?? '');
    this.db.transaction((tx) => {
      tx.update(s.runs).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(s.runs.id, runId)).run();
      tx.update(s.runItems)
        .set({ state: 'cancelled' })
        .where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, ['queued', 'running'])))
        .run();
    });
    if (wasGoing) recordRunEnd(this.db, runId);
  }

  /** Requests in flight per node of a run (only nodes with one). */
  liveCalls(runId: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const { nodeId } of this.inflight.get(runId) ?? []) counts[nodeId] = (counts[nodeId] ?? 0) + 1;
    return counts;
  }

  private upstream(run: Run) {
    const known = this.upstreams.get(run.id);
    if (known) return known;
    const result = upstreamOf(run);
    this.upstreams.set(run.id, result);
    return result;
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

  /** Queued lines at instant nodes (anything not slow, unknown nodes included so they fail visibly). */
  private queuedInstant(run: Run, slowIds: string[], limit: number) {
    const conditions = [eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued')];
    if (slowIds.length) conditions.push(notInArray(s.runItems.nodeId, slowIds));
    return this.db.select().from(s.runItems).where(and(...conditions)).limit(limit).all();
  }

  /** Queued items at slow nodes that are due, light rows in the subject's order (lines: script order; terms: most used first). */
  private waiting(run: Run, slowIds: string[]): Waiting[] {
    return slowIds.length ? subjectOf(run.subject).waiting(this.db, run.id, slowIds, new Date()) : [];
  }

  private advance(run: Run): boolean {
    // Nodes that call out leave the instant pass; everything else settles immediately.
    const slow = run.definition.nodes.filter(nodeCallsOut);
    const slowIds = slow.map((node) => node.id);
    const gathers = run.definition.nodes.filter((node): node is GatherNode => node.type === 'gather');
    // Instant nodes settle first, possibly several hops, before slow work is handed out; for at most
    // SETTLE_BUDGET_MS per tick, so a large run never holds the event loop. Items at a gather wait for it.
    const started = performance.now();
    for (;;) {
      const instant = this.queuedInstant(run, [...slowIds, ...gathers.map((node) => node.id)], SETTLE_CHUNK);
      if (!instant.length) break;
      settle(this.db, run, instant, started + SETTLE_BUDGET_MS);
      if (performance.now() - started >= SETTLE_BUDGET_MS) {
        // The server serves what waited, then this run goes on (not at the next interval: that would slow it).
        if (this.timer && !this.followUp) this.followUp = setTimeout(() => {
          this.followUp = undefined;
          void this.tick();
        }, SETTLE_GAP_MS);
        return true;
      }
    }
    // A gather whose upstream is done closes now; its one item moves on with the next tick's instant pass.
    if (gathers.length && closeGathers(this.db, run, gathers, this.openByNode(run.id), this.upstream(run))) return true;

    // Slots: an AI node sends up to its own 동시 처리 수 at once (other runs and chats do not count);
    // an HTTP or script node sends up to its own. A full node does not hold up the others.
    const live = this.liveCalls(run.id);
    const busy = this.inflight.get(run.id)?.size ?? 0;
    const canSend = (node: WorkflowNode) => (live[node.id] ?? 0) < (nodeCallsOut(node) ? nodeConcurrency(node) : 1);
    if (slow.length && !slow.some(canSend)) return true;

    const waiting = this.waiting(run, slowIds);
    if (!waiting.length) {
      if (busy) return true;
      // Lines marked running with no request out for them (a request that ended without a record) wait again.
      const orphaned = this.db.update(s.runItems).set({ state: 'queued' }).where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'running'))).run().changes;
      if (orphaned) return true;
      const open = this.db
        .select({ id: s.runItems.id })
        .from(s.runItems)
        .where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['queued', 'running'])))
        .limit(1)
        .all();
      if (!open.length) {
        this.db.update(s.runs).set({ status: 'completed', finishedAt: new Date() }).where(eq(s.runs.id, run.id)).run();
        recordRunEnd(this.db, run.id);
      } else {
        // Lines held by a retry rule's wait: nothing to do until the first is due.
        const due = this.db
          .select({ at: sql<number>`min(${s.runItems.notBefore})` })
          .from(s.runItems)
          .where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued'), gt(s.runItems.notBefore, new Date())))
          .get()?.at;
        if (due) this.sleepUntil(run.id, due);
      }
      return false;
    }

    // Lines move in the run plan's batches: a node sends a plan batch once none of its members can
    // still arrive from upstream, packing ready batches up to the node's limits. Full requests go
    // first; a short last one waits while upstream can still feed the node, unless it has waited
    // GATHER_MS or nothing else is running. Lines without a plan batch (terms) are batched as they wait.
    const open = this.openByNode(run.id);
    const openByPlan = this.openByPlanNode(run.id);
    const upstream = this.upstream(run);
    const now = Date.now();
    const stale = (lines: Waiting[]) => lines.some((line) => now - line.since.getTime() >= GATHER_MS);
    // Per node: full requests from plan batches that are ready (no member can still arrive from
    // upstream, or waited GATHER_MS), then a short last request if upstream cannot feed it any more.
    const full = new Map<string, { node: WorkflowNode; requests: Waiting[][] }>();
    const short = new Map<string, { node: WorkflowNode; requests: Waiting[][] }>();
    const held = new Map<string, { node: WorkflowNode; lines: Waiting[] }>();
    for (const [nodeId, lines] of Map.groupBy(waiting, (line) => line.nodeId)) {
      const node = nodeOf(run, nodeId);
      if (!node) continue;
      held.set(nodeId, { node, lines });
      const before = [...(upstream.get(nodeId) ?? [])].filter((id) => id !== nodeId);
      // Lines a retry rule sent back are batched apart from the others, by a smaller budget (their factor), and apart by the model they will go to.
      for (const sized of Map.groupBy(lines, (line) => `${line.factor}|${line.model ?? ''}`).values()) {
        const config = node.type === 'ai' ? scaleBatch(subjectBatch(run.subject, node), sized[0]!.factor) : null;
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
    const send = (node: WorkflowNode, lines: Waiting[]) => {
      this.dispatch(run, node, lines);
      live[node.id] = (live[node.id] ?? 0) + 1;
    };
    const roundRobin = (queues: Map<string, { node: WorkflowNode; requests: Waiting[][] }>) => {
      const order = [...queues.keys()].sort((a, b) => depth(b) - depth(a));
      for (let sent = true; sent; ) {
        sent = false;
        for (const nodeId of order) {
          const queue = queues.get(nodeId)!;
          if (!queue.requests.length || !canSend(queue.node)) continue;
          send(queue.node, queue.requests.shift()!);
          sent = true;
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
      const config = node.type === 'ai' ? scaleBatch(subjectBatch(run.subject, node), lines[0]!.factor) : null;
      const first = config ? (packGroups([...Map.groupBy(same, (line) => line.plan ?? -1).values()], config)[0] ?? []) : same.slice(0, 1);
      if (first.length && canSend(node)) send(node, first);
    }
    return true;
  }

  /** Hands one request to run-calls.ts: its lines are marked running and the request counts as in flight until its outcome is recorded. */
  private dispatch(run: Run, node: WorkflowNode, lines: Waiting[]) {
    if (!nodeCallsOut(node)) return;
    const ids = lines.map((line) => line.id);
    const byId = new Map(this.db.select().from(s.runItems).where(inArray(s.runItems.id, ids)).all().map((item) => [item.id, item]));
    const batch = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    this.db.update(s.runItems).set({ state: 'running' }).where(inArray(s.runItems.id, ids)).run();
    let controller = this.aborts.get(run.id);
    if (!controller || controller.signal.aborted) this.aborts.set(run.id, (controller = new AbortController()));
    const tasks = this.inflight.get(run.id) ?? new Set();
    this.inflight.set(run.id, tasks);
    // Lines sent back on a retry rule's model go together on that model (the batches were grouped by it).
    const modelKey = node.type === 'ai' ? (lines[0]?.model ?? choiceKey(node.config.model)) : null;
    // In flight from here on: the request is built and sent before this returns.
    const task = { nodeId: node.id, done: Promise.resolve() };
    tasks.add(task);
    // run-calls never rejects; should it ever, the request is still taken out of flight and the lines it left running wait again (advance).
    task.done = this.calls
      .run(run, node, modelKey, batch, controller.signal)
      .catch((error) => console.error(`[runner] run ${run.id}:`, error))
      .finally(() => {
        tasks.delete(task);
        if (!tasks.size && this.inflight.get(run.id) === tasks) this.inflight.delete(run.id);
      });
  }
}
