import { and, asc, count, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { checkFormat, exclusionRulesSchema, lineChangeEmpty, lineExclusion, lineMarksOf, runNodeName, type BatchChange, type CheckKind, type LineChange, type LineFilter, type LineMark, type ResolvedLineFilter, withSourceWhitespace } from '@loca/shared';
import type { Db } from '../db/index.ts';
import { inChunks, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { attachUnitTags, scopeRefusal } from '../domain/tag-scope.ts';
import { isStale, LINE_CHANGED, revOf, saveLine, setLineMemo, setLineTranslate, statusRefusal } from '../domain/line-save.ts';
import { PERSON, type Saver } from '../domain/saver.ts';
import { refusesListener, setAiListener, setHumanListener } from '../domain/line-listener.ts';
import { markConditions, translatableSql } from '../domain/line-marks.ts';
import { lineConditions, personNames, requireLineFilter } from '../domain/line-filter.ts';
import { describeRule, knownListener, speechRuleIndex } from '../domain/speech.ts';
import { knowledgeOf } from '../domain/knowledge-cache.ts';
import { precedingLines } from '../engine/ai-context.ts';
import { viewUnitIds } from '../domain/view-flow.ts';

/**
 * Reading and batch-changing the script, shared by the CLI routes and the chat's tools so both
 * see the same lines, the same checks and the same conflict rules. A line's `rev` is its
 * updatedAt in ms, monotonically increased for every write through drizzle.
 */

type Unit = typeof s.units.$inferSelect;

export interface LineRow {
  id: string;
  key: string;
  rev: number;
  group: { key: string; title: string; kind: string; section: string | null };
  kind: string;
  speaker: string | null;
  /** Known listener (an unsure AI guess counts as unknown). */
  listener: string | null;
  source: string;
  translation: string | null;
  status: string;
  tags: string[];
  /** Who set the status: 'ai' (✦, no person has checked it) or 'human'. */
  statusBy: string;
  /** The line's memo ('' when none). */
  note: string;
  /** 번역 제외: not for translation (no text, a rule, or a person's call). */
  excluded: boolean;
  /** The automatic marks the line carries (lineMarksOf); 같은 원문 다른 번역 only when the query was asked for it (`diverged`). */
  marks: LineMark[];
}

export function lookups(db: Db, projectId: string) {
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all();
  const tags = db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all();
  const statusId = (value: string) => statuses.find((status) => status.id === value || status.name === value)?.id;
  const tagId = (value: string) => tags.find((tag) => tag.id === value || tag.name === value.replace(/^#/, ''))?.id;
  return { statuses, tags, statusId, tagId };
}

/**
 * Lines matching a filter, in script order. `total` counts every match, not just this page; with `all`, every matching
 * line in one query (no count, no paging: see allLines). A name the project does not have is refused (400, requireLineFilter).
 */
export function findLines(db: Db, projectId: string, filter: LineFilter, options: { all?: boolean; diverged?: boolean } = {}): { total: number; rows: LineRow[] } {
  return findResolved(db, projectId, requireLineFilter(db, projectId, filter), { ...options, page: filter });
}

/** findLines for a filter already resolved (lineSteps asks many times for one filter). `seq` limits it to a stretch of the script. */
function findResolved(db: Db, projectId: string, filter: ResolvedLineFilter, options: { all?: boolean; seq?: [number, number]; diverged?: boolean; page?: { offset: number; limit: number } }): { total: number; rows: LineRow[] } {
  const { statuses, tags } = lookups(db, projectId);
  const where = lineConditions(projectId, filter);
  if (options.seq) where.push(sql`${s.units.seq} >= ${options.seq[0]} and ${s.units.seq} < ${options.seq[1]}`);
  const base = db
    .select({ unit: s.units, group: { key: s.groups.key, title: s.groups.title, kind: s.groups.kind, section: s.groups.section } })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .where(and(...where))
    .orderBy(asc(s.units.seq));
  let total: number;
  let page: { unit: Unit; group: LineRow['group'] }[];
  if (options.all || !options.page) {
    page = base.all();
    total = page.length;
  } else {
    total = db.select({ count: count() }).from(s.units).where(and(...where)).get()!.count;
    page = base.limit(options.page.limit).offset(options.page.offset).all();
  }
  const ids = page.map(({ unit }) => unit.id);
  const tagRows = inChunks(ids, (slice) => db.select().from(s.unitTags).where(inArray(s.unitTags.unitId, slice)).all());
  const tagName = new Map(tags.map((tag) => [tag.id, tag.name]));
  // Grouped once: filtering every tag row per line was quadratic on a whole game.
  const tagsByUnit = new Map<string, string[]>();
  for (const row of tagRows) tagsByUnit.set(row.unitId, [...(tagsByUnit.get(row.unitId) ?? []), tagName.get(row.tagId) ?? row.tagId]);
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));
  const project = db.select({ rules: s.projects.formatRules, exclusion: s.projects.exclusionRules, language: s.projects.sourceLanguage }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  const rules = project?.rules;
  const exclusion = exclusionRulesSchema.parse(project?.exclusion ?? {});
  // Lines with an AI 제안 waiting (one query for the page).
  const suggested = new Set(inChunks(ids, (slice) => db.select({ unitId: s.candidates.unitId }).from(s.candidates).where(and(inArray(s.candidates.unitId, slice), eq(s.candidates.state, 'pending'))).all()).map((row) => row.unitId));
  // Same source, different translation compares across the project: one extra query, only when asked.
  const diverged = options.diverged && page.length ? new Set(db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), ...markConditions(projectId, ['diverged']))).all().map((row) => row.id)) : null;
  return {
    total,
    rows: page.map(({ unit, group }) => ({
      id: unit.id,
      key: unit.key,
      rev: revOf(unit),
      group,
      kind: unit.kind,
      speaker: unit.speaker,
      listener: knownListener(unit),
      source: unit.source,
      translation: unit.translation,
      status: statusName.get(unit.statusId) ?? unit.statusId,
      tags: tagsByUnit.get(unit.id) ?? [],
      statusBy: unit.statusBy,
      note: unit.note,
      excluded: lineExclusion(unit, rules, exclusion, project?.language) !== null,
      marks: [...lineMarksOf({ suggested: suggested.has(unit.id) }), ...(diverged?.has(unit.id) ? (['diverged'] as const) : [])],
    })),
  };
}

/** Every match, page by page (for checks and export). */
/** Every line matching the filter, in script order: one query (paging 1,000 at a time with OFFSET and a count each took a second for 50k lines). */
export function allLines(db: Db, projectId: string, filter: LineFilter): LineRow[] {
  return findLines(db, projectId, filter, { all: true }).rows;
}

/** Lines read and handled per step by the checks; the event loop is handed back in between. */
const STEP_LINES = 2_000;
const yieldNow = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The matching lines in script order, STEP_LINES positions of the script at a time, handing the
 * event loop back between steps: a check over a whole 50k-line game then never holds up other
 * requests for more than a few tens of milliseconds.
 */
export async function* lineSteps(db: Db, projectId: string, filter: LineFilter): AsyncGenerator<LineRow[]> {
  const resolved = requireLineFilter(db, projectId, filter);
  const range = db.select({ low: sql<number | null>`min(${s.units.seq})`, high: sql<number | null>`max(${s.units.seq})` }).from(s.units).where(eq(s.units.projectId, projectId)).get();
  if (range?.low === null || range?.low === undefined || range.high === null) return;
  for (let low = range.low; low <= range.high; low += STEP_LINES) {
    const rows = findResolved(db, projectId, resolved, { all: true, seq: [low, low + STEP_LINES] }).rows;
    if (rows.length) yield rows;
    await yieldNow();
  }
}

/** Groups where every one of these speakers has at least one line (e.g. "Alice and Bob talking"). */
export function scenesWith(db: Db, projectId: string, speakers: string[]) {
  const namesOf = personNames(db, projectId);
  const sets = speakers.map((name) => new Set(namesOf(name)));
  const rows = db
    .select({ groupId: s.units.groupId, speaker: s.units.speaker, lines: count() })
    .from(s.units)
    .where(and(eq(s.units.projectId, projectId), inArray(s.units.speaker, sets.flatMap((set) => [...set]))))
    .groupBy(s.units.groupId, s.units.speaker)
    .all();
  const byGroup = Map.groupBy(rows, (row) => row.groupId);
  const matching = [...byGroup].filter(([, list]) => sets.every((set) => list.some((row) => row.speaker && set.has(row.speaker))));
  if (!matching.length) return [];
  const groups = inChunks(matching.map(([id]) => id), (slice) => db.select().from(s.groups).where(inArray(s.groups.id, slice)).all()).sort((a, b) => a.sort - b.sort);
  return groups.map((group) => ({
    key: group.key,
    title: group.title,
    section: group.section,
    lines: Object.fromEntries((byGroup.get(group.id) ?? []).map((row) => [row.speaker, row.lines])),
  }));
}

/** A line with the lines around it in its group, and its neighbours in the dialogue graph (choices, conditions). */
export function lineAround(db: Db, projectId: string, key: string, around: number) {
  const unit = db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get();
  if (!unit) return null;
  const siblings = db.select({ id: s.units.id, key: s.units.key, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation }).from(s.units).where(eq(s.units.groupId, unit.groupId)).orderBy(asc(s.units.seq)).all();
  const index = siblings.findIndex((row) => row.id === unit.id);
  const node = db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), sql`exists (select 1 from json_each(${s.graphNodes.unitIds}) where value = ${unit.id})`)).get();
  let graph = null;
  if (node) {
    const edges = db.select().from(s.graphEdges).where(or(eq(s.graphEdges.fromId, node.id), eq(s.graphEdges.toId, node.id))).all();
    const others = db.select().from(s.graphNodes).where(inArray(s.graphNodes.id, [...new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]))].filter((id) => id !== node.id))).all();
    const firstLine = new Map(
      db.select({ id: s.units.id, key: s.units.key, source: s.units.source }).from(s.units).where(inArray(s.units.id, others.flatMap((other) => other.unitIds.slice(0, 1)))).all().map((row) => [row.id, row]),
    );
    const describe = (id: string, label: string | null) => {
      const other = others.find((candidate) => candidate.id === id)!;
      return { kind: other.kind, type: other.type, label: other.label, edge: label, firstLine: other.unitIds[0] ? firstLine.get(other.unitIds[0]) ?? null : null };
    };
    graph = {
      node: { kind: node.kind, type: node.type, label: node.label },
      incoming: edges.filter((edge) => edge.toId === node.id && edge.fromId !== node.id).map((edge) => describe(edge.fromId, edge.label)),
      outgoing: edges.filter((edge) => edge.fromId === node.id && edge.toId !== node.id).map((edge) => describe(edge.toId, edge.label)),
    };
  }
  return {
    line: findLines(db, projectId, { keys: [key], offset: 0, limit: 1 }, { diverged: true }).rows[0],
    before: siblings.slice(Math.max(0, index - around), index),
    after: siblings.slice(index + 1, index + 1 + around),
    graph,
  };
}

/** First line a speaker has, in script order. */
export function firstAppearance(db: Db, projectId: string, speaker: string) {
  const { rows } = findLines(db, projectId, { speakers: [speaker], offset: 0, limit: 1 });
  return rows[0] ?? null;
}

// ── checks ───────────────────────────────────────────────────────────

export async function checkScript(db: Db, projectId: string, kind: CheckKind, filter: LineFilter, options: { ratio?: number } = {}) {
  const translated = { ...filter, translated: true };
  if (kind === 'consistency') {
    // Needs every line before it can compare; reading still goes step by step.
    const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
    const lines: LineRow[] = [];
    for await (const step of lineSteps(db, projectId, translated)) lines.push(...step);
    const bySource = Map.groupBy(lines, (line) => normalize(line.source));
    return [...bySource]
      .map(([source, group]) => ({ source, variants: [...Map.groupBy(group, (line) => normalize(line.translation!))].map(([translation, same]) => ({ translation, keys: same.map((line) => line.key) })) }))
      .filter((entry) => entry.variants.length > 1);
  }
  const found: unknown[] = [];
  const matcher = kind === 'terms' ? knowledgeOf(db, projectId).glossary().matcher : null;
  const rules = kind === 'format' ? db.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.rules : undefined;
  const ratio = options.ratio ?? 1.5;
  for await (const lines of lineSteps(db, projectId, translated)) {
    if (matcher)
      for (const line of lines)
        for (const term of matcher.find(line.source, line.kind))
          if (!line.translation!.toLowerCase().includes(term.target.toLowerCase())) found.push({ key: line.key, group: line.group.title, source: line.source, translation: line.translation, term: term.source, expected: term.target });
    if (kind === 'format')
      for (const line of lines) {
        const issues = checkFormat(line.source, line.translation!, { placeholders: true, tags: true, newlines: true, emptyText: true }, rules);
        if (issues.length) found.push({ key: line.key, group: line.group.title, source: line.source, translation: line.translation, issues: issues.map((issue) => issue.message) });
      }
    if (kind === 'length')
      for (const line of lines)
        if (line.translation!.length > line.source.length * ratio)
          found.push({ key: line.key, group: line.group.title, kind: line.kind, source: line.source, translation: line.translation, ratio: Math.round((line.translation!.length / Math.max(1, line.source.length)) * 100) / 100 });
  }
  return found;
}

// ── stats ────────────────────────────────────────────────────────────

/** Progress per group or per section: line counts by status, most untranslated first. */
export function sceneStats(db: Db, projectId: string, by: 'group' | 'section') {
  const { statuses } = lookups(db, projectId);
  const rows = db
    .select({ group: s.groups.title, section: s.groups.section, kind: s.groups.kind, statusId: s.units.statusId, translated: sql<number>`sum(case when ${s.units.translation} is not null and ${s.units.translation} != '' then 1 else 0 end)`, lines: count() })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .where(and(eq(s.units.projectId, projectId), translatableSql(projectId)))
    .groupBy(s.groups.id, s.units.statusId)
    .all();
  const name = new Map(statuses.map((status) => [status.id, status.name]));
  const keyOf = (row: (typeof rows)[number]) => (by === 'section' ? (row.section ?? '(구역 없음)') : row.group);
  return [...Map.groupBy(rows, keyOf)]
    .map(([label, list]) => {
      const total = list.reduce((sum, row) => sum + row.lines, 0);
      const translated = list.reduce((sum, row) => sum + Number(row.translated), 0);
      return { [by]: label, lines: total, translated, untranslated: total - translated, statuses: Object.fromEntries(list.map((row) => [name.get(row.statusId) ?? row.statusId, row.lines])) };
    })
    .sort((a, b) => b.untranslated - a.untranslated);
}

/** Runs since a time: tokens, failed calls, and which nodes fail most. */
export function runStats(db: Db, projectId: string, since: Date) {
  const runs = db.select().from(s.runs).where(and(eq(s.runs.projectId, projectId), gte(s.runs.createdAt, since))).orderBy(desc(s.runs.createdAt)).all();
  if (!runs.length) return { runs: [], failingNodes: [] };
  const ids = runs.map((run) => run.id);
  const steps = db
    .select({ runId: s.runSteps.runId, calls: count(), failed: sql<number>`sum(case when ${s.runSteps.ok} then 0 else 1 end)`, input: sql<number>`sum(coalesce(${s.runSteps.inputTokens}, 0))`, output: sql<number>`sum(coalesce(${s.runSteps.outputTokens}, 0))` })
    .from(s.runSteps)
    .where(inList(s.runSteps.runId, ids))
    .groupBy(s.runSteps.runId)
    .all();
  const failing = db
    .select({ runId: s.runItems.runId, nodeId: s.runItems.nodeId, failed: count() })
    .from(s.runItems)
    .where(and(inList(s.runItems.runId, ids), eq(s.runItems.state, 'failed')))
    .groupBy(s.runItems.runId, s.runItems.nodeId)
    .all();
  const nodeName = (runId: string, nodeId: string) => {
    const definition = runs.find((run) => run.id === runId)?.definition;
    const node = definition?.nodes.find((candidate) => candidate.id === nodeId);
    return node ? runNodeName(definition!, node) : nodeId;
  };
  return {
    runs: runs.map((run) => {
      const usage = steps.find((step) => step.runId === run.id);
      return { id: run.id, workflow: run.workflowName, status: run.status, subject: run.subject, lines: run.total, createdAt: run.createdAt, calls: usage?.calls ?? 0, failedCalls: Number(usage?.failed ?? 0), inputTokens: Number(usage?.input ?? 0), outputTokens: Number(usage?.output ?? 0) };
    }),
    failingNodes: [...Map.groupBy(failing, (row) => `${row.runId}\u0000${row.nodeId}`)]
      .map(([, list]) => ({ workflow: runs.find((run) => run.id === list[0].runId)!.workflowName, node: nodeName(list[0].runId, list[0].nodeId), failedLines: list.reduce((sum, row) => sum + row.failed, 0) }))
      .sort((a, b) => b.failedLines - a.failedLines),
  };
}

// ── export / batch change ───────────────────────────────────────────

/** Units of a project by key, for batch changes of any size. */
function unitsByKey(db: Pick<Db, 'select'>, projectId: string, keys: string[]) {
  return new Map(inChunks(keys, (slice) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, slice))).all()).map((unit) => [unit.key, unit]));
}

/** Lines plus what a translator needs, one object per line (written as JSONL by the CLI). */
export function exportLines(db: Db, projectId: string, filter: LineFilter, options: { before: number; terms: boolean; all: boolean }) {
  let lines: LineRow[];
  if (filter.view) {
    // A view is read along its flow (see viewFlow), not in script order, and paged in that order.
    const order = new Map(viewUnitIds(db, projectId, filter.view).map((id, at) => [id, at]));
    const all = findLines(db, projectId, filter, { all: true, diverged: true }).rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    lines = options.all ? all : all.slice(filter.offset, filter.offset + filter.limit);
  } else lines = findLines(db, projectId, filter, { all: options.all, diverged: true }).rows;
  const terms = options.terms ? knowledgeOf(db, projectId).terms() : null;
  // The confirmed speech rule of each line's speaker → listener pair, as the translator must follow it.
  const rules = speechRuleIndex(db, projectId).resolve(lines.map((line) => ({ key: line.key, speaker: line.speaker, listener: line.listener, listenerOrigin: 'human' as const, listenerConfidence: null })));
  // The lines before each one along the dialogue graph, by branch where ways join: what an AI node is given.
  const preceding = options.before > 0 ? precedingLines(db, projectId, lines.map((line) => line.id), options.before) : null;
  return lines.map((line) => {
    const before = preceding?.get(line.id);
    const used = (terms?.matcher.find(line.source, line.kind) ?? []).map((term) => ({ source: term.source, target: term.target, note: term.note }));
    const rule = rules.get(line.key);
    return {
      key: line.key,
      rev: line.rev,
      group: line.group.title,
      section: line.group.section,
      speaker: line.speaker,
      ...(line.listener ? { listener: line.listener } : {}),
      ...(rule ? { speechRule: describeRule(rule.rule) } : {}),
      source: line.source,
      translation: line.translation,
      status: line.status,
      tags: line.tags,
      marks: line.marks,
      ...(before ? { before: before.lines, ...(before.branches.length ? { beforeBranches: before.branches, ...(before.moreBranches ? { moreBranches: before.moreBranches } : {}) } : {}) } : {}),
      ...(options.terms ? { terms: used } : {}),
    };
  });
}

/**
 * Drop parts of a change that would not change anything (same translation, same status), so a
 * file edited from an export only proposes what was actually edited. Lines left empty are reported.
 */
/**
 * Drops what would not change a line. With `fillRev`, a change without a rev gets the line's
 * current one, so a line edited before the proposal is accepted counts as a conflict.
 */
export function normalizeBatch(db: Db, projectId: string, batch: BatchChange, options: { fillRev?: boolean } = {}): { batch: BatchChange; unchanged: string[] } {
  const { statusId } = lookups(db, projectId);
  const units = unitsByKey(db, projectId, batch.changes.map((change) => change.key));
  const unchanged: string[] = [];
  const changes = batch.changes.flatMap((change) => {
    const unit = units.get(change.key);
    if (!unit) return [change];
    const next = { ...change };
    if (options.fillRev && next.rev === undefined) next.rev = revOf(unit);
    // Compared as saveLine will store it: the source's leading and trailing whitespace.
    if (next.translation !== undefined) next.translation = withSourceWhitespace(unit.source, next.translation);
    if (next.translation !== undefined && next.translation === (unit.translation ?? '')) delete next.translation;
    if (next.status && statusId(next.status) === unit.statusId) delete next.status;
    if (next.listener !== undefined && next.listener === unit.listener) delete next.listener;
    if (next.translate !== undefined && next.translate === unit.translate) delete next.translate;
    if (next.memo !== undefined && next.memo.trim() === unit.note) delete next.memo;
    if (lineChangeEmpty(next)) {
      unchanged.push(change.key);
      return [];
    }
    return [next];
  });
  return { batch: { ...batch, changes }, unchanged };
}

/**
 * Why the line may not be in the status the change gives it (or, when the change only empties its text, in the status
 * it keeps), by the rule of statuses (statusRefusal) against the text the change leaves it with. Null when it holds.
 */
function statusProblem(db: Pick<Db, 'select'>, projectId: string, unit: Unit, change: LineChange, statusId: (name: string) => string | undefined) {
  const status = change.status ? statusId(change.status) : change.translation !== undefined && !change.translation.trim() ? unit.statusId : undefined;
  return status ? statusRefusal(db, projectId, status, change.translation ?? unit.translation) : null;
}

export interface BatchReport {
  total: number;
  /** Lines in the file whose content equals what is there now. */
  unchanged?: number;
  /** Lines that would change. */
  changes: number;
  conflicts: { key: string; reason: string }[];
  errors: { key: string; reason: string }[];
  warnings: { key: string; issues: string[] }[];
}

/** Validate a batch without writing: unknown keys, stale revs, unknown statuses/tags, a status its line may not be in, and format/glossary problems in new translations. */
export function validateBatch(db: Db, projectId: string, batch: BatchChange): BatchReport {
  const { statusId, tagId } = lookups(db, projectId);
  const units = unitsByKey(db, projectId, batch.changes.map((change) => change.key));
  const rules = db.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.rules;
  const { matcher } = knowledgeOf(db, projectId).glossary();
  const report: BatchReport = { total: batch.changes.length, changes: 0, conflicts: [], errors: [], warnings: [] };
  const seen = new Set<string>();
  for (const change of batch.changes) {
    const unit = units.get(change.key);
    let tagRefusal: string | null = null;
    let statusRefused: string | null = null;
    if (!unit) report.errors.push({ key: change.key, reason: '없는 대사 키입니다.' });
    else if (refusesListener(unit, change.listener)) report.errors.push({ key: change.key, reason: '나레이션에는 청자가 없습니다.' });
    else if (seen.has(change.key)) report.errors.push({ key: change.key, reason: '같은 키가 두 번 나옵니다.' });
    else if (isStale(unit, change.rev)) report.conflicts.push({ key: change.key, reason: LINE_CHANGED });
    else if (change.status && !statusId(change.status)) report.errors.push({ key: change.key, reason: `없는 상태입니다: ${change.status}` });
    else if ([...change.addTags, ...change.removeTags].some((tag) => !tagId(tag))) report.errors.push({ key: change.key, reason: `이 프로젝트에 없는 태그입니다: ${[...change.addTags, ...change.removeTags].filter((tag) => !tagId(tag)).join(', ')}` });
    else if ((tagRefusal = scopeRefusal(db, projectId, change.addTags.map((tag) => tagId(tag)!), 'lines'))) report.errors.push({ key: change.key, reason: tagRefusal });
    else if (lineChangeEmpty(change)) report.errors.push({ key: change.key, reason: '바꿀 내용이 없습니다.' });
    else if ((statusRefused = statusProblem(db, projectId, unit, change, statusId))) report.errors.push({ key: change.key, reason: statusRefused });
    else {
      report.changes++;
      if (change.translation !== undefined) {
        const issues = [
          ...checkFormat(unit.source, withSourceWhitespace(unit.source, change.translation), { placeholders: true, tags: true, newlines: true, emptyText: true }, rules).map((issue) => issue.message),
          ...matcher.find(unit.source, unit.kind).filter((term) => !change.translation!.toLowerCase().includes(term.target.toLowerCase())).map((term) => `용어 "${term.source}" → "${term.target}"가 번역에 없습니다.`),
        ];
        if (issues.length) report.warnings.push({ key: change.key, issues });
      }
    }
    seen.add(change.key);
  }
  return report;
}

/**
 * Apply an accepted batch in one transaction. Revs are checked again here: a line changed between
 * proposing and accepting is skipped and reported, never overwritten.
 */
export function applyBatch(db: Db, projectId: string, batch: BatchChange, saver: Saver = PERSON) {
  const { statusId, tagId } = lookups(db, projectId);
  const applied: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  const listenerKept: string[] = [];
  const rules = db.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.rules;
  db.transaction((tx) => {
    const units = unitsByKey(tx, projectId, batch.changes.map((change) => change.key));
    for (const change of batch.changes) {
      const unit = units.get(change.key);
      if (!unit) {
        skipped.push({ key: change.key, reason: '없는 대사 키' });
        continue;
      }
      if (isStale(unit, change.rev)) {
        skipped.push({ key: change.key, reason: LINE_CHANGED });
        continue;
      }
      // Only dialogue has a listener (validateBatch reports the same).
      if (refusesListener(unit, change.listener)) {
        skipped.push({ key: change.key, reason: '나레이션에는 청자가 없습니다.' });
        continue;
      }
      // The status's rule, asked before anything of the line is written (validateBatch reports the same): the line is skipped, the rest go on.
      const status = change.status ? statusId(change.status)! : undefined;
      const refused = statusProblem(tx, projectId, unit, change, statusId);
      if (refused) {
        skipped.push({ key: change.key, reason: refused });
        continue;
      }
      // Who decided it: a person who accepted the proposal, or AI when the terminal's mode applied it. The rev was checked above
      // (the line's other fields below raise it again).
      saveLine(tx, unit, { text: change.translation, statusId: status, origin: batch.origin, model: batch.model ?? null, note: change.note, statusBy: saver.statusBy });
      // A listener is a person's only when a person decided this batch; otherwise it is the agent's guess, which never replaces a person's.
      if (change.listener !== undefined) {
        if (saver.statusBy === 'human') setHumanListener(tx, [unit.id], change.listener);
        else if (!setAiListener(tx, unit, change.listener, 1, rules)) listenerKept.push(change.key);
      }
      if (change.translate !== undefined) setLineTranslate(tx, projectId, [unit.id], change.translate);
      if (change.memo !== undefined) setLineMemo(tx, projectId, [unit.id], change.memo);
      // Checked in validateBatch; a tag whose place changed since is skipped here, never put where it doesn't belong.
      attachUnitTags(tx, projectId, [unit.id], { add: change.addTags.map((tag) => tagId(tag)).filter((id): id is string => !!id), remove: change.removeTags.map((tag) => tagId(tag)).filter((id): id is string => !!id) }, { onMisplaced: 'skip' });
      applied.push(change.key);
    }
  });
  return { ok: true, applied: applied.length, skipped, ...(listenerKept.length && { listenerKept: { keys: listenerKept, note: '이 줄들의 청자는 그대로 두었습니다(사람이 정했거나 가져온 청자가 있거나, 청자가 필요 없는 줄).' } }) };
}
