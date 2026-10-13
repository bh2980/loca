import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { batchConfigSchema, CONNECTION_KIND_INFO, estimateTokens, isUnsureListener, nodeName, termMatcher, type AiNode, type WorkflowDefinition } from '@tw/shared';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { packGroups } from '../engine/batches.ts';
import { buildPrompt } from '../engine/prompts.ts';
import { planRun, sceneLinks, selectRunUnits } from '../engine/runner.ts';
import { mainPairs } from './analysis.ts';
import { buildContext } from './context.ts';
import { choiceLabel } from './routes.ts';
import { speechRuleIndex } from './speech.ts';

/** Prompts built per node to estimate request size; more would only slow the preview down. */
const SAMPLE = 8;
/** History used to measure a connection's fixed overhead and a node's pass rate. */
const HISTORY = 60;

export interface NodeEstimate {
  nodeId: string;
  name: string;
  /** The node's model ("connection · model · effort"), null when none is picked. */
  model: string | null;
  /** Other models sharing this node's requests (their accounts take whatever is free). */
  sharedWith: string[];
  connection: { id: string; name: string; kind: string; cli: boolean } | null;
  /** Requests if every planned line reaches this node once. */
  full: number;
  /** min / expected / max requests; expected is null without history for a node not every line reaches. */
  requests: { min: number; expected: number | null; max: number };
  /** On the main path: reached from the entry through out / pass / true exits, so every line is expected here once. */
  everyLine: boolean;
  /** Estimated tokens of the prompt we send, per request (sampled from real plan batches). */
  promptTokens: number;
  /** Input the connection adds per request on its own, measured from past calls; null when never measured. */
  overheadTokens: number | null;
  /** From past runs of this workflow: requests per line at this node; null without history. */
  historyRate: number | null;
}

/**
 * What a run would do, computed without calling a model: the lines in scope, the run plan, the
 * requests per AI node, token estimates and the risks worth seeing before spending a subscription.
 * The plan is the same one createRun stores (planRun), so the numbers describe the real run.
 */
export async function preflight(db: Db, workflow: typeof s.workflows.$inferSelect, scope: s.RunScope) {
  const definition: WorkflowDefinition = workflow.definition;
  const projectId = workflow.projectId;
  const unitIds = selectRunUnits(db, projectId, definition, scope);
  const columns = { id: s.units.id, key: s.units.key, groupId: s.units.groupId, seq: s.units.seq, kind: s.units.kind, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation, listener: s.units.listener, listenerOrigin: s.units.listenerOrigin, listenerConfidence: s.units.listenerConfidence, tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4` };
  // Most of a project: one scan kept by id is faster than ids in chunks (see planLines).
  const wanted = new Set(unitIds);
  const units = (unitIds.length < 2_000 ? inChunks(unitIds, (ids) => db.select(columns).from(s.units).where(inArray(s.units.id, ids)).all()) : db.select(columns).from(s.units).where(eq(s.units.projectId, projectId)).all().filter((unit) => wanted.has(unit.id))).sort((a, b) => a.seq - b.seq);
  await new Promise((resolve) => setImmediate(resolve));

  // The run plan, exactly as a run would store it.
  const plan = planRun(db, definition, unitIds);
  await new Promise((resolve) => setImmediate(resolve));
  const groups = [...Map.groupBy(units.filter((unit) => plan.has(unit.id)), (unit) => plan.get(unit.id)!).values()];
  const sizes = groups.map((group) => group.length).sort((a, b) => a - b);
  const batchList = listBatches(db, groups);

  const everyLine = linesThrough(definition);
  const nodes = definition.nodes.filter((node): node is AiNode => node.type === 'ai');
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  // Each node's estimate (packing, sample prompts, history) takes tens of milliseconds on a 50k-line
  // run; the event loop is handed back between nodes so other requests are not held up.
  const estimates: NodeEstimate[] = [];
  for (const node of nodes) {
    await new Promise((resolve) => setImmediate(resolve));
    estimates.push(estimateNode(node));
  }
  function estimateNode(node: AiNode): NodeEstimate {
    const config = batchConfigSchema.parse(node.config.batch ?? {});
    const requests = packGroups(groups, config);
    const label = (choice: { connectionId: string; model: string; effort?: string }) => {
      const row = choice.connectionId && choice.model ? db.select({ name: s.connections.name }).from(s.connections).where(eq(s.connections.id, choice.connectionId)).get() : undefined;
      return row ? choiceLabel(row.name, choice) : null;
    };
    const connection = node.config.model.connectionId ? db.select().from(s.connections).where(eq(s.connections.id, node.config.model.connectionId)).get() : undefined;
    const historyRate = rateFromHistory(db, workflow.id, node.id);
    const all = everyLine.has(node.id);
    const max = requests.length * (all ? 1 : definition.settings.maxVisitsPerNode);
    return {
      nodeId: node.id,
      name: nodeName(node),
      model: label(node.config.model),
      sharedWith: node.config.extraModels.flatMap((choice) => label(choice) ?? []),
      connection: connection ? { id: connection.id, name: connection.name, kind: connection.kind, cli: CONNECTION_KIND_INFO[connection.kind].transport === 'cli' } : null,
      full: requests.length,
      requests: { min: all ? requests.length : 0, expected: all ? requests.length : historyRate === null ? null : Math.round(historyRate * units.length), max },
      everyLine: all,
      promptTokens: samplePrompt(db, projectId, node, { source: project.sourceLanguage, target: project.targetLanguage }, requests),
      overheadTokens: connection ? overheadOf(db, connection.id) : null,
      historyRate,
    };
  }

  // Totals: a known expectation where every node has one, otherwise the range.
  const sum = (pick: (estimate: NodeEstimate) => number | null) => estimates.reduce<number | null>((total, estimate) => (total === null || pick(estimate) === null ? null : total + pick(estimate)!), 0);
  const perRequest = (estimate: NodeEstimate) => estimate.promptTokens + (estimate.overheadTokens ?? 0);
  const calls = { min: sum((e) => e.requests.min)!, expected: sum((e) => e.requests.expected), max: sum((e) => e.requests.max)! };
  const inputTokens = {
    min: sum((e) => e.requests.min * perRequest(e))!,
    expected: sum((e) => (e.requests.expected === null ? null : e.requests.expected * perRequest(e))),
    max: sum((e) => e.requests.max * perRequest(e))!,
  };

  const unmeasured = estimates.some((estimate) => estimate.connection && estimate.overheadTokens === null);
  const dialogue = units.filter((unit) => unit.kind === 'dialogue');
  const unknownListener = dialogue.filter((unit) => !unit.listener || isUnsureListener(unit)).length;
  const rules = db.select({ status: s.speechRules.status, count: sql<number>`count(*)` }).from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).groupBy(s.speechRules.status).all();
  const analysis = db.select({ finishedAt: s.analysisJobs.finishedAt, model: s.analysisJobs.model }).from(s.analysisJobs).where(and(eq(s.analysisJobs.projectId, projectId), eq(s.analysisJobs.status, 'completed'))).orderBy(desc(s.analysisJobs.finishedAt)).limit(1).get();

  const warnings: string[] = [];
  const small = sizes.filter((size) => size <= 5).length;
  if (sizes.length && small / sizes.length > 0.1) warnings.push(`계획 묶음 ${sizes.length}개 중 ${small}개가 5줄 이하입니다. 요청마다 붙는 고정 비용 비중이 커집니다.`);
  // One note per connection, naming the nodes that use it.
  for (const list of Map.groupBy(estimates.filter((estimate) => estimate.connection), (estimate) => estimate.connection!.id).values()) {
    const { connection, overheadTokens } = list[0];
    const names = list.map((estimate) => `'${estimate.name}'`).join(', ');
    if (connection!.cli) warnings.push(`${names}은(는) ${connection!.name}(CLI)로 실행되어 구독 사용량을 씁니다.`);
    if (overheadTokens === null) warnings.push(`${connection!.name}의 요청당 고정 토큰을 아직 잰 적이 없어 입력 토큰이 실제보다 적게 보일 수 있습니다. 한 번 실행하면 측정됩니다.`);
    else if (list.some((estimate) => overheadTokens > estimate.promptTokens)) warnings.push(`${connection!.name}은(는) 요청마다 보내는 내용보다 큰 고정 토큰(${overheadTokens.toLocaleString()})을 씁니다.`);
  }
  if (dialogue.length && unknownListener / dialogue.length > 0.2) warnings.push(`대사 ${dialogue.length.toLocaleString()}줄 중 ${unknownListener.toLocaleString()}줄은 청자를 모릅니다. 말투 규칙이 적용되지 않습니다.`);
  if (!rules.some((row) => row.status === 'confirmed')) warnings.push('확정된 말투 규칙이 없습니다. 작품 분석으로 먼저 만들 수 있습니다.');
  // Main pairs (most of the dialogue) need a rule a person has seen: a wrong one spoils hundreds of lines.
  const people = db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(and(eq(s.characters.projectId, projectId), ne(s.characters.status, 'rejected'))).all();
  const main = mainPairs(db, projectId, people);
  const index = speechRuleIndex(db, projectId);
  const covered = new Set(db.select({ from: s.speechRules.fromName, to: s.speechRules.toName }).from(s.speechRules).where(and(eq(s.speechRules.projectId, projectId), eq(s.speechRules.status, 'confirmed'))).all().map((rule) => `${index.norm(rule.from)}|${index.norm(rule.to)}`));
  const waiting = db.select({ count: sql<number>`count(*)` }).from(s.speechRules).where(and(eq(s.speechRules.projectId, projectId), eq(s.speechRules.status, 'candidate'))).get()!.count;
  const missing = [...main].filter((pair) => !covered.has(pair)).length;
  if (missing) warnings.push(`대사가 많은 화자→청자 쌍 ${main.size}개 중 ${missing}개는 확정된 말투 규칙이 없습니다.${waiting ? ` 확인을 기다리는 후보 규칙 ${waiting}개가 있습니다(자료 › 인물·관계).` : ''}`);

  const readiness = readinessOf(db, projectId, units, index);
  const pace = paceOf(db, estimates);

  return {
    readiness,
    pace,
    lines: { total: units.length, translated: units.filter((unit) => unit.translation).length, untranslated: units.filter((unit) => !unit.translation).length },
    plan: {
      batches: sizes.length,
      linesPerBatch: sizes.length ? { min: sizes[0], median: sizes[Math.floor(sizes.length / 2)], max: sizes.at(-1)! } : null,
      smallShare: sizes.length ? small / sizes.length : 0,
      list: batchList,
    },
    nodes: estimates,
    totals: { calls, inputTokens },
    knowledge: {
      analysis: analysis ? { finishedAt: analysis.finishedAt, model: analysis.model } : null,
      speechRules: Object.fromEntries(rules.map((row) => [row.status, row.count])),
      mainPairs: { total: main.size, withoutConfirmedRule: missing },
      unknownListenerLines: unknownListener,
      dialogueLines: dialogue.length,
    },
    warnings,
    /**
     * Caps to start with: the expectation (or the maximum) plus room for re-requests. No input cap
     * while a connection's fixed overhead is unmeasured: the estimate would leave it out and the run
     * would stop early. One run measures it.
     */
    suggestedLimits: {
      maxCalls: Math.ceil((calls.expected ?? calls.max) * 1.3) || undefined,
      maxInputTokens: unmeasured ? undefined : Math.ceil((inputTokens.expected ?? inputTokens.max) * 1.3) || undefined,
    },
  };
}

/**
 * What in this run's own lines would make the translation worse, for a person to fix first:
 * dialogue whose listener is unknown, speech rules its speaker → listener pairs use that no person
 * has looked at (candidates, or set by AI), and glossary terms its lines mention that are not
 * confirmed by a person.
 */
function readinessOf(db: Db, projectId: string, units: { kind: string; speaker: string | null; source: string; listener: string | null; listenerOrigin: string | null; listenerConfidence: number | null }[], index: ReturnType<typeof speechRuleIndex>) {
  const dialogue = units.filter((unit) => unit.kind === 'dialogue');
  const unknownListener = dialogue.filter((unit) => !unit.listener || isUnsureListener(unit as never)).length;
  const pairs = new Map<string, number>();
  for (const unit of dialogue) if (unit.speaker && unit.listener && !isUnsureListener(unit as never)) {
    const key = `${index.norm(unit.speaker)}|${index.norm(unit.listener)}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const rules = db
    .select({ from: s.speechRules.fromName, to: s.speechRules.toName })
    .from(s.speechRules)
    .where(and(eq(s.speechRules.projectId, projectId), ne(s.speechRules.status, 'rejected'), sql`(${s.speechRules.status} = 'candidate' or ${s.speechRules.statusBy} = 'ai')`))
    .all()
    .filter((rule) => pairs.has(`${index.norm(rule.from)}|${index.norm(rule.to)}`));
  const unreviewedRules = [...new Map(rules.map((rule) => [`${index.norm(rule.from)}|${index.norm(rule.to)}`, rule])).values()];
  const terms = db
    .select({ source: s.terms.source })
    .from(s.terms)
    .where(and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'), sql`(${s.terms.status} = 'candidate' or ${s.terms.statusBy} = 'ai')`))
    .all();
  const mentioned = terms.length ? termMatcher(terms, (term) => term.source) : null;
  const unreviewedTerms = mentioned ? new Set(units.flatMap((unit) => mentioned.find(unit.source).map((term) => term.source))) : new Set<string>();
  return {
    dialogueLines: dialogue.length,
    unknownListenerLines: unknownListener,
    unreviewedRules: { count: unreviewedRules.length, examples: unreviewedRules.slice(0, 3).map((rule) => `${rule.from} → ${rule.to}`) },
    unreviewedTerms: { count: unreviewedTerms.size, examples: [...unreviewedTerms].slice(0, 3) },
  };
}

/**
 * How long and how much, from the connections' own recent calls in runs: the median seconds per
 * request, spread over the connection's parallel requests, and the average cost a provider
 * reported. CLI connections run on a subscription. null where there is no history yet.
 */
function paceOf(db: Db, estimates: NodeEstimate[]) {
  let seconds: number | null = 0;
  let cost: number | null = 0;
  let subscription = false;
  for (const estimate of estimates) {
    if (!estimate.connection) continue;
    const requests = estimate.requests.expected ?? estimate.requests.max;
    const calls = db
      .select({ started: s.aiCalls.startedAt, finished: s.aiCalls.finishedAt, cost: s.aiCalls.costUsd })
      .from(s.aiCalls)
      .where(and(eq(s.aiCalls.connectionId, estimate.connection.id), eq(s.aiCalls.kind, 'run'), eq(s.aiCalls.status, 'ok')))
      .orderBy(desc(s.aiCalls.startedAt))
      .limit(30)
      .all()
      .filter((call) => call.finished);
    const parallel = db.select({ concurrency: s.connections.concurrency }).from(s.connections).where(eq(s.connections.id, estimate.connection.id)).get()?.concurrency ?? 1;
    if (!calls.length) seconds = null;
    else if (seconds !== null) {
      const durations = calls.map((call) => (call.finished!.getTime() - call.started.getTime()) / 1000).sort((a, b) => a - b);
      seconds += (durations[Math.floor(durations.length / 2)] * requests) / Math.max(1, parallel);
    }
    if (estimate.connection.cli) subscription = true;
    else {
      const priced = calls.filter((call) => call.cost !== null);
      if (!priced.length) cost = null;
      else if (cost !== null) cost += (priced.reduce((sum, call) => sum + call.cost!, 0) / priced.length) * requests;
    }
  }
  return { seconds: seconds === null ? null : Math.round(seconds), costUsd: cost, subscription };
}

/**
 * The main path: nodes reached from the entry through out / pass / true exits. Lines are expected to
 * pass each of them once; nodes only a fail / false / error exit leads to get a range instead.
 */
const MAIN_EXITS = new Set(['out', 'pass', 'true']);
function linesThrough(definition: WorkflowDefinition) {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const seen = new Set<string>();
  const queue = entry ? [entry.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of definition.edges) if (edge.source === id && MAIN_EXITS.has(edge.sourceHandle)) queue.push(edge.target);
  }
  return seen;
}

/** Requests per line this node took in this workflow's recent runs, or null when it never ran. */
function rateFromHistory(db: Db, workflowId: string, nodeId: string): number | null {
  const runs = db.select({ id: s.runs.id, total: s.runs.total }).from(s.runs).where(and(eq(s.runs.workflowId, workflowId), eq(s.runs.status, 'completed'))).orderBy(desc(s.runs.createdAt)).limit(5).all();
  if (!runs.length) return null;
  const steps = db.select({ count: sql<number>`count(*)` }).from(s.runSteps).where(and(inArray(s.runSteps.runId, runs.map((run) => run.id)), eq(s.runSteps.nodeId, nodeId))).get()!;
  const lines = runs.reduce((total, run) => total + run.total, 0);
  return lines ? steps.count / lines : null;
}

/** Median input the connection reported beyond our own prompt, over recent successful calls. */
function overheadOf(db: Db, connectionId: string): number | null {
  const steps = db
    .select({ input: s.runSteps.inputTokens, prompt: s.runSteps.prompt })
    .from(s.runSteps)
    .where(and(eq(s.runSteps.connectionId, connectionId), eq(s.runSteps.ok, true), isNotNull(s.runSteps.inputTokens), isNotNull(s.runSteps.prompt)))
    .orderBy(desc(s.runSteps.finishedAt))
    .limit(HISTORY)
    .all();
  if (!steps.length) return null;
  const extra = steps.map((step) => Math.max(0, step.input! - estimateTokens(step.prompt!))).sort((a, b) => a - b);
  return extra[Math.floor(extra.length / 2)];
}

/** Average estimated tokens of the prompt a node would send, built for a few of its real requests. */
function samplePrompt(db: Db, projectId: string, node: AiNode, languages: { source: string; target: string }, requests: { id: string }[][]): number {
  if (!requests.length) return 0;
  const step = Math.max(1, Math.floor(requests.length / SAMPLE));
  const picked = requests.filter((_, index) => index % step === 0).slice(0, SAMPLE);
  const sizes = picked.map((request) => {
    const rows = db.select().from(s.units).where(inArray(s.units.id, request.map((line) => line.id))).all().sort((a, b) => a.seq - b.seq);
    const context = buildContext(db, projectId, rows, node.config.context);
    const lines = rows.map((row, index) => ({ id: String(index + 1), unitId: row.id, groupId: row.groupId, key: row.key, speaker: row.speaker, source: row.source, candidate: row.translation ?? undefined }));
    const { system, prompt } = buildPrompt(node, languages, context, lines);
    return estimateTokens(`${system}\n\n${prompt}`);
  });
  return Math.round(sizes.reduce((total, size) => total + size, 0) / sizes.length);
}

/** Batches shown in the plan; a 50k-line run has about a thousand, the rest are counted. */
const BATCH_LIST_LIMIT = 300;

type PlannedLine = { groupId: string; speaker: string | null; tokens: number };

/**
 * The plan batch by batch, for the user to judge before starting: the scenes in each, and why each
 * scene joined the one before it (the planBatches rules: a dialogue-graph transition, a shared
 * speaker, or a request still under half full).
 */
export function listBatches(db: Db, batches: PlannedLine[][]) {
  const shown = batches.slice(0, BATCH_LIST_LIMIT);
  const groupIds = [...new Set(shown.flat().map((line) => line.groupId))];
  const titles = new Map(inChunks(groupIds, (ids) => db.select({ id: s.groups.id, title: s.groups.title }).from(s.groups).where(inArray(s.groups.id, ids)).all()).map((group) => [group.id, group.title]));
  const linked = sceneLinks(db, shown.flat());
  return {
    total: batches.length,
    batches: shown.map((batch) => {
      const scenes = [...Map.groupBy(batch, (line) => line.groupId).entries()];
      return {
        lines: batch.length,
        tokens: batch.reduce((sum, line) => sum + line.tokens, 0),
        scenes: scenes.map(([groupId, lines], index) => {
          if (index === 0) return { groupId, title: titles.get(groupId) ?? groupId, lines: lines.length, joined: null };
          const before = new Set(scenes.slice(0, index).flatMap(([, earlier]) => earlier.map((line) => line.speaker)).filter(Boolean));
          const shared = [...new Set(lines.map((line) => line.speaker).filter((speaker): speaker is string => !!speaker && before.has(speaker)))];
          const joined = linked(scenes[index - 1][0], groupId) ? { why: 'link' as const } : shared.length ? { why: 'speaker' as const, speakers: shared.slice(0, 3) } : { why: 'fill' as const };
          return { groupId, title: titles.get(groupId) ?? groupId, lines: lines.length, joined };
        }),
      };
    }),
  };
}
