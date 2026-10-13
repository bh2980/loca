import { and, asc, count, desc, eq, gte, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { checkFormat, LISTENER_MIN_CONFIDENCE, mentions, type BatchChange, type CheckKind, type LineFilter } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { applyIssueTags } from './issue-tags.ts';
import { describeRule, knowledgeOf, knownListener, speechMismatch, speechRuleIndex } from './speech.ts';

/**
 * Reading and batch-changing the script, shared by the CLI routes and the chat's tools so both
 * see the same lines, the same checks and the same conflict rules. A line's `rev` is its
 * updatedAt in ms: every write through drizzle bumps it.
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
export function findLines(db: Db, projectId: string, filter: LineFilter, options: { all?: boolean; seq?: [number, number] } = {}): { total: number; rows: LineRow[] } {
  const { namesOf, statusId, tagId, statuses, tags } = lookups(db, projectId);
  const where: SQL[] = [eq(s.units.projectId, projectId)];
  if (filter.q) where.push(or(like(s.units.source, `%${filter.q}%`), like(s.units.translation, `%${filter.q}%`), like(s.units.speaker, `%${filter.q}%`), like(s.units.key, `%${filter.q}%`))!);
  if (filter.speakers?.length) where.push(inList(s.units.speaker, filter.speakers.flatMap(namesOf)));
  if (filter.listeners?.length) {
    const sure = sql`(${s.units.listener} is not null and (${s.units.listenerOrigin} is not 'ai' or ${s.units.listenerConfidence} >= ${LISTENER_MIN_CONFIDENCE}))`;
    const names = filter.listeners.filter((name) => name !== '-').flatMap(namesOf);
    where.push(or(...(names.length ? [and(inArray(s.units.listener, names), sure)!] : []), ...(filter.listeners.includes('-') ? [sql`not ${sure}`] : []))!);
  }
  if (filter.groups?.length) where.push(or(inList(s.groups.key, filter.groups), inList(s.groups.id, filter.groups), inList(s.groups.title, filter.groups))!);
  if (filter.sections?.length) where.push(inList(s.groups.section, filter.sections));
  if (filter.groupKind) where.push(eq(s.groups.kind, filter.groupKind));
  if (filter.kind) where.push(eq(s.units.kind, filter.kind));
  if (filter.statuses?.length) where.push(inList(s.units.statusId, filter.statuses.map((value) => statusId(value) ?? value)));
  if (filter.tags?.length)
    where.push(inArray(s.units.id, db.select({ id: s.unitTags.unitId }).from(s.unitTags).where(inList(s.unitTags.tagId, filter.tags.map((value) => tagId(value) ?? value)))));
  if (filter.translated !== undefined) where.push(filter.translated ? sql`${s.units.translation} is not null and ${s.units.translation} != ''` : sql`(${s.units.translation} is null or ${s.units.translation} = '')`);
  if (filter.keys?.length) where.push(inList(s.units.key, filter.keys));
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
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));
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
      tags: tagRows.filter((row) => row.unitId === unit.id).map((row) => tagName.get(row.tagId) ?? row.tagId),
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
    line: findLines(db, projectId, { keys: [key], offset: 0, limit: 1 }).rows[0],
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
    .where(eq(s.units.projectId, projectId))
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
    const node = runs.find((run) => run.id === runId)?.definition.nodes.find((candidate) => candidate.id === nodeId);
    return node?.label ?? nodeId;
  };
  return {
    runs: runs.map((run) => {
      const usage = steps.find((step) => step.runId === run.id);
      return { id: run.id, workflow: run.workflowName, status: run.status, lines: run.total, createdAt: run.createdAt, calls: usage?.calls ?? 0, failedCalls: Number(usage?.failed ?? 0), inputTokens: Number(usage?.input ?? 0), outputTokens: Number(usage?.output ?? 0) };
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
  const lines = options.all ? allLines(db, projectId, filter) : findLines(db, projectId, filter).rows;
  const terms = options.terms ? knowledgeOf(db, projectId).terms() : null;
  const groupLines = new Map<string, { id: string; speaker: string | null; source: string; translation: string | null }[]>();
  const units = new Map(inChunks(lines.map((line) => line.id), (slice) => db.select({ id: s.units.id, groupId: s.units.groupId }).from(s.units).where(inArray(s.units.id, slice)).all()).map((row) => [row.id, row.groupId]));
  // The confirmed speech rule of each line's speaker → listener pair, as the translator must follow it.
  const rules = speechRuleIndex(db, projectId).resolve(lines.map((line) => ({ key: line.key, speaker: line.speaker, listener: line.listener, listenerOrigin: 'human' as const, listenerConfidence: null })));
  return lines.map((line) => {
    let before: { speaker: string | null; source: string; translation: string | null }[] = [];
    if (options.before > 0) {
      const groupId = units.get(line.id)!;
      if (!groupLines.has(groupId))
        groupLines.set(groupId, db.select({ id: s.units.id, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation }).from(s.units).where(eq(s.units.groupId, groupId)).orderBy(asc(s.units.seq)).all());
      const siblings = groupLines.get(groupId)!;
      const index = siblings.findIndex((row) => row.id === line.id);
      before = siblings.slice(Math.max(0, index - options.before), index).map(({ speaker, source, translation }) => ({ speaker, source, translation }));
    }
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
      ...(options.before > 0 ? { before } : {}),
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
    if (next.translation === undefined && next.listener === undefined && !next.status && !next.addTags.length && !next.removeTags.length) {
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
    if (!unit) report.errors.push({ key: change.key, reason: '없는 대사 키입니다.' });
    else if (seen.has(change.key)) report.errors.push({ key: change.key, reason: '같은 키가 두 번 나옵니다.' });
    else if (change.rev !== undefined && change.rev !== unit.updatedAt.getTime()) report.conflicts.push({ key: change.key, reason: '읽은 뒤에 다른 곳에서 바뀌었습니다.' });
    else if (change.status && !statusId(change.status)) report.errors.push({ key: change.key, reason: `없는 상태입니다: ${change.status}` });
    else if ([...change.addTags, ...change.removeTags].some((tag) => !tagId(tag))) report.errors.push({ key: change.key, reason: '없는 태그가 있습니다.' });
    else if (change.translation === undefined && change.listener === undefined && !change.status && !change.addTags.length && !change.removeTags.length) report.errors.push({ key: change.key, reason: '바꿀 내용이 없습니다.' });
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
      const patch: Partial<typeof s.units.$inferInsert> = {};
      if (change.translation !== undefined) {
        const candidate = tx.insert(s.candidates).values({ unitId: unit.id, text: change.translation, origin: batch.origin, model: batch.model ?? null, note: change.note }).returning().get();
        patch.translation = change.translation;
        patch.candidateId = candidate.id;
      }
      if (change.status) patch.statusId = statusId(change.status)!;
      if (patch.translation !== undefined && patch.translation !== unit.translation) applyIssueTags(tx, projectId, unit.id, { clear: 'all' });
      // Applied from the CLI or an accepted proposal: a person decided this translation or status.
      if (patch.statusId || patch.translation !== undefined) Object.assign(patch, { statusBy: 'human', statusRunId: null });
      // Accepting a proposal is a person's decision about the listener.
      if (change.listener !== undefined) Object.assign(patch, { listener: change.listener, listenerOrigin: 'human', listenerConfidence: null });
      if (Object.keys(patch).length) tx.update(s.units).set(patch).where(eq(s.units.id, unit.id)).run();
      const remove = change.removeTags.map((tag) => tagId(tag)!).filter(Boolean);
      if (remove.length) tx.delete(s.unitTags).where(and(eq(s.unitTags.unitId, unit.id), inArray(s.unitTags.tagId, remove))).run();
      const add = change.addTags.map((tag) => tagId(tag)!).filter(Boolean);
      if (add.length) tx.insert(s.unitTags).values(add.map((id) => ({ unitId: unit.id, tagId: id }))).onConflictDoNothing().run();
      applied.push(change.key);
    }
  });
  events.changed(projectId, 'units', 'statuses');
  return { ok: true, applied: applied.length, skipped };
}
