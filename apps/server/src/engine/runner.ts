import { and, asc, eq, inArray } from 'drizzle-orm';
import jsonLogic from 'json-logic-js';
import type { z } from 'zod';
import * as ai from '@tw/ai';
import { checkFormat, isAiNode, type AiNode, type ConditionData, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData, ItemState } from '../db/schema.ts';
import { events } from '../events.ts';
import { buildContext } from '../services/context.ts';
import { resolveRoutes } from '../services/routes.ts';
import type { SecretStore } from '../services/secrets.ts';
import { buildPrompt, reviewOutput, translationOutput, type PromptLine } from './prompts.ts';

export interface ModelPort {
  generate: typeof ai.generate;
  judge: typeof ai.judge;
}

type Run = typeof s.runs.$inferSelect;
type Item = typeof s.runItems.$inferSelect;
type Unit = typeof s.units.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Executes user workflows. One run item = one source line. Items flow node to node through the
 * exits stored in the run's frozen definition; AI nodes process items in batches.
 * State lives in the database, so a restart simply resumes from queued items.
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
      for (const run of this.db.select().from(s.runs).where(eq(s.runs.status, 'running')).all()) active = this.advance(run) || active;
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
    this.db.update(s.runs).set({ status: 'running' }).where(and(eq(s.runs.id, runId), eq(s.runs.status, 'paused'))).run();
    this.notify(runId);
  }

  cancel(runId: string) {
    this.aborts.get(runId)?.abort();
    this.db.transaction((tx) => {
      tx.update(s.runs).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(s.runs.id, runId)).run();
      tx.update(s.runItems)
        .set({ state: 'cancelled' })
        .where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, ['queued', 'running', 'waiting'])))
        .run();
    });
    this.notify(runId);
  }

  /** A person's decision at a human node. Editing creates a human candidate first. */
  decide(itemId: string, decision: 'approved' | 'rejected', text?: string) {
    this.db.transaction((tx) => {
      const item = tx.select().from(s.runItems).where(eq(s.runItems.id, itemId)).get();
      if (!item || item.state !== 'waiting') throw new Error('이미 처리된 항목입니다.');
      const run = tx.select().from(s.runs).where(eq(s.runs.id, item.runId)).get()!;
      if (text !== undefined && text.trim()) {
        const candidateId = crypto.randomUUID();
        tx.insert(s.candidates).values({ id: candidateId, unitId: item.unitId, text, origin: 'human', runId: run.id, nodeId: item.nodeId }).run();
        item.data = { ...item.data, candidateId, candidateText: text };
      }
      this.route(tx, run, item, decision);
    });
    const item = this.db.select({ runId: s.runItems.runId }).from(s.runItems).where(eq(s.runItems.id, itemId)).get();
    if (item) this.notify(item.runId);
  }

  private notify(runId: string) {
    const run = this.db.select({ projectId: s.runs.projectId }).from(s.runs).where(eq(s.runs.id, runId)).get();
    events.changed(run?.projectId, 'runs', 'reviews', 'units');
  }

  private node(run: Run, nodeId: string): WorkflowNode | undefined {
    return run.definition.nodes.find((node) => node.id === nodeId);
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
        state = 'failed';
        message = `'${this.node(run, nodeId)?.label ?? nodeId}' 노드 방문 상한(${definition.settings.maxVisitsPerNode}회)을 넘었습니다.`;
      }
    }
    tx.update(s.runItems).set({ nodeId, state, visits, data: { ...item.data, path }, error: message }).where(eq(s.runItems.id, item.id)).run();
  }

  private queued(run: Run) {
    return this.db.select().from(s.runItems).where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'queued'))).all();
  }

  private advance(run: Run): boolean {
    // Non-AI nodes are instant; settle them before handing batches to the model.
    let changed = false;
    for (let round = 0; round < 50; round++) {
      const sync = this.queued(run).filter((item) => {
        const node = this.node(run, item.nodeId);
        return !node || !isAiNode(node);
      });
      if (!sync.length) break;
      this.settle(run, sync);
      changed = true;
    }

    const queued = this.queued(run);
    const busy = this.inflight.get(run.id)?.size ?? 0;
    if (!queued.length) {
      if (busy) return true;
      const open = this.db
        .select({ id: s.runItems.id })
        .from(s.runItems)
        .where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['queued', 'running', 'waiting'])))
        .limit(1)
        .all();
      if (!open.length) {
        this.db.update(s.runs).set({ status: 'completed', finishedAt: new Date() }).where(eq(s.runs.id, run.id)).run();
        this.notify(run.id);
      } else if (changed) this.notify(run.id);
      return false;
    }

    const byNode = Map.groupBy(queued, (item) => item.nodeId);
    const limit = run.definition.settings.concurrency;
    for (const [nodeId, items] of byNode) {
      const node = this.node(run, nodeId);
      if (!node || !isAiNode(node)) continue;
      for (const batch of this.batches(node, items)) {
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
      const unitRows = new Map(tx.select().from(s.units).where(inArray(s.units.id, items.map((item) => item.unitId))).all().map((unit) => [unit.id, unit]));
      const tagRows = Map.groupBy(tx.select().from(s.unitTags).where(inArray(s.unitTags.unitId, [...unitRows.keys()])).all(), (row) => row.unitId);
      for (const item of items) {
        const node = this.node(run, item.nodeId);
        const unit = unitRows.get(item.unitId);
        if (!node || !unit) {
          tx.update(s.runItems).set({ state: 'failed', error: '노드 또는 원문이 없습니다.' }).where(eq(s.runItems.id, item.id)).run();
          continue;
        }
        this.runSync(tx, run, node, item, unit, (tagRows.get(unit.id) ?? []).map((row) => row.tagId));
      }
    });
  }

  private runSync(tx: Tx, run: Run, node: WorkflowNode, item: Item, unit: Unit, tagIds: string[]) {
    switch (node.type) {
      case 'entry':
        return this.route(tx, run, item, 'out');
      case 'end':
        return tx.update(s.runItems).set({ state: 'done' }).where(eq(s.runItems.id, item.id)).run();
      case 'human':
        return tx.update(s.runItems).set({ state: 'waiting' }).where(eq(s.runItems.id, item.id)).run();
      case 'check': {
        const text = item.data.candidateText ?? unit.translation;
        const issues = text === undefined || text === null ? ['검사할 번역 후보가 없습니다.'] : checkFormat(unit.source, text, node.config).map((issue) => issue.message);
        item.data = { ...item.data, check: { passed: !issues.length, issues } };
        return this.route(tx, run, item, issues.length ? 'fail' : 'pass');
      }
      case 'condition': {
        const data: ConditionData = {
          visits: item.visits,
          review: item.data.review,
          check: item.data.check,
          unit: { kind: unit.kind, speaker: unit.speaker, statusId: unit.statusId, tagIds },
        };
        let result = false;
        try {
          result = Boolean(jsonLogic.apply(node.config.expression as jsonLogic.RulesLogic, data));
        } catch (error) {
          return this.route(tx, run, item, 'error', `조건식 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
        return this.route(tx, run, item, result ? 'true' : 'false');
      }
      case 'update': {
        const patch: Partial<typeof s.units.$inferInsert> = {};
        if (node.config.statusId) patch.statusId = node.config.statusId;
        if (node.config.applyCandidate && item.data.candidateId) {
          patch.candidateId = item.data.candidateId;
          patch.translation = item.data.candidateText;
        }
        if (Object.keys(patch).length) tx.update(s.units).set(patch).where(eq(s.units.id, unit.id)).run();
        if (node.config.removeTagIds.length)
          tx.delete(s.unitTags).where(and(eq(s.unitTags.unitId, unit.id), inArray(s.unitTags.tagId, node.config.removeTagIds))).run();
        if (node.config.addTagIds.length)
          tx.insert(s.unitTags).values(node.config.addTagIds.map((tagId) => ({ unitId: unit.id, tagId }))).onConflictDoNothing().run();
        return this.route(tx, run, item, 'out');
      }
      default:
        return this.route(tx, run, item, 'error', '알 수 없는 노드입니다.');
    }
  }

  private batches(node: AiNode, items: Item[]): Item[][] {
    const unitRows = new Map(
      this.db.select({ id: s.units.id, groupId: s.units.groupId, sort: s.units.sort }).from(s.units).where(inArray(s.units.id, items.map((item) => item.unitId))).all().map((unit) => [unit.id, unit]),
    );
    const ordered = [...items].sort((a, b) => {
      const ua = unitRows.get(a.unitId)!, ub = unitRows.get(b.unitId)!;
      return ua.groupId.localeCompare(ub.groupId) || ua.sort - ub.sort;
    });
    const { mode, size } = node.config.batch;
    const chunk = (list: Item[]) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
    if (mode === 'unit') return ordered.map((item) => [item]);
    if (mode === 'count') return chunk(ordered);
    return [...Map.groupBy(ordered, (item) => unitRows.get(item.unitId)!.groupId).values()].flatMap(chunk);
  }

  private dispatch(run: Run, node: AiNode, batch: Item[]) {
    this.db.update(s.runItems).set({ state: 'running' }).where(inArray(s.runItems.id, batch.map((item) => item.id))).run();
    let controller = this.aborts.get(run.id);
    if (!controller || controller.signal.aborted) this.aborts.set(run.id, (controller = new AbortController()));
    const set = this.inflight.get(run.id) ?? new Set();
    this.inflight.set(run.id, set);
    const task = this.executeAi(run, node, batch, controller.signal).finally(() => set.delete(task));
    set.add(task);
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
        candidate: node.type === 'translate' ? undefined : (item.data.candidateText ?? unit.translation ?? undefined),
        feedback: node.type === 'revise' ? [...(item.data.review?.issues ?? []), ...(item.data.check?.issues ?? [])] : undefined,
      };
    });
    const profile = run.profiles[node.config.profileId];
    const step = { runId: run.id, nodeId: node.id, unitIds: batch.map((item) => item.unitId), startedAt };
    if (!profile) return this.failBatch(run, batch, step, 'AI 프로필이 실행 스냅샷에 없습니다.');

    const context = buildContext(this.db, run.projectId, unitRows, node.config.context);
    const { system, prompt } = buildPrompt(node, profile.instructions, { source: project.sourceLanguage, target: project.targetLanguage }, context, lines);
    const routes = resolveRoutes(profile, this.secrets);
    const request = { system, prompt, maxOutputTokens: profile.maxOutputTokens, temperature: profile.temperature ?? undefined, timeoutMs: profile.timeoutSeconds * 1000, signal };

    try {
      if (node.type === 'review' && routes[0]?.kind === 'systemone') {
        const results: { passed: boolean; confidence: number }[] = [];
        let attempts: ai.Attempt[] = [];
        for (const line of lines) {
          const outcome = await ai.withFallback(routes, profile.maxAttempts, (route) =>
            this.model.judge(route, {
              state: { source: line.source, translation: line.candidate ?? '', speaker: line.speaker, context: { scene: context.scene, characters: context.characters, glossary: context.terms } },
              instructions: [node.config.instructions, profile.instructions].filter(Boolean).join('\n') || 'Is this translation acceptable as is?',
              timeoutMs: request.timeoutMs,
              signal,
            }), signal);
          attempts = [...attempts, ...outcome.attempts];
          results.push(outcome.result);
        }
        this.db.transaction((tx) => {
          batch.forEach((item, index) => {
            const result = results[index];
            item.data = { ...item.data, review: { passed: result.passed, confidence: result.confidence, issues: result.passed ? [] : ['System One이 수정 필요로 판정했습니다.'] } };
            this.route(tx, run, item, result.passed ? 'pass' : 'fail');
          });
          tx.insert(s.runSteps).values({ ...step, ok: true, model: routes[0].model, prompt: null, output: results, attempts, finishedAt: new Date() }).run();
        });
        return this.notify(run.id);
      }

      const schema: z.ZodType<unknown> = node.type === 'review' ? reviewOutput : translationOutput;
      const outcome = await ai.withFallback(routes, profile.maxAttempts, (route) => this.model.generate(route, { ...request, schema }), signal);
      const output = outcome.result.object as { translations?: { id: string; text: string }[]; results?: { id: string; passed: boolean; issues: string[] }[] };
      this.db.transaction((tx) => {
        batch.forEach((item, index) => {
          const id = lines[index].id;
          if (node.type === 'review') {
            const result = output.results?.find((entry) => entry.id === id);
            if (!result) return this.route(tx, run, item, 'error', '모델 응답에 이 대사의 검수 결과가 없습니다.');
            item.data = { ...item.data, review: { passed: result.passed, issues: result.issues } };
            return this.route(tx, run, item, result.passed ? 'pass' : 'fail');
          }
          const text = output.translations?.find((entry) => entry.id === id)?.text;
          if (text === undefined) return this.route(tx, run, item, 'error', '모델 응답에 이 대사의 번역이 없습니다.');
          const candidateId = crypto.randomUUID();
          tx.insert(s.candidates)
            .values({ id: candidateId, unitId: item.unitId, text, origin: 'ai', profileId: profile.id, model: outcome.route.model, runId: run.id, nodeId: node.id })
            .run();
          item.data = { ...item.data, candidateId, candidateText: text };
          this.route(tx, run, item, 'out');
        });
        tx.insert(s.runSteps)
          .values({
            ...step,
            ok: true,
            model: outcome.route.model,
            prompt: `${system}\n\n${prompt}`,
            output,
            attempts: outcome.attempts,
            inputTokens: outcome.result.usage.inputTokens,
            outputTokens: outcome.result.usage.outputTokens,
            finishedAt: new Date(),
          })
          .run();
      });
      this.notify(run.id);
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const attempts = (error as { attempts?: unknown[] }).attempts ?? [];
      this.failBatch(run, batch, { ...step, prompt: `${system}\n\n${prompt}`, attempts }, message);
    }
  }

  private failBatch(run: Run, batch: Item[], step: Omit<typeof s.runSteps.$inferInsert, 'ok' | 'finishedAt'>, message: string) {
    this.db.transaction((tx) => {
      for (const item of batch) this.route(tx, run, item, 'error', message);
      tx.insert(s.runSteps).values({ ...step, ok: false, error: message, finishedAt: new Date() }).run();
    });
    this.notify(run.id);
  }
}

/** Selects the lines a run starts with: scope ∩ entry status filter. */
export function selectRunUnits(db: Db, projectId: string, definition: WorkflowDefinition, scope: s.RunScope): string[] {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const statusIds = entry?.type === 'entry' ? entry.config.statusIds : [];
  const conditions = [eq(s.units.projectId, projectId)];
  if (statusIds.length) conditions.push(inArray(s.units.statusId, statusIds));
  if (scope.groupIds?.length) conditions.push(inArray(s.units.groupId, scope.groupIds));
  if (scope.unitIds?.length) conditions.push(inArray(s.units.id, scope.unitIds));
  return db.select({ id: s.units.id }).from(s.units).where(and(...conditions)).all().map((row) => row.id);
}

export function createRun(db: Db, input: { projectId: string; workflow: typeof s.workflows.$inferSelect; profiles: Record<string, s.ProfileSnapshot>; scope: s.RunScope }) {
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
      })
      .run();
    const rows = unitIds.map((unitId) => ({ runId, unitId, nodeId: entry.id, state: 'queued' as const, visits: { [entry.id]: 1 }, data: { path: [] } as ItemData }));
    for (let index = 0; index < rows.length; index += 400) tx.insert(s.runItems).values(rows.slice(index, index + 400)).run();
  });
  events.changed(input.projectId, 'runs');
  return { runId, total: unitIds.length };
}
