import { and, count, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { batchConfigSchema, entryConfigSchema, isWholeScriptWorkflow, termMarksOf, type AiNode, type WorkflowDefinition, type WorkflowSubject } from '@tw/shared';
import { fillTermUsage } from '../services/term-usage.ts';
import { inChunks, inList } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData } from '../db/schema.ts';
import { events } from '../events.ts';
import { excludedSql, markConditions, translatableSql } from '../services/line-marks.ts';
import { resolveBudgets } from '../services/budgets.ts';
import { planBatches } from './batches.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/*
 * Creating a run (#22): which lines it takes, how they are batched, and storing it — the part of a
 * run that happens before the Runner moves anything. Kept out of runner.ts so preflight can plan a
 * run without importing the scheduler (and the scheduler can use preflight's overhead estimate).
 */

/** The scope ∩ entry status filter, before 번역 제외 is taken out. */
function scopeConditions(db: Db, projectId: string, definition: WorkflowDefinition, scope: s.RunScope) {
  const entry = definition.nodes.find((node) => node.type === 'entry');
  const statusIds = scope.statusIds !== undefined ? scope.statusIds : (entry?.type === 'entry' ? entry.config.statusIds : []);
  const conditions = [eq(s.units.projectId, projectId)];
  if (statusIds.length && !scope.ignoreStatus) {
    conditions.push(inArray(s.units.statusId, statusIds));
    // A line a person translated is not "untranslated", even while it still sits in an initial status:
    // the entry filter must not pick it again and overwrite what they wrote.
    const initial = db.select({ id: s.statuses.id }).from(s.statuses).where(eq(s.statuses.kind, 'initial'));
    conditions.push(or(notInArray(s.units.statusId, initial), ne(s.units.statusBy, 'human'), sql`coalesce(trim(${s.units.translation}), '') = ''`)!);
  }
  // A scope can name every line of a large project; long lists travel as one JSON parameter.
  if (scope.groupIds?.length) conditions.push(inList(s.units.groupId, scope.groupIds));
  if (scope.unitIds?.length) conditions.push(inList(s.units.id, scope.unitIds));
  // Tags and marks combine with AND, like the line list's filter: a line must carry every one picked.
  for (const tagId of scope.tagIds ?? []) conditions.push(inArray(s.units.id, db.select({ id: s.unitTags.unitId }).from(s.unitTags).where(eq(s.unitTags.tagId, tagId))));
  conditions.push(...markConditions(projectId, scope.marks));
  return conditions;
}

/** Selects the lines a run starts with: scope ∩ entry status filter. 번역 제외 lines never enter a run, whatever the scope names. */
export function selectRunUnits(db: Db, projectId: string, definition: WorkflowDefinition, scope: s.RunScope): string[] {
  return db.select({ id: s.units.id }).from(s.units).where(and(...scopeConditions(db, projectId, definition, scope), translatableSql(projectId))).all().map((row) => row.id);
}

/**
 * The terms a term run starts with, most used first: the scope's termIds, or the entry node's
 * statuses and marks (default: candidates with no Korean form yet). Usage counts are filled first,
 * so "most used" and the 미사용 mark are current.
 */
export function selectRunTerms(db: Db, projectId: string, definition: WorkflowDefinition, scope: s.RunScope): string[] {
  fillTermUsage(db, projectId);
  const entry = entryConfigSchema.parse(definition.nodes.find((node) => node.type === 'entry')?.config ?? {});
  const named = scope.termIds?.length ? new Set(scope.termIds) : null;
  return db
    .select()
    .from(s.terms)
    .where(eq(s.terms.projectId, projectId))
    .all()
    .filter((term) => (named ? named.has(term.id) : entry.termStatuses.includes(term.status) && entry.termMarks.every((mark) => termMarksOf(term).includes(mark))))
    .sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0) || a.source.localeCompare(b.source))
    .map((term) => term.id);
}

/** Lines the scope names that 번역 제외 keeps out of the run (the run dialog says how many). */
export function excludedInScope(db: Db, projectId: string, definition: WorkflowDefinition, scope: s.RunScope): number {
  return db.select({ count: count() }).from(s.units).where(and(...scopeConditions(db, projectId, definition, scope), excludedSql(projectId))).get()!.count;
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

/** What a run takes, from its scope: terms when it says so or names terms, else lines. */
export const runSubject = (scope: Pick<s.RunScope, 'subject' | 'termIds'>): WorkflowSubject => scope.subject ?? (scope.termIds?.length ? 'terms' : 'lines');

type RunInput = { projectId: string; workflow: typeof s.workflows.$inferSelect; models: Record<string, s.AiSnapshot>; scope: s.RunScope; limits?: s.RunLimits };

/** The run's lines and their plan batches, and the run row to store. */
function runRows(db: Db, input: RunInput) {
  // "Auto" budgets are fixed here for the models this run calls: the plan and the runner use the same numbers.
  const definition = resolveBudgets(db, input.workflow.definition);
  const entry = definition.nodes.find((node) => node.type === 'entry');
  if (!entry) throw new Error('진입 노드가 없습니다.');
  const subject = runSubject(input.scope);
  const unitIds = subject === 'terms' ? selectRunTerms(db, input.projectId, definition, input.scope) : selectRunUnits(db, input.projectId, definition, input.scope);
  if (!unitIds.length) throw new Error(subject === 'terms' ? '조건에 맞는 용어가 없습니다.' : '조건에 맞는 대사가 없습니다.');
  const runId = crypto.randomUUID();
  // Terms have no scenes to plan by: the runner batches them as they wait (count / one by one).
  const plan = subject === 'terms' ? new Map<string, number>() : planRun(db, definition, unitIds);
  const run = {
    id: runId,
    projectId: input.projectId,
    workflowId: input.workflow.id,
    workflowName: input.workflow.name,
    workflowVersion: input.workflow.version,
    definition,
    models: input.models,
    subject,
    scope: input.scope,
    status: 'running' as s.RunStatus,
    total: unitIds.length,
    limits: input.limits ?? null,
  };
  const items = unitIds.map((unitId) => ({ runId, subjectId: unitId, nodeId: entry.id, state: 'queued' as const, visits: { [entry.id]: 1 }, data: { path: [], outputs: {} } as ItemData, plan: plan.get(unitId) ?? null }));
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

export const WHOLE_SCRIPT_BUSY = '대본 전체를 읽는 실행이 이미 진행 중입니다.';

/** A run still filling its lines counts as running. */
export const runActive = (run: { status: string; notice: string | null }) => run.status === 'running' || (run.status === 'paused' && run.notice === FILLING);

/**
 * One whole-script run at a time per project, whoever starts it (run dialog, chat). `exceptRunId`:
 * the run being continued or resumed, which may go on itself.
 */
export function refuseSecondWholeScript(db: Db, projectId: string, exceptRunId?: string) {
  const runs = db.select({ id: s.runs.id, status: s.runs.status, notice: s.runs.notice, definition: s.runs.definition }).from(s.runs).where(and(eq(s.runs.projectId, projectId), inArray(s.runs.status, ['running', 'paused']))).all();
  if (runs.some((run) => run.id !== exceptRunId && runActive(run) && isWholeScriptWorkflow(run.definition))) throw new Error(WHOLE_SCRIPT_BUSY);
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
  if (isWholeScriptWorkflow(input.workflow.definition)) refuseSecondWholeScript(db, input.projectId);
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
