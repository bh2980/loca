import { and, asc, count, desc, eq, gte, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { checkFormat, exclusionRulesSchema, lineExclusion, lineMarksOf, mentions, runNodeName, type BatchChange, type CheckKind, type LineFilter, type LineMark } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { attachUnitTags, scopeRefusal } from './tag-scope.ts';
import { saveLine } from './line-save.ts';
import { refusesListener, setHumanListener } from './listeners.ts';
import { hiddenMarkConditions, knownListenerSql, markConditions, translatableSql } from './line-marks.ts';
import { lineTextFilter } from './line-text.ts';
import { describeRule, knowledgeOf, knownListener, speechMismatch, speechRuleIndex } from './speech.ts';
import { precedingLines } from './context.ts';
import { viewUnitIds } from './view-flow.ts';

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
  /** The automatic marks the line carries (lineMarksOf); 같은 원문 다른 번역 only when the query was asked for it (`diverged`). */
  marks: LineMark[];
}

function lookups(db: Db, projectId: string) {
  const characters = db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all();
  const tags = db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all();
  /** Every spelling a character goes by: stored name, aliases, and the given text itself. */
  const namesOf = (name: string) => {
    const wanted = name.trim().toLowerCase();
    const spellings = (character: (typeof characters)[number]) => [character.name, ...character.aliases];
    let found = characters.filter((character) => spellings(character).some((alias) => alias.toLowerCase() === wanted));
    // "Alice" finds "Alice Grey" / CHAR_ALICE: a whole word of a name or alias, when nothing matches exactly.
    if (!found.length) {
      const word = new RegExp(`(^|[^\\p{L}\\p{N}])${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
      found = characters.filter((character) => spellings(character).some((alias) => word.test(alias.replace(/_/g, ' '))));
    }
    return [...new Set([name.trim(), ...found.flatMap(spellings)])];
  };
  const statusId = (value: string) => statuses.find((status) => status.id === value || status.name === value)?.id;
  const tagId = (value: string) => tags.find((tag) => tag.id === value || tag.name === value.replace(/^#/, ''))?.id;
  return { characters, statuses, tags, namesOf, statusId, tagId };
}

/** Lines matching a filter, in script order. `total` counts every match, not just this page. */
/** With `all`, every matching line in one query (no count, no paging): see allLines. `seq` limits it to a stretch of the script. */
export function findLines(db: Db, projectId: string, filter: LineFilter, options: { all?: boolean; seq?: [number, number]; diverged?: boolean } = {}): { total: number; rows: LineRow[] } {
  const { namesOf, statusId, tagId, statuses, tags } = lookups(db, projectId);
  const where: SQL[] = [eq(s.units.projectId, projectId)];
  if (filter.q) where.push(lineTextFilter(filter.q));
  if (filter.speakers?.length) where.push(inList(s.units.speaker, filter.speakers.flatMap(namesOf)));
  if (filter.listeners?.length) {
    // The app's rules (services/line-marks.ts): '-' is the #청자 미상 mark (dialogue only), a name must be a known listener.
    const names = filter.listeners.filter((name) => name !== '-').flatMap(namesOf);
    where.push(or(...(names.length ? [and(inArray(s.units.listener, names), knownListenerSql)!] : []), ...(filter.listeners.includes('-') ? markConditions(projectId, ['unknownListener']) : []))!);
  }
  if (filter.groups?.length) where.push(or(inList(s.groups.key, filter.groups), inList(s.groups.id, filter.groups), inList(s.groups.title, filter.groups))!);
  if (filter.sections?.length) where.push(inList(s.groups.section, filter.sections));
  if (filter.groupKind) where.push(eq(s.groups.kind, filter.groupKind));
  if (filter.kind) where.push(eq(s.units.kind, filter.kind));
  if (filter.statuses?.length) where.push(inList(s.units.statusId, filter.statuses.map((value) => statusId(value) ?? value)));
  // Several tags: lines carrying every one of them, as in the app's list.
  for (const tag of filter.tags ?? []) where.push(sql`${s.units.id} in (select unit_id from ${s.unitTags} where tag_id = ${tagId(tag) ?? tag})`);
  where.push(...markConditions(projectId, filter.marks));
  // 숨기기: any one of these leaves a line out.
  if (filter.hideSpeakers?.length) where.push(sql`coalesce(${s.units.speaker}, '') not in (select value from json_each(${JSON.stringify(filter.hideSpeakers.flatMap(namesOf))}))`);
  if (filter.hideStatuses?.length) where.push(sql`${s.units.statusId} not in (select value from json_each(${JSON.stringify(filter.hideStatuses.map((value) => statusId(value) ?? value))}))`);
  for (const tag of filter.hideTags ?? []) where.push(sql`${s.units.id} not in (select unit_id from ${s.unitTags} where tag_id = ${tagId(tag) ?? tag})`);
  where.push(...hiddenMarkConditions(projectId, filter.hideMarks));
  // Asking for translated or untranslated lines (exports, checks) asks for lines to translate: 번역 제외 lines stay out.
  if (filter.translated !== undefined) where.push(filter.translated ? sql`${s.units.translation} is not null and ${s.units.translation} != ''` : sql`(${s.units.translation} is null or ${s.units.translation} = '')`, translatableSql(projectId));
  if (filter.keys?.length) where.push(inList(s.units.key, filter.keys));
  if (filter.view) where.push(inList(s.units.id, viewUnitIds(db, projectId, filter.view)));
  if (options.seq) where.push(sql`${s.units.seq} >= ${options.seq[0]} and ${s.units.seq} < ${options.seq[1]}`);

  // Mentions need whole-word matching (and {ALIAS} placeholders), so they are checked in code
  // over a LIKE pre-filter; everything else pages in SQL.
  const mentionNames = filter.mentions?.flatMap(namesOf) ?? [];
  if (mentionNames.length) where.push(or(...mentionNames.map((name) => like(s.units.source, `%${name}%`)))!);
  const base = db
    .select({ unit: s.units, group: { key: s.groups.key, title: s.groups.title, kind: s.groups.kind, section: s.groups.section } })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .where(and(...where))
    .orderBy(asc(s.units.seq));
  let total: number;
  let page: { unit: Unit; group: LineRow['group'] }[];
  if (mentionNames.length) {
    const all = base.all().filter(({ unit }) => mentionNames.some((name) => mentions(unit.source, name) || unit.source.includes(`{${name}}`)));
    total = all.length;
    page = options.all ? all : all.slice(filter.offset, filter.offset + filter.limit);
  } else if (options.all) {
    page = base.all();
    total = page.length;
  } else {
    // Groups are joined only when a group filter needs them.
    const counted = db.select({ count: count() }).from(s.units);
    const usesGroups = Boolean(filter.groups?.length || filter.sections?.length || filter.groupKind);
    total = (usesGroups ? counted.innerJoin(s.groups, eq(s.groups.id, s.units.groupId)) : counted).where(and(...where)).get()!.count;
    page = base.limit(filter.limit).offset(filter.offset).all();
  }
  const ids = page.map(({ unit }) => unit.id);
  const tagRows = inChunks(ids, (slice) => db.select().from(s.unitTags).where(inArray(s.unitTags.unitId, slice)).all());
  const tagName = new Map(tags.map((tag) => [tag.id, tag.name]));
  // Grouped once: filtering every tag row per line was quadratic on a whole game.
  const tagsByUnit = new Map<string, string[]>();
  for (const row of tagRows) tagsByUnit.set(row.unitId, [...(tagsByUnit.get(row.unitId) ?? []), tagName.get(row.tagId) ?? row.tagId]);
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));
  const finalStatus = new Set(statuses.filter((status) => status.kind === 'final').map((status) => status.id));
  const project = db.select({ rules: s.projects.formatRules, exclusion: s.projects.exclusionRules, language: s.projects.sourceLanguage }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  const rules = project?.rules;
  const exclusion = exclusionRulesSchema.parse(project?.exclusion ?? {});
  // Same source, different translation compares across the project: one extra query, only when asked.
  const diverged = options.diverged && page.length ? new Set(db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), ...markConditions(projectId, ['diverged']))).all().map((row) => row.id)) : null;
  return {
    total,
    rows: page.map(({ unit, group }) => ({
      id: unit.id,
      key: unit.key,
      rev: unit.updatedAt.getTime(),
      group,
      kind: unit.kind,
      speaker: unit.speaker,
      listener: knownListener(unit),
      source: unit.source,
      translation: unit.translation,
      status: statusName.get(unit.statusId) ?? unit.statusId,
      tags: tagsByUnit.get(unit.id) ?? [],
      marks: [...lineMarksOf(unit, finalStatus.has(unit.statusId), rules, lineExclusion(unit, rules, exclusion, project?.language) !== null), ...(diverged?.has(unit.id) ? (['diverged'] as const) : [])],
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
  const range = db.select({ low: sql<number | null>`min(${s.units.seq})`, high: sql<number | null>`max(${s.units.seq})` }).from(s.units).where(eq(s.units.projectId, projectId)).get();
  if (range?.low === null || range?.low === undefined || range.high === null) return;
  for (let low = range.low; low <= range.high; low += STEP_LINES) {
    const rows = findLines(db, projectId, filter, { all: true, seq: [low, low + STEP_LINES] }).rows;
    if (rows.length) yield rows;
    await yieldNow();
  }
}

/** Groups where every one of these speakers has at least one line (e.g. "Alice and Bob talking"). */
export function scenesWith(db: Db, projectId: string, speakers: string[]) {
  const { namesOf } = lookups(db, projectId);
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
export function lineContext(db: Db, projectId: string, key: string, around: number) {
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
  const index = kind === 'speech' ? speechRuleIndex(db, projectId) : null;
  const ratio = options.ratio ?? 1.5;
  for await (const lines of lineSteps(db, projectId, translated)) {
    if (matcher)
      for (const line of lines)
        for (const term of matcher.find(line.source))
          if (!line.translation!.toLowerCase().includes(term.target.toLowerCase())) found.push({ key: line.key, group: line.group.title, source: line.source, translation: line.translation, term: term.source, expected: term.target });
    if (kind === 'format')
      for (const line of lines) {
        const issues = checkFormat(line.source, line.translation!, { placeholders: true, tags: true, newlines: true, emptyText: true }, rules);
        if (issues.length) found.push({ key: line.key, group: line.group.title, source: line.source, translation: line.translation, issues: issues.map((issue) => issue.message) });
      }
    if (index) {
      const resolved = index.resolve(lines.map((line) => ({ key: line.key, speaker: line.speaker, listener: line.listener, listenerOrigin: 'human' as const, listenerConfidence: null })));
      for (const line of lines) {
        const rule = resolved.get(line.key);
        const issue = rule ? speechMismatch(rule.rule, line.translation) : null;
        if (issue) found.push({ key: line.key, group: line.group.title, speaker: line.speaker, listener: rule!.listener, rule: describeRule(rule!.rule), source: line.source, translation: line.translation, issue });
      }
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
    const used = (terms?.matcher.find(line.source) ?? []).map((term) => ({ source: term.source, target: term.target, note: term.note }));
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
    if (options.fillRev && next.rev === undefined) next.rev = unit.updatedAt.getTime();
    if (next.translation !== undefined && next.translation === (unit.translation ?? '')) delete next.translation;
    if (next.status && statusId(next.status) === unit.statusId) delete next.status;
    if (next.listener !== undefined && next.listener === unit.listener) delete next.listener;
    if (next.translate !== undefined && next.translate === unit.translate) delete next.translate;
    if (next.translation === undefined && next.listener === undefined && next.translate === undefined && !next.status && !next.addTags.length && !next.removeTags.length) {
      unchanged.push(change.key);
      return [];
    }
    return [next];
  });
  return { batch: { ...batch, changes }, unchanged };
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

/** Validate a batch without writing: unknown keys, stale revs, unknown statuses/tags, and format/glossary problems in new translations. */
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
    if (!unit) report.errors.push({ key: change.key, reason: '없는 대사 키입니다.' });
    else if (refusesListener(unit, change.listener)) report.errors.push({ key: change.key, reason: '나레이션에는 청자가 없습니다.' });
    else if (seen.has(change.key)) report.errors.push({ key: change.key, reason: '같은 키가 두 번 나옵니다.' });
    else if (change.rev !== undefined && change.rev !== unit.updatedAt.getTime()) report.conflicts.push({ key: change.key, reason: '읽은 뒤에 다른 곳에서 바뀌었습니다.' });
    else if (change.status && !statusId(change.status)) report.errors.push({ key: change.key, reason: `없는 상태입니다: ${change.status}` });
    else if ([...change.addTags, ...change.removeTags].some((tag) => !tagId(tag))) report.errors.push({ key: change.key, reason: `이 프로젝트에 없는 태그입니다: ${[...change.addTags, ...change.removeTags].filter((tag) => !tagId(tag)).join(', ')}` });
    else if ((tagRefusal = scopeRefusal(db, projectId, change.addTags.map((tag) => tagId(tag)!), 'lines'))) report.errors.push({ key: change.key, reason: tagRefusal });
    else if (change.translation === undefined && change.listener === undefined && change.translate === undefined && !change.status && !change.addTags.length && !change.removeTags.length) report.errors.push({ key: change.key, reason: '바꿀 내용이 없습니다.' });
    else {
      report.changes++;
      if (change.translation !== undefined) {
        const issues = [
          ...checkFormat(unit.source, change.translation, { placeholders: true, tags: true, newlines: true, emptyText: true }, rules).map((issue) => issue.message),
          ...matcher.find(unit.source).filter((term) => !change.translation!.toLowerCase().includes(term.target.toLowerCase())).map((term) => `용어 "${term.source}" → "${term.target}"가 번역에 없습니다.`),
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
export function applyBatch(db: Db, projectId: string, batch: BatchChange) {
  const { statusId, tagId } = lookups(db, projectId);
  const applied: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  db.transaction((tx) => {
    const units = unitsByKey(tx, projectId, batch.changes.map((change) => change.key));
    for (const change of batch.changes) {
      const unit = units.get(change.key);
      if (!unit) {
        skipped.push({ key: change.key, reason: '없는 대사 키' });
        continue;
      }
      if (change.rev !== undefined && change.rev !== unit.updatedAt.getTime()) {
        skipped.push({ key: change.key, reason: '그사이 바뀜' });
        continue;
      }
      // Only dialogue has a listener (validateBatch reports the same).
      if (refusesListener(unit, change.listener)) {
        skipped.push({ key: change.key, reason: '나레이션에는 청자가 없음' });
        continue;
      }
      // Applied from the CLI or an accepted proposal: a person decided this translation or status (and the listener).
      saveLine(tx, unit, { text: change.translation, statusId: change.status ? statusId(change.status)! : undefined, origin: batch.origin, model: batch.model ?? null, note: change.note });
      if (change.listener !== undefined) setHumanListener(tx, [unit.id], change.listener);
      if (change.translate !== undefined) tx.update(s.units).set({ translate: change.translate }).where(eq(s.units.id, unit.id)).run();
      // Checked in validateBatch; a tag whose place changed since is skipped here, never put where it doesn't belong.
      attachUnitTags(tx, projectId, [unit.id], { add: change.addTags.map((tag) => tagId(tag)).filter((id): id is string => !!id), remove: change.removeTags.map((tag) => tagId(tag)).filter((id): id is string => !!id) }, { onMisplaced: 'skip' });
      applied.push(change.key);
    }
  });
  events.changed(projectId, 'units', 'statuses');
  return { ok: true, applied: applied.length, skipped };
}
