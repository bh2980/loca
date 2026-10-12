import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import jsonLogic from 'json-logic-js';
import * as ai from '@tw/ai';
import { FUNCTIONS, nodeName, type AiNode, type ConditionData, type FunctionName, type FunctionNode, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import { inChunks, inList } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData, ItemState } from '../db/schema.ts';
import { events } from '../events.ts';
import { buildContext } from '../services/context.ts';
import { resolveRoutes } from '../services/routes.ts';
import type { SecretStore } from '../services/secrets.ts';
import { runAsyncFunction, syncFunctions, type FunctionInput, type FunctionResult } from './functions/index.ts';
import { buildPrompt, outputSchema, type KnowledgeOutput, type PromptLine } from './prompts.ts';

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
type Waiting = { id: string; unitId: string; nodeId: string; groupId: string; groupSort: number; sort: number };

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
    const recent = this.db.select({ ok: s.runSteps.ok }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).orderBy(desc(s.runSteps.finishedAt)).limit(max).all();
    if (recent.length === max && recent.every((step) => !step.ok))
      return this.halt(runId, `호출이 ${max}번 연달아 실패해서 멈췄습니다.${failure ? ` 마지막 오류: ${failure.message}` : ''}`);
    if (!run.limits?.maxCalls && !run.limits?.maxInputTokens) return;
    const used = this.db.select({ calls: sql<number>`count(*)`, input: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)` }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).get()!;
    if (run.limits.maxCalls && used.calls >= run.limits.maxCalls) return this.halt(runId, `호출 상한(${run.limits.maxCalls.toLocaleString()}회)에 도달해서 멈췄습니다.`);
    if (run.limits.maxInputTokens && used.input >= run.limits.maxInputTokens)
      return this.halt(runId, `입력 토큰 상한(${run.limits.maxInputTokens.toLocaleString()})에 도달해서 멈췄습니다.`);
  }

  private notify(runId: string) {
    const run = this.db.select({ projectId: s.runs.projectId }).from(s.runs).where(eq(s.runs.id, runId)).get();
    events.changed(run?.projectId, 'runs', 'reviews', 'units', 'terms');
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

  /** Moves an item out through `port`. An exit with no edge ends the item (failed for `error`). */
  private route(tx: Tx, run: Run, item: Item, port: string, error?: string) {
    const definition: WorkflowDefinition = run.definition;
    const edge = definition.edges.find((candidate) => candidate.source === item.nodeId && candidate.sourceHandle === port);
    const path = [...item.data.path, { nodeId: item.nodeId, port, at: Date.now() }].slice(-200);
    let state: ItemState = 'queued';
    let nodeId = item.nodeId;
    let message = error ?? null;
    const visits = { ...item.visits };
    if (!edge) {
      state = port === 'error' ? 'failed' : 'done';
    } else {
      nodeId = edge.target;
      visits[nodeId] = (visits[nodeId] ?? 0) + 1;
      if (visits[nodeId] > definition.settings.maxVisitsPerNode) {
        const target = this.node(run, nodeId);
        state = 'failed';
        message = `'${target ? nodeName(target) : nodeId}' 노드 방문 상한(${definition.settings.maxVisitsPerNode}회)을 넘었습니다.`;
      }
    }
    tx.update(s.runItems).set({ nodeId, state, visits, data: { ...item.data, path }, error: message }).where(eq(s.runItems.id, item.id)).run();
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
    return this.db
      .select({ id: s.runItems.id, unitId: s.runItems.unitId, nodeId: s.runItems.nodeId, groupId: s.units.groupId, groupSort: s.groups.sort, sort: s.units.sort })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.unitId))
      .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
      .where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued'), inArray(s.runItems.nodeId, slowIds)))
      .orderBy(asc(s.groups.sort), asc(s.units.groupId), asc(s.units.sort))
      .all();
  }

  private advance(run: Run): boolean {
    const slowIds = run.definition.nodes.filter(isAsync).map((node) => node.id);
    // Instant nodes settle first, possibly several hops, before slow work is handed out; a bounded
    // number per tick so a 50,000-line run never holds the event loop.
    let changed = false;
    let settled = 0;
    while (settled < SETTLE_PER_TICK) {
      const instant = this.queuedInstant(run, slowIds, SETTLE_PER_TICK - settled);
      if (!instant.length) break;
      this.settle(run, instant);
      settled += instant.length;
      changed = true;
    }
    if (settled >= SETTLE_PER_TICK) {
      this.notify(run.id);
      return true;
    }

    const limit = run.definition.settings.concurrency;
    const busy = this.inflight.get(run.id)?.size ?? 0;
    if (busy >= limit) {
      if (changed) this.notify(run.id);
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
      } else if (changed) this.notify(run.id);
      return false;
    }

    for (const [nodeId, lines] of Map.groupBy(waiting, (line) => line.nodeId)) {
      const node = this.node(run, nodeId);
      if (!node) continue;
      const batches = node.type === 'ai' ? this.batches(node, lines) : lines.map((line) => [line]);
      for (const batch of batches) {
        if ((this.inflight.get(run.id)?.size ?? 0) >= limit) break;
        this.dispatch(run, node, batch);
        changed = true;
      }
    }
    if (changed) this.notify(run.id);
    return true;
  }

  private settle(run: Run, items: Item[]) {
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

  /** `lines` arrive in script order. "group" keeps a scene's lines together, cut at the batch size. */
  private batches(node: AiNode, lines: Waiting[]): Waiting[][] {
    const { mode, size } = node.config.batch;
    const chunk = (list: Waiting[]) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
    if (mode === 'unit') return lines.map((line) => [line]);
    if (mode === 'count') return chunk(lines);
    return [...Map.groupBy(lines, (line) => line.groupId).values()].flatMap(chunk);
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
    const work = node.type === 'ai' ? this.executeAi(run, node, batch, controller.signal) : this.executeFunction(run, node as FunctionNode, batch[0], controller.signal);
    const task = work.finally(() => set.delete(task));
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

  private async executeAi(run: Run, node: AiNode, batch: Item[], signal: AbortSignal) {
    const startedAt = new Date();
    const project = this.db.select().from(s.projects).where(eq(s.projects.id, run.projectId)).get()!;
    const unitRows = this.db.select().from(s.units).where(inArray(s.units.id, batch.map((item) => item.unitId))).orderBy(asc(s.units.sort)).all();
    const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));
    const lines: PromptLine[] = batch.map((item, index) => {
      const unit = unitById.get(item.unitId)!;
      return {
        id: String(index + 1),
        unitId: unit.id,
        key: unit.key,
        speaker: unit.speaker,
        source: unit.source,
        candidate: item.data.candidateText ?? unit.translation ?? undefined,
        issues: item.data.issues,
      };
    });
    const profile = run.profiles[node.config.profileId];
    const step: StepRecord = { runId: run.id, nodeId: node.id, unitIds: batch.map((item) => item.unitId), startedAt };
    if (!profile) return this.failBatch(run, batch, step, new Error('AI 프로필이 실행 스냅샷에 없습니다.'));

    const context = buildContext(this.db, run.projectId, unitRows, node.config.context);
    step.context = context.items;
    const { system, prompt } = buildPrompt(node, profile.instructions, { source: project.sourceLanguage, target: project.targetLanguage }, context, lines);
    const routes = resolveRoutes(profile, this.secrets);
    const request = { system, prompt, maxOutputTokens: profile.maxOutputTokens, temperature: profile.temperature ?? undefined, timeoutMs: profile.timeoutSeconds * 1000, signal };
    const fullPrompt = `${system}\n\n${prompt}`;

    try {
      let outcomes: Outcome[];
      let model = routes[0]?.model;
      let attempts: ai.Attempt[] = [];
      let usage: ai.Usage = {};
      let raw: unknown;
      const judged: ai.Usage[] = [];

      if (routes[0]?.kind === 'systemone') {
        // A judge model answers one line at a time and only supports verdicts.
        if (node.config.output !== 'verdict') throw new Error('System One 프로필은 출력 형태가 "판정"인 AI 노드에서만 쓸 수 있습니다.');
        outcomes = [];
        for (const line of lines) {
          const outcome = await ai.withFallback(
            routes,
            profile.maxAttempts,
            (route) =>
              this.model.judge(route, {
                state: { source: line.source, translation: line.candidate ?? '', speaker: line.speaker, context: { scene: context.scene, characters: context.characters, glossary: context.terms } },
                instructions: [node.config.instructions, profile.instructions].filter(Boolean).join('\n') || 'Is this translation acceptable as is?',
                timeoutMs: request.timeoutMs,
                signal,
              }),
            signal,
          );
          attempts = [...attempts, ...outcome.attempts];
          judged.push(outcome.result.usage);
          const issues = outcome.result.passed ? [] : ['System One이 수정 필요로 판정했습니다.'];
          outcomes.push({ port: outcome.result.passed ? 'pass' : 'fail', issues, output: { passed: outcome.result.passed, issues, confidence: outcome.result.confidence } });
        }
        raw = outcomes;
        usage = stepUsage(attempts, judged.reduce(ai.addUsage, {}));
      } else {
        const result = await ai.withFallback(routes, profile.maxAttempts, (route) => this.model.generate(route, { ...request, schema: outputSchema(node) }), signal);
        model = result.route.model;
        attempts = result.attempts;
        usage = stepUsage(result.attempts, result.result.usage);
        raw = result.result.object;
        outcomes = this.readAiOutput(node, raw, lines, profile.id, model);
      }

      this.db.transaction((tx) => {
        batch.forEach((item, index) => this.record(tx, run, item, outcomes[index]));
        tx.insert(s.runSteps)
          .values({ ...step, ok: true, model, prompt: routes[0]?.kind === 'systemone' ? null : fullPrompt, output: raw, attempts, ...usageColumns(usage), finishedAt: new Date() })
          .run();
      });
      this.notify(run.id);
      this.guard(run.id);
    } catch (error) {
      if (signal.aborted) return;
      this.failBatch(run, batch, { ...step, prompt: fullPrompt, attempts: attemptsOf(error) }, error);
    }
  }

  /** Turn the model's structured answer into one Outcome per line, by output kind. */
  private readAiOutput(node: AiNode, raw: unknown, lines: PromptLine[], profileId: string, model: string): Outcome[] {
    const missing = (what: string): Outcome => ({ port: 'error', error: `모델 응답에 이 대사의 ${what}이(가) 없습니다.` });
    const value = raw as { translations?: { id: string; text: string }[]; results?: ({ id: string } & Record<string, unknown>)[]; terms?: unknown[]; listeners?: { id: string; listener: unknown; confidence: unknown }[] };
    switch (node.config.output) {
      case 'candidate':
        return lines.map((line) => {
          const text = value.translations?.find((entry) => entry.id === line.id)?.text;
          return text === undefined ? missing('번역') : { port: 'out', candidate: text, origin: 'ai', profileId, model, output: { text } };
        });
      case 'verdict':
        return lines.map((line) => {
          const result = value.results?.find((entry) => entry.id === line.id) as { passed: boolean; issues: string[] } | undefined;
          if (!result) return missing('판정');
          return { port: result.passed ? 'pass' : 'fail', issues: result.passed ? undefined : result.issues, output: { passed: result.passed, issues: result.issues } };
        });
      case 'terms':
        // Terms describe the whole batch; every line carries them so a later "add terms" sees them.
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
    this.db.transaction((tx) => {
      for (const item of batch) this.route(tx, run, item, 'error', message);
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
    const rows = unitIds.map((unitId) => ({ runId, unitId, nodeId: entry.id, state: 'queued' as const, visits: { [entry.id]: 1 }, data: { path: [], outputs: {} } as ItemData }));
    for (let index = 0; index < rows.length; index += 400) tx.insert(s.runItems).values(rows.slice(index, index + 400)).run();
  });
  events.changed(input.projectId, 'runs');
  return { runId, total: unitIds.length };
}
