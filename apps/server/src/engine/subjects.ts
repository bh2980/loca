import { and, asc, count, desc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
  SPEECH_LEVEL_LABELS,
  contextFor,
  decidedBy,
  estimateTokens,
  isUnknownListener,
  lineMarksOf,
  linesById,
  matchesMarks,
  someOf,
  termMarksOf,
  withDuplicateTargets,
  type AiNode,
  type BatchConfig,
  type ConditionData,
  type NodeOf,
  type RunScope,
  type Subject,
  type TagScope,
  type WorkflowDefinition,
} from '@tw/shared';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { tokensSql } from '../db/tokens.ts';
import { buildContext, runPairLines, type BatchContext } from '../services/context.ts';
import { tagsOf } from '../services/knowledge-tags.ts';
import { lineConditions } from '../services/line-filter.ts';
import { excludedSql, translatableSql } from '../services/line-marks.ts';
import { knowledgeOf, speechRuleIndex } from '../services/speech.ts';
import { fillTermUsage } from '../services/term-usage.ts';
import { packGroups, planBatches } from './batches.ts';
import { lineExitActions, termExitActions, type ExitApplier } from './exit-actions.ts';
import { lineOf, termOf, type FunctionInput } from './functions/types.ts';
import { buildPrompt, promptLineId, type PromptLine } from './prompts.ts';
import { wholeScriptRequest } from './whole-script.ts';

/*
 * What a run's items are: lines, or terms. Everything the engine, the run estimate and the request builder need
 * to know about the kind of item is asked of its adapter here (subjectOf); nothing else compares the subject.
 * SUBJECT_ADAPTERS is keyed by every subject, so a new one does not compile until it answers all of it.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Item = typeof s.runItems.$inferSelect;
type Unit = typeof s.units.$inferSelect;
type Term = typeof s.terms.$inferSelect;
type RunRef = { id: string; projectId: string };

/** A queued item waiting at a node that calls out, with its position for batching. */
export type Waiting = { id: string; unitId: string; nodeId: string; groupId: string; seq: number; kind: string; tokens: number; since: Date; plan: number | null; factor: number; /** The model a retry rule sends it to this node on (a run.models key); null: the node's own. */ model: string | null };

/**
 * One subject of a request: a line or a term by id, with what a run has for it so far. A preview knows
 * only the id: the request then shows what is stored (the line's translation, the term's Korean form).
 */
export interface RequestItem {
  id: string;
  /** The run's working text for it (ItemData.candidateText). */
  candidate?: string;
  /** What the last failing check or verdict found (ItemData.issues). */
  issues?: string[];
  /** The previous step's result for it (input.previous, trimmed to input.fields), when the node reads one. */
  previous?: unknown;
}

/** A request's prompt for its items, before the answer schema is added (request.ts). */
export interface RequestParts {
  system: string;
  prompt: string;
  /** What went into the prompt besides the items, why, and what was dropped for the cap. */
  context: BatchContext;
  /** The items as the prompt numbers them, in request order: an answer is read back against these (readAiOutput). */
  lines: PromptLine[];
  /** Sent as script text (batch mode "whole") instead of the per-item prompt. */
  whole: boolean;
}

export interface SubjectAdapter {
  subject: Subject;
  /** Where the tags that may go on its items belong (tags.scope). */
  tagScope: TagScope;
  /** What a start says when its scope names no item. */
  nothingInScope: string;
  /** What an item fails with when the row behind it is gone. */
  gone: string;

  /** The items a run of `scope` starts with, in run order. */
  select(db: Db, projectId: string, scope: RunScope): string[];
  /** The scope naming exactly these items, whatever their status (a run continued with what it has left). */
  scopeOf(ids: string[]): RunScope;
  /** Each item's plan batch, for a subject whose items travel together (lines, by scene); empty: batched as they wait. */
  plan(db: Db | Tx, definition: WorkflowDefinition, ids: string[]): Map<string, number>;
  /** Queued items at the nodes `slowIds` that are due (not held by a retry rule's wait), as light rows in the order they are batched. */
  waiting(db: Db, runId: string, slowIds: string[], now: Date): Waiting[];
  /**
   * The request a run of everything would put `subjectId` in at a node that batches by `config`: the ids of that
   * request's items in request order, or null when such a run would not take the item.
   */
  batchOf(db: Db, projectId: string, definition: WorkflowDefinition, config: BatchConfig, subjectId: string): string[] | null;

  /** What functions and conditions get for each item: the row behind it with its tags. Undefined for an item whose row is gone. */
  inputs(db: Db | Tx, run: RunRef, items: Item[]): (item: Item) => FunctionInput | undefined;
  /** What a condition reads about the item (ConditionData's `candidate` and its subject part). */
  condition(tx: Tx, run: RunRef, node: NodeOf<'condition'>, input: FunctionInput): Pick<ConditionData, 'candidate' | 'unit' | 'term'>;
  /** The request an AI node makes of `items`, as this subject shows them, with the context chosen for them. */
  request(db: Db, projectId: string, node: AiNode, languages: { source: string; target: string }, items: RequestItem[], choiceOptions: string[] | undefined, runId: string | undefined): RequestParts;
  /** How an item takes an exit's actions (tags, status). */
  exitActions: ExitApplier;

  /** The item's name in lists and messages, as a column of a run_items query: a line's key, a term's source. */
  itemKey: SQL<string | null>;
  /** A run's items in the subject's own order (a query on run_items), as an ORDER BY of a run_items query. */
  itemOrder: SQL[];
  /** A page of a run's item ids in the subject's order; items whose row is gone are left out. */
  itemIds(db: Db, where: SQL | undefined, limit: number, offset: number): string[];
  /** Of these subject ids, the ones whose row is there, with what a list shows of a term (the browser has lines already). */
  itemRows(db: Db, subjectIds: string[]): Map<string, { term: { source: string; target: string | null } | null }>;
}

// ── shared by both ──────────────────────────────────────────────────

/** The size factor a retry rule left on a queued item (1 for one never sent back), as a column of the waiting rows. */
const RETRY_FACTOR = sql<number>`coalesce(${s.itemData.retryFactor}, 1)`;
/** The model a retry rule sends a queued item to its node on (a run.models key), or null: the node's own. Only counts at the AI node it was set for. */
const RETRY_MODEL = sql<string | null>`case when ${s.itemData.retryModelNodeId} = ${s.runItems.nodeId} then ${s.itemData.retryModelKey} end`;
const due = (runId: string, slowIds: string[], now: Date) =>
  and(eq(s.runItems.runId, runId), eq(s.runItems.state, 'queued'), inArray(s.runItems.nodeId, slowIds), or(isNull(s.runItems.notBefore), lte(s.runItems.notBefore, now)));

// ── lines ────────────────────────────────────────────────────────────

/** Selects the lines a run starts with: what the scope's filter names (the line filter every list uses). 번역 제외 lines never enter a run, whatever the scope names. */
export function selectRunUnits(db: Db, projectId: string, scope: RunScope): string[] {
  return db.select({ id: s.units.id }).from(s.units).where(and(...lineConditions(projectId, scope.filter ?? {}), translatableSql(projectId))).all().map((row) => row.id);
}

/** Lines the scope names that 번역 제외 keeps out of the run (the run dialog says how many). */
export function excludedInScope(db: Db, projectId: string, scope: RunScope): number {
  return db.select({ count: count() }).from(s.units).where(and(...lineConditions(projectId, scope.filter ?? {}), excludedSql(projectId))).get()!.count;
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
  const columns = { id: s.units.id, groupId: s.units.groupId, seq: s.units.seq, kind: s.units.kind, speaker: s.units.speaker, tokens: tokensSql(s.units.source) };
  if (unitIds.length < 2_000) return inChunks(unitIds, (ids) => db.select(columns).from(s.units).where(inArray(s.units.id, ids)).all());
  const projectId = db.select({ projectId: s.units.projectId }).from(s.units).where(eq(s.units.id, unitIds[0])).get()?.projectId;
  if (!projectId) return [];
  const wanted = new Set(unitIds);
  return db.select(columns).from(s.units).where(eq(s.units.projectId, projectId)).all().filter((line) => wanted.has(line.id));
}

/** The first AI node a line reaches from the entry: the run plan is made with its batch settings. */
function firstAiNode(definition: WorkflowDefinition): AiNode | undefined {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const seen = new Set<string>();
  const queue = entry ? [entry.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = definition.nodes.find((candidate) => candidate.id === id);
    if (node?.type === 'ai') return node;
    for (const edge of definition.edges) if (edge.source === id) queue.push(edge.target);
  }
  return undefined;
}

/**
 * The run plan: which lines travel together through every AI node. Planned once, when the run
 * starts, with the batch settings of the first AI node the lines reach (see planBatches): script
 * order, scenes kept whole, dialogue apart from documents and UI, unrelated scenes not mixed.
 * Every node then moves lines by these batches, so a scene that was translated together is
 * reviewed together. Returns unit id → batch number; empty when the workflow has no AI node.
 * `lines`: the units as planLines reads them, when the caller has them already.
 */
export function planRun(db: Db | Tx, definition: WorkflowDefinition, unitIds: string[], lines = planLines(db, unitIds)) {
  const first = firstAiNode(definition);
  if (!first) return new Map<string, number>();
  const batches = planBatches(lines, first.config.batch, sceneLinks(db, lines));
  return new Map(batches.flatMap((batch, index) => batch.map((line) => [line.id, index] as const)));
}

/**
 * A plan's batches as every node meets them: the lines in script order, grouped by their plan batch.
 * The runner groups the lines waiting at a node the same way before it packs them (packGroups).
 */
export const planGroups = <T extends { id: string; seq: number }>(lines: T[], plan: Map<string, number>): T[][] => [
  ...Map.groupBy(lines.filter((line) => plan.has(line.id)).sort((a, b) => a.seq - b.seq), (line) => plan.get(line.id)!).values(),
];

/** Lines as a request numbers them ("L1"…), in the order given, with their rows (what the context is chosen from). */
function unitLines(db: Db, items: RequestItem[]): { rows: Unit[]; lines: PromptLine[] } {
  const units = new Map(inChunks(items.map((item) => item.id), (ids) => db.select().from(s.units).where(inArray(s.units.id, ids)).all()).map((unit) => [unit.id, unit]));
  const rows = items.map((item) => {
    const unit = units.get(item.id);
    if (!unit) throw new Error('요청에 넣을 대사를 찾을 수 없습니다 (지워졌을 수 있습니다).');
    return unit;
  });
  const lines = items.map((item, index): PromptLine => {
    const unit = rows[index]!;
    return {
      id: promptLineId(index),
      unitId: unit.id,
      groupId: unit.groupId,
      key: unit.key,
      kind: unit.kind,
      speaker: unit.speaker,
      source: unit.source,
      candidate: item.candidate ?? unit.translation ?? undefined,
      issues: item.issues,
      ...(item.previous !== undefined && { previous: item.previous }),
    };
  });
  return { rows, lines };
}

const lines: SubjectAdapter = {
  subject: 'lines',
  tagScope: 'lines',
  nothingInScope: '조건에 맞는 대사가 없습니다.',
  gone: '원문이 없습니다.',

  select: selectRunUnits,
  scopeOf: (ids) => ({ filter: linesById(ids) }),
  plan: (db, definition, ids) => planRun(db, definition, ids),
  waiting: (db, runId, slowIds, now) =>
    db
      .select({
        id: s.runItems.id,
        unitId: s.runItems.subjectId,
        nodeId: s.runItems.nodeId,
        groupId: s.units.groupId,
        seq: s.units.seq,
        kind: s.units.kind,
        tokens: tokensSql(s.units.source),
        since: s.runItems.updatedAt,
        plan: s.runItems.plan,
        factor: RETRY_FACTOR,
        model: RETRY_MODEL,
      })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.subjectId))
      .where(due(runId, slowIds, now))
      .orderBy(asc(s.units.seq))
      .all(),
  batchOf(db, projectId, definition, config, subjectId) {
    // The run's own steps: the lines such a run takes, its plan (scenes linked in the dialogue graph kept together)
    // and the node's packing of that plan.
    const unitIds = selectRunUnits(db, projectId, {});
    if (!unitIds.includes(subjectId)) return null;
    const rows = planLines(db, unitIds);
    const requests = packGroups(planGroups(rows, planRun(db, definition, unitIds, rows)), config);
    return requests.find((request) => request.some((line) => line.id === subjectId))?.map((line) => line.id) ?? [subjectId];
  },

  inputs(db, run, items) {
    const units = new Map(inChunks(items.map((item) => item.subjectId), (ids) => db.select().from(s.units).where(inArray(s.units.id, ids)).all()).map((unit) => [unit.id, unit]));
    const tags = Map.groupBy(inChunks([...units.keys()], (ids) => db.select().from(s.unitTags).where(inArray(s.unitTags.unitId, ids)).all()), (row) => row.unitId);
    return (item) => {
      const unit = units.get(item.subjectId);
      return unit && { subject: 'lines', unit, item, tagIds: (tags.get(unit.id) ?? []).map((row) => row.tagId), projectId: run.projectId, runId: run.id };
    };
  },
  condition(tx, run, node, input) {
    const unit = lineOf(input);
    const final = tx.select({ kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.id, unit.statusId)).get()?.kind === 'final';
    const rules = knowledgeOf(tx as unknown as Db, run.projectId).settings()?.formatRules;
    const suggested = Boolean(tx.select({ id: s.candidates.id }).from(s.candidates).where(and(eq(s.candidates.unitId, unit.id), eq(s.candidates.state, 'pending'))).get());
    // Only a condition that reads the line's speech rule pays for resolving it.
    const rule = JSON.stringify(node.config.expression ?? null).includes('unit.speechLevel') ? speechRuleIndex(tx as unknown as Db, run.projectId).resolve([unit]).get(unit.key)?.rule : undefined;
    return {
      candidate: input.item.data.candidateText ?? unit.translation,
      unit: {
        kind: unit.kind,
        speaker: unit.speaker,
        listener: unit.listener,
        listenerUnknown: isUnknownListener(unit, rules),
        statusId: unit.statusId,
        final,
        statusBy: unit.statusBy,
        noted: unit.note.trim() !== '',
        tagIds: input.tagIds,
        marks: lineMarksOf({ suggested }),
        speechLevel: rule ? SPEECH_LEVEL_LABELS[rule.level] : null,
      },
    };
  },
  request(db, projectId, node, languages, items, choiceOptions, runId) {
    const { rows, lines: promptLines } = unitLines(db, items);
    // A node reading the script whole sends it as compact script text (whole-script.ts), its lines
    // numbered L1… over the whole request; every other node gets the batch prompt with the context it asks for.
    if (node.config.batch.mode === 'whole') {
      const whole = wholeScriptRequest(db, projectId, node, languages, rows, choiceOptions);
      for (const line of promptLines) line.id = whole.idOf.get(line.key) ?? line.id;
      return { system: whole.system, prompt: whole.prompt, context: whole.context, lines: promptLines, whole: true };
    }
    const config = contextFor('lines', node.config.context);
    // A request that reads earlier results instead of lines (a merge) asks about the people those results name.
    const parts = !node.config.input.lines && node.config.input.previous ? JSON.stringify(promptLines.flatMap((line) => (line.previous === undefined ? [] : [line.previous]))) : undefined;
    const context = buildContext(db, projectId, rows, config, parts, parts !== undefined && config.pairs && runId ? runPairLines(db, runId) : undefined);
    return { ...buildPrompt(node, languages, context, promptLines, choiceOptions), context, lines: promptLines, whole: false };
  },
  exitActions: lineExitActions,

  itemKey: sql<string | null>`(select ${s.units.key} from ${s.units} where ${s.units.id} = ${s.runItems.subjectId})`,
  itemOrder: [asc(sql`(select ${s.units.seq} from ${s.units} where ${s.units.id} = ${s.runItems.subjectId})`)],
  itemIds: (db, where, limit, offset) =>
    db.select({ id: s.runItems.id }).from(s.runItems).innerJoin(s.units, eq(s.units.id, s.runItems.subjectId)).where(where).orderBy(asc(s.units.seq)).limit(limit).offset(offset).all().map((row) => row.id),
  itemRows: (db, subjectIds) => new Map(inChunks(subjectIds, (ids) => db.select({ id: s.units.id }).from(s.units).where(inArray(s.units.id, ids)).all()).map((unit) => [unit.id, { term: null }])),
};

// ── terms ────────────────────────────────────────────────────────────

/** A term in a request: its text plus roughly what its example lines add. */
const EXAMPLE_TOKENS = 40;
/** The size a term counts for when requests are packed (the waiting rows' `tokens`). */
export const termTokens = (source: string) => estimateTokens(source) + EXAMPLE_TOKENS;
/** Term items have no scene: they share one group, so batch rules that keep scenes whole do not apply. */
export const TERM_GROUP = 'terms';
/** The order terms wait in at a node (so the order they are batched in): most used first, then by source. */
const TERM_ORDER = [desc(sql`coalesce(${s.terms.lines}, 0)`), asc(s.terms.source)];

/**
 * The terms a run of a terms workflow starts with, most used first: the scope's terms, narrowed by its
 * statuses, who decided them, an empty Korean form, marks (the glossary's rules: matchesMarks) and tags (all of them). Rejected terms are hidden like in the glossary: only a scope that asks for them
 * (statuses include rejected) takes them. Usage counts are filled first, so "most used" and the 미사용 mark are current.
 */
export function selectRunTerms(db: Db, projectId: string, scope: RunScope): string[] {
  const wanted = scope.terms ?? {};
  if (wanted.nothing) return [];
  fillTermUsage(db, projectId);
  const named = wanted.ids ? new Set<string>(wanted.ids) : null;
  const statuses: readonly string[] | undefined = wanted.statuses;
  const rows = withDuplicateTargets(db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all());
  const tags = wanted.tagIds ? tagsOf(db, 'terms', rows.map((term) => term.id)) : null;
  return rows
    .filter((term) => (!named || named.has(term.id)) && (statuses ? statuses.includes(term.status) : term.status !== 'rejected') && (!wanted.decidedBy || decidedBy(term, wanted.decidedBy)) && (wanted.emptyTarget === undefined || !term.target.trim() === wanted.emptyTarget) && matchesMarks(termMarksOf(term), wanted.marks) && (!tags || wanted.tagIds!.every((id) => tags.get(term.id)?.some((tag) => tag.id === id))))
    .sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0) || a.source.localeCompare(b.source))
    .map((term) => term.id);
}

/** Terms by id with their tags, for functions and conditions. */
export function loadTerms(db: Db | Tx, ids: string[]) {
  const terms = new Map(inChunks(ids, (chunk) => db.select().from(s.terms).where(inArray(s.terms.id, chunk)).all()).map((term) => [term.id, term]));
  const tags = Map.groupBy(
    inChunks([...terms.keys()], (chunk) => db.select({ itemId: s.knowledgeTags.itemId, tagId: s.knowledgeTags.tagId }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, 'terms'), inArray(s.knowledgeTags.itemId, chunk))).all()),
    (row) => row.itemId,
  );
  return { terms, tagsOf: (id: string) => (tags.get(id) ?? []).map((row) => row.tagId) };
}

/**
 * Terms as a request shows them ("T1"…): the term, its current Korean form and note, how many lines use
 * it, and up to `context.examples` of those lines with their translations. The request's context
 * (glossary, characters, documents…) is chosen from the terms themselves and from those example lines.
 */
function termLines(db: Db, projectId: string, node: AiNode, items: RequestItem[]): { lines: PromptLine[]; context: BatchContext } {
  const config = contextFor('terms', node.config.context);
  const terms = new Map(inChunks(items.map((item) => item.id), (ids) => db.select().from(s.terms).where(inArray(s.terms.id, ids)).all()).map((term) => [term.id, term]));
  const keys = [...new Set(items.flatMap((item) => terms.get(item.id)?.examples.slice(0, config.examples) ?? []))];
  const units = new Map(inChunks(keys, (chunk) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, chunk))).all()).map((unit) => [unit.key, unit]));
  // One prompt item per request item, in order: the answer is read back by position.
  const promptLines = items.map((item, index): PromptLine => {
    const term = terms.get(item.id);
    const previous = item.previous !== undefined && { previous: item.previous };
    if (!term) return { id: promptLineId(index, 'T'), unitId: item.id, groupId: TERM_GROUP, key: item.id, kind: 'term', speaker: null, source: '', term: { examples: [] }, ...previous };
    const examples = term.examples.slice(0, config.examples).flatMap((key) => {
      const unit = units.get(key);
      return unit ? [{ speaker: unit.speaker ?? undefined, source: unit.source, translation: unit.translation ?? undefined }] : [];
    });
    return {
      id: promptLineId(index, 'T'),
      unitId: term.id,
      groupId: TERM_GROUP,
      key: term.source,
      kind: 'term',
      speaker: null,
      source: term.source,
      candidate: item.candidate ?? (term.target || undefined),
      issues: item.issues,
      term: { target: term.target || undefined, note: term.note || undefined, uses: term.lines ?? undefined, examples },
      ...previous,
    };
  });
  // The context is chosen from the terms themselves (a confirmed "Brin" goes with "Brin Guild") and
  // from their example lines, so 확정 용어 works without examples too.
  const own = items.flatMap((item) => {
    const term = terms.get(item.id);
    return term ? [{ id: `term:${term.id}`, key: `term:${term.id}`, groupId: TERM_GROUP, sort: 0, speaker: null, source: term.source }] : [];
  });
  const context = buildContext(db, projectId, [...own, ...units.values()], config);
  // A term being translated is not its own context.
  const asked = new Set(own.map((row) => row.source.toLowerCase()));
  context.terms = context.terms.filter((term) => !asked.has(term.source.toLowerCase()));
  context.items = context.items.filter((item) => item.kind !== 'term' || !asked.has(item.label.split(' → ')[0]!.toLowerCase()));
  return { lines: promptLines, context };
}

const terms: SubjectAdapter = {
  subject: 'terms',
  tagScope: 'terms',
  nothingInScope: '조건에 맞는 용어가 없습니다.',
  gone: '용어가 없습니다.',

  select: selectRunTerms,
  scopeOf: (ids) => {
    const some = someOf(ids);
    return { terms: some ? { ids: some } : { nothing: true } };
  },
  // Terms have no scenes to plan by: the runner batches them as they wait (count / one by one).
  plan: () => new Map(),
  waiting: (db, runId, slowIds, now) =>
    db
      .select({
        id: s.runItems.id,
        unitId: s.runItems.subjectId,
        nodeId: s.runItems.nodeId,
        groupId: sql<string>`${TERM_GROUP}`,
        seq: sql<number>`0`,
        kind: sql<string>`'term'`,
        tokens: sql<number>`${tokensSql(s.terms.source)} + ${EXAMPLE_TOKENS}`,
        since: s.runItems.updatedAt,
        plan: s.runItems.plan,
        factor: RETRY_FACTOR,
        model: RETRY_MODEL,
      })
      .from(s.runItems)
      .innerJoin(s.terms, eq(s.terms.id, s.runItems.subjectId))
      .where(due(runId, slowIds, now))
      .orderBy(...TERM_ORDER)
      .all()
      .map((row, index) => ({ ...row, seq: index })),
  batchOf(db, projectId, _definition, config, subjectId) {
    // Terms have no plan; the runner batches them as they wait, most used first.
    const taken = new Set(selectRunTerms(db, projectId, {}));
    if (!taken.has(subjectId)) return null;
    const waiting = db.select({ id: s.terms.id, source: s.terms.source }).from(s.terms).where(eq(s.terms.projectId, projectId)).orderBy(...TERM_ORDER).all().filter((term) => taken.has(term.id)).map((term, seq) => ({ id: term.id, groupId: TERM_GROUP, seq, kind: 'term', tokens: termTokens(term.source) }));
    return planBatches(waiting, config).find((request) => request.some((term) => term.id === subjectId))?.map((term) => term.id) ?? null;
  },

  inputs(db, run, items) {
    const loaded = loadTerms(db, items.map((item) => item.subjectId));
    return (item) => {
      const term = loaded.terms.get(item.subjectId);
      return term && { subject: 'terms', term, item, tagIds: loaded.tagsOf(term.id), projectId: run.projectId, runId: run.id };
    };
  },
  condition(_tx, _run, _node, input) {
    const term = termOf(input);
    return {
      candidate: input.item.data.candidateText ?? (term.target || null),
      term: { status: term.status, statusBy: term.statusBy, hasTarget: Boolean(term.target.trim()), lines: term.lines, marks: termMarksOf(term), tagIds: input.tagIds },
    };
  },
  request(db, projectId, node, languages, items, choiceOptions) {
    const { lines: promptLines, context } = termLines(db, projectId, node, items);
    return { ...buildPrompt(node, languages, context, promptLines, choiceOptions), context, lines: promptLines, whole: false };
  },
  exitActions: termExitActions,

  itemKey: sql<string | null>`(select ${s.terms.source} from ${s.terms} where ${s.terms.id} = ${s.runItems.subjectId})`,
  itemOrder: [desc(sql`(select coalesce(${s.terms.lines}, 0) from ${s.terms} where ${s.terms.id} = ${s.runItems.subjectId})`), asc(sql`(select ${s.terms.source} from ${s.terms} where ${s.terms.id} = ${s.runItems.subjectId})`)],
  itemIds: (db, where, limit, offset) =>
    db.select({ id: s.runItems.id }).from(s.runItems).innerJoin(s.terms, eq(s.terms.id, s.runItems.subjectId)).where(where).orderBy(...TERM_ORDER).limit(limit).offset(offset).all().map((row) => row.id),
  itemRows: (db, subjectIds) =>
    new Map(inChunks(subjectIds, (ids) => db.select({ id: s.terms.id, source: s.terms.source, target: s.terms.target }).from(s.terms).where(inArray(s.terms.id, ids)).all()).map((term) => [term.id, { term: { source: term.source, target: term.target as string | null } }])),
};

const SUBJECT_ADAPTERS: Record<Subject, SubjectAdapter> = { lines, terms };

/** The adapter of a run's (or a workflow's) kind of item. */
export const subjectOf = (subject: Subject): SubjectAdapter => SUBJECT_ADAPTERS[subject];
