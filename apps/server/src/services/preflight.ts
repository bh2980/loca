import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { batchConfigSchema, CONNECTION_KIND_INFO, estimateTokens, isFreeModel, isUnknownListener, isUnreviewed, needsListener, nodeName, termMatcher, type AiNode, type WorkflowDefinition } from '@tw/shared';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { packGroups } from '../engine/batches.ts';
import { buildPrompt } from '../engine/prompts.ts';
import { planRun, sceneLinks, selectRunUnits } from '../engine/runner.ts';
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
  /** The same model as a choice: the node's own, or the run's pick (the run dialog's picker starts from it). */
  choice: { connectionId: string; model: string; effort?: string };
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
      choice: node.config.model,
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
  const readiness = readinessOf(db, projectId, units, speechRuleIndex(db, projectId));
  const pace = paceOf(db, estimates);

  return {
    readiness,
    pace,
    lines: { total: units.length, translated: units.filter((unit) => unit.translation).length, untranslated: units.filter((unit) => !unit.translation).length },
    plan: {
      batches: sizes.length,
      linesPerBatch: sizes.length ? { min: sizes[0], median: sizes[Math.floor(sizes.length / 2)], max: sizes.at(-1)! } : null,
      list: batchList,
    },
    nodes: estimates,
    totals: { calls, inputTokens },
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

/** The items' ids for a link that lists only them; past the cap, `more` says the list would be partial. */
const IDS_CAP = 100;
const idList = (ids: string[]) => ({ ids: ids.slice(0, IDS_CAP), more: ids.length > IDS_CAP });

/**
 * What in this run's own lines would make the translation worse, for a person to fix first:
 * dialogue whose listener is unknown, speech rules its speaker → listener pairs use that no person
 * has looked at (isUnreviewed in shared: candidates, or set by AI), and glossary terms its lines mention that are not
 * confirmed by a person.
 */
function readinessOf(db: Db, projectId: string, units: { kind: string; speaker: string | null; source: string; listener: string | null; listenerOrigin: string | null; listenerConfidence: number | null }[], index: ReturnType<typeof speechRuleIndex>) {
  // Lines said to someone (needsListener: not narration, not format tokens only): the ones a listener matters for.
  const formatRules = db.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.rules;
  const dialogue = units.filter((unit) => needsListener(unit, formatRules));
  const unknownListener = dialogue.filter((unit) => isUnknownListener(unit as never, formatRules)).length;
  const pairs = new Map<string, number>();
  const names = new Map<string, string>();
  for (const unit of dialogue) if (unit.speaker && unit.listener && !isUnknownListener(unit as never, formatRules)) {
    const key = `${index.norm(unit.speaker)}|${index.norm(unit.listener)}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    names.set(key, `${unit.speaker} → ${unit.listener}`);
  }
  const rules = db
    .select({ id: s.speechRules.id, from: s.speechRules.fromName, to: s.speechRules.toName, status: s.speechRules.status, statusBy: s.speechRules.statusBy })
    .from(s.speechRules)
    .where(eq(s.speechRules.projectId, projectId))
    .all()
    .filter(isUnreviewed)
    .filter((rule) => pairs.has(`${index.norm(rule.from)}|${index.norm(rule.to)}`));
  const unreviewedRules = [...new Map(rules.map((rule) => [`${index.norm(rule.from)}|${index.norm(rule.to)}`, rule])).values()];
  // Pairs that speak often in these lines (5+) with no rule at all: their speech level is the model's guess.
  const ruled = new Set(db.select({ from: s.speechRules.fromName, to: s.speechRules.toName }).from(s.speechRules).where(and(eq(s.speechRules.projectId, projectId), ne(s.speechRules.status, 'rejected'))).all().map((rule) => `${index.norm(rule.from)}|${index.norm(rule.to)}`));
  const withoutRule = [...pairs].filter(([key, lines]) => lines >= 5 && !ruled.has(key)).sort((a, b) => b[1] - a[1]);
  const terms = db
    .select({ id: s.terms.id, source: s.terms.source, status: s.terms.status, statusBy: s.terms.statusBy })
    .from(s.terms)
    .where(eq(s.terms.projectId, projectId))
    .all()
    .filter(isUnreviewed);
  const mentioned = terms.length ? termMatcher(terms, (term) => term.source) : null;
  const unreviewedTerms = new Map<string, string>(mentioned ? units.flatMap((unit) => mentioned.find(unit.source).map((term) => [term.source, term.id] as const)) : []);
  return {
    dialogueLines: dialogue.length,
    unknownListenerLines: unknownListener,
    unreviewedRules: { count: unreviewedRules.length, examples: unreviewedRules.slice(0, 3).map((rule) => `${rule.from} → ${rule.to}`), ...idList(unreviewedRules.map((rule) => rule.id)) },
    unreviewedTerms: { count: unreviewedTerms.size, examples: [...unreviewedTerms.keys()].slice(0, 3), ...idList([...unreviewedTerms.values()]) },
    pairsWithoutRule: { count: withoutRule.length, examples: withoutRule.slice(0, 3).map(([key]) => names.get(key)!) },
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
    // opencode's built-in "-free" models cost nothing and need no plan (same rule as the UI badge).
    if (isFreeModel(estimate.connection.kind, estimate.choice.model)) continue;
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
    const lines = rows.map((row, index) => ({ id: String(index + 1), unitId: row.id, groupId: row.groupId, key: row.key, kind: row.kind, speaker: row.speaker, source: row.source, candidate: row.translation ?? undefined }));
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
