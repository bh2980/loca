import { Hono } from 'hono';
import { and, asc, count, desc, eq, inArray, like, ne, notLike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { isSpecialListener, type NodeType } from '@tw/shared';
import { attachUnitTags } from '../services/tag-scope.ts';
import { assertProjectRefs } from '../services/project-refs.ts';
import { humanLinePatch } from '../services/line-patch.ts';
import { refusesListener, setHumanListener } from '../services/listeners.ts';
import { badRequest, found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import { eachChunk, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { computeLayouts } from '../services/layout.ts';
import { readView, sectionWithMost } from '../services/graph-views.ts';
import { projectSlice } from '../services/route-slice.ts';
import { joinDetail, joinStates } from '../services/join-check.ts';
import { lineMatches } from '../services/line-matches.ts';
import { lineTextFilter } from '../services/line-text.ts';
import { lineMarksSchema } from '@tw/shared';
import { knownListenerSql, markConditions, sameSource } from '../services/line-marks.ts';
import { CompleteRefused, completeLine } from '../services/editor-complete.ts';
import { assistLine } from '../services/editor-assist.ts';
import { describeRule, knownListener as knownListenerOf, speechRuleIndex } from '../services/speech.ts';

const listQuery = z.object({
  groupId: z.string().optional(),
  /** Kind of the containing group (scene / document / ui). */
  kind: z.enum(['scene', 'document', 'ui']).optional(),
  statusId: z.string().optional(),
  /** Tag ids, comma-separated: lines carrying every one of them. */
  tagIds: z.string().optional(),
  q: z.string().trim().optional(),
  speaker: z.string().optional(),
  /** A character name (a known listener). */
  listener: z.string().optional(),
  /** Only lines whose status is shown in the review inbox. */
  review: z.enum(['1']).optional(),
  /** Automatic marks, comma-separated: lines carrying every one of them (line-marks.ts). */
  marks: z.string().optional().transform((value) => value?.split(',').filter(Boolean)).pipe(lineMarksSchema.optional()),
  /** A line to show: the page is the one holding it (the response says which offset it used). */
  focus: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** The line filters shared by the list and its matches: one SQL condition. */
function unitConditions(projectId: string, query: Omit<z.infer<typeof listQuery>, 'offset' | 'limit' | 'focus'>) {
  const conditions: SQL[] = [eq(s.units.projectId, projectId)];
  if (query.groupId) conditions.push(eq(s.units.groupId, query.groupId));
  if (query.kind) conditions.push(eq(s.groups.kind, query.kind));
  if (query.statusId) conditions.push(eq(s.units.statusId, query.statusId));
  for (const tagId of query.tagIds?.split(',').filter(Boolean) ?? []) conditions.push(sql`${s.units.id} in (select unit_id from ${s.unitTags} where tag_id = ${tagId})`);
  if (query.q) conditions.push(lineTextFilter(query.q));
  if (query.speaker) conditions.push(eq(s.units.speaker, query.speaker));
  if (query.listener) conditions.push(and(eq(s.units.listener, query.listener), knownListenerSql)!);
  if (query.review) conditions.push(sql`${s.units.statusId} in (select id from ${s.statuses} where ${s.statuses.projectId} = ${projectId} and ${s.statuses.inReview} = 1)`);
  conditions.push(...markConditions(projectId, query.marks));
  return and(...conditions)!;
}

const unitPatch = z.object({
  /** New text from a person: stored as a human candidate and selected. */
  translation: z.string().optional(),
  candidateId: z.string().optional(),
  statusId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  /** A person's choice of listener (null = unknown); it replaces any AI or imported listener. */
  listener: z.string().trim().min(1).nullable().optional(),
  /** A person's note on the line; empty clears it. Who set the status is not touched. */
  note: z.string().max(2000).optional(),
});

const unitColumns = {
  id: s.units.id,
  key: s.units.key,
  groupId: s.units.groupId,
  sort: s.units.sort,
  kind: s.units.kind,
  speaker: s.units.speaker,
  listener: s.units.listener,
  listenerOrigin: s.units.listenerOrigin,
  listenerConfidence: s.units.listenerConfidence,
  source: s.units.source,
  translation: s.units.translation,
  statusId: s.units.statusId,
  statusBy: s.units.statusBy,
  note: s.units.note,
  statusRunId: s.units.statusRunId,
  updatedAt: s.units.updatedAt,
};


/** The list's rows with their scene, candidate origin, tags and latest run note; script order, optionally one page. */
function unitRows(db: Db, where: SQL, page?: { limit: number; offset: number }) {
  const query = db
    .select({ ...unitColumns, groupTitle: s.groups.title, groupKind: s.groups.kind, origin: s.candidates.origin, model: s.candidates.model })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .leftJoin(s.candidates, eq(s.candidates.id, s.units.candidateId))
    .where(where)
    .orderBy(asc(s.units.seq));
  const rows = (page ? query.limit(page.limit).offset(page.offset) : query).all();
  const ids = rows.map((row) => row.id);
  const tagRows = ids.length ? db.select().from(s.unitTags).where(inArray(s.unitTags.unitId, ids)).all() : [];
  const tags = Map.groupBy(tagRows, (row) => row.unitId);
  // What the latest run said about each line (a reviewer's reason to look), newest run first.
  const lastRun = new Map<string, { runId: string; workflowName: string; issues: string[] }>();
  if (ids.length)
    for (const item of db
      .select({ unitId: s.runItems.unitId, runId: s.runs.id, workflowName: s.runs.workflowName, data: s.runItems.data })
      .from(s.runItems)
      .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
      .where(inArray(s.runItems.unitId, ids))
      .orderBy(desc(s.runs.createdAt))
      .all())
      if (!lastRun.has(item.unitId)) lastRun.set(item.unitId, { runId: item.runId, workflowName: item.workflowName, issues: item.data.issues ?? [] });
  return rows.map((row) => ({ ...row, tagIds: (tags.get(row.id) ?? []).map((tag) => tag.tagId), lastRun: lastRun.get(row.id) ?? null }));
}

/** Sections laid out on their own (see layout.ts), in script order, with the scenes in each for jumping from the scene graph. */
function graphSections(db: Db, projectId: string) {
  const stored = db
    .select({ name: s.graphLayouts.section, nodes: sql<number>`json_array_length(${s.graphLayouts.data}, '$.nodes')` })
    .from(s.graphLayouts)
    .where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, 'dialogue'), ne(s.graphLayouts.section, ''), notLike(s.graphLayouts.section, 'view:%'), eq(s.graphLayouts.status, 'ready')))
    .all();
  const scenesBySection = Map.groupBy(
    db.select({ id: s.groups.id, section: s.groups.section }).from(s.groups).where(eq(s.groups.projectId, projectId)).orderBy(asc(s.groups.sort)).all(),
    (group) => group.section ?? '',
  );
  const order = [...scenesBySection.keys()];
  const sections = stored
    .map((row) => ({ name: row.name, nodes: row.nodes ?? 0, groupIds: (scenesBySection.get(row.name) ?? []).map((group) => group.id) }))
    .sort((a, b) => (order.indexOf(a.name) === -1 ? Infinity : order.indexOf(a.name)) - (order.indexOf(b.name) === -1 ? Infinity : order.indexOf(b.name)));
  return sections;
}

export const sourceRoutes = new Hono<Env>()
  .get('/projects/:projectId/groups', validate('query', z.object({ kind: z.enum(['scene', 'document', 'ui']).optional(), q: z.string().trim().optional() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { kind, q } = c.req.valid('query');
    const conditions = [eq(s.groups.projectId, projectId)];
    if (kind) conditions.push(eq(s.groups.kind, kind));
    if (q) conditions.push(or(like(s.groups.title, `%${q}%`), like(s.groups.key, `%${q}%`))!);
    const rows = db.select({ id: s.groups.id, key: s.groups.key, kind: s.groups.kind, title: s.groups.title, description: s.groups.description, section: s.groups.section, sort: s.groups.sort }).from(s.groups).where(and(...conditions)).orderBy(asc(s.groups.sort)).all();
    const counts = db
      .select({ groupId: s.units.groupId, statusId: s.units.statusId, count: count() })
      .from(s.units)
      .where(eq(s.units.projectId, projectId))
      .groupBy(s.units.groupId, s.units.statusId)
      .all();
    const byGroup = Map.groupBy(counts, (row) => row.groupId);
    // Lines whose listener is still unknown (the #청자 미상 mark): where speech rules cannot apply yet.
    const unknown = new Map(
      db
        .select({ groupId: s.units.groupId, count: count() })
        .from(s.units)
        .where(and(eq(s.units.projectId, projectId), ...markConditions(projectId, ['unknownListener'])))
        .groupBy(s.units.groupId)
        .all()
        .map((row) => [row.groupId, row.count]),
    );
    return c.json(
      rows.map((group) => {
        const statuses = Object.fromEntries((byGroup.get(group.id) ?? []).map((row) => [row.statusId, row.count]));
        return { ...group, total: Object.values(statuses).reduce((sum, value) => sum + value, 0), statuses, unknownListeners: unknown.get(group.id) ?? 0 };
      }),
    );
  })
  .get('/groups/:groupId', (c) => {
    const { db } = c.var.deps;
    return c.json(found(db.select().from(s.groups).where(eq(s.groups.id, c.req.param('groupId'))).get(), '장면'));
  })
  /**
   * Every line a filter matches, in script order, with its scene: the translation screen walks
   * them one by one inside their scenes (찾아가기) instead of listing them apart from their context.
   */
  .get('/projects/:projectId/units/matches', validate('query', listQuery.omit({ offset: true, limit: true, focus: true })), (c) => {
    const query = c.req.valid('query');
    const base = c.var.deps.db.select({ id: s.units.id, groupId: s.units.groupId }).from(s.units);
    const rows = (query.kind ? base.innerJoin(s.groups, eq(s.groups.id, s.units.groupId)) : base).where(unitConditions(c.req.param('projectId'), query)).orderBy(asc(s.units.seq)).all();
    return c.json({ rows });
  })
  .get('/projects/:projectId/units', validate('query', listQuery), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const query = c.req.valid('query');
    const where = unitConditions(projectId, query);
    // The groups table is only needed for the kind filter; without it the count is one index range.
    const counted = db.select({ count: count() }).from(s.units);
    const total = (query.kind ? counted.innerJoin(s.groups, eq(s.groups.id, s.units.groupId)) : counted).where(where).get()!.count;
    // Opened at a given line (a link from elsewhere): start at the page that holds it.
    let offset = query.offset;
    if (query.focus) {
      const target = db.select({ seq: s.units.seq }).from(s.units).where(and(eq(s.units.id, query.focus), eq(s.units.projectId, projectId))).get();
      if (target) {
        const before = (query.kind ? db.select({ count: count() }).from(s.units).innerJoin(s.groups, eq(s.groups.id, s.units.groupId)) : db.select({ count: count() }).from(s.units)).where(and(where, sql`${s.units.seq} < ${target.seq}`)).get()!.count;
        offset = Math.floor(before / query.limit) * query.limit;
      }
    }
    return c.json({ total, offset, rows: unitRows(db, where, { limit: query.limit, offset }) });
  })
  /** Lines by key, in script order: evidence cited by knowledge drafts. */
  .post('/projects/:projectId/units/by-keys', validate('json', z.object({ keys: z.array(z.string()).max(500) })), (c) => {
    const keys = c.req.valid('json').keys;
    if (!keys.length) return c.json([]);
    return c.json(
      c.var.deps.db
        .select({ ...unitColumns, groupTitle: s.groups.title })
        .from(s.units)
        .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
        .where(and(eq(s.units.projectId, c.req.param('projectId')), inArray(s.units.key, keys)))
        .orderBy(asc(s.units.seq))
        .all(),
    );
  })
  .patch(
    '/projects/:projectId/units',
    validate(
      'json',
      z.object({
        unitIds: z.array(z.string()).min(1),
        statusId: z.string().optional(),
        /** 확인함: a person looked at the lines; their statuses stay, but a person now holds them (no ✦). */
        checked: z.literal(true).optional(),
        addTagIds: z.array(z.string()).default([]),
        removeTagIds: z.array(z.string()).default([]),
        /** A person's listener for the picked dialogue lines (null = unknown); narration keeps none. */
        listener: z.string().trim().min(1).nullable().optional(),
      }),
    ),
    (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const body = c.req.valid('json');
    assertProjectRefs(db, projectId, { unitIds: body.unitIds, statusId: body.statusId, tagIds: [...body.addTagIds, ...body.removeTagIds] });
    db.transaction((tx) => {
      // A person setting the status (or confirming what a run set) makes it theirs.
      const patch = humanLinePatch(tx, null, { statusId: body.statusId, checked: body.checked });
      // Chunked: a selection can be a whole project, and SQLite caps bound variables per statement.
      if (Object.keys(patch).length) eachChunk(body.unitIds, (slice) => tx.update(s.units).set(patch).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).run());
      attachUnitTags(tx, projectId, body.unitIds, { add: body.addTagIds, remove: body.removeTagIds }, { onMisplaced: 'refuse' });
      if (body.listener !== undefined) setHumanListener(tx, body.unitIds, body.listener);
    });
    events.changed(projectId, 'units', 'statuses');
    return c.json({ ok: true });
    },
  )
  .get('/units/:unitId', (c) => {
    const { db } = c.var.deps;
    const unitId = c.req.param('unitId');
    const unit = found(db.select().from(s.units).where(eq(s.units.id, unitId)).get(), '대사');
    const group = db.select({ id: s.groups.id, title: s.groups.title, key: s.groups.key }).from(s.groups).where(eq(s.groups.id, unit.groupId)).get()!;
    const candidates = db.select().from(s.candidates).where(eq(s.candidates.unitId, unitId)).orderBy(desc(s.candidates.createdAt)).all();
    const tagIds = db.select({ tagId: s.unitTags.tagId }).from(s.unitTags).where(eq(s.unitTags.unitId, unitId)).all().map((row) => row.tagId);
    const history = db
      .select({ id: s.runItems.id, runId: s.runs.id, workflowName: s.runs.workflowName, state: s.runItems.state, nodeId: s.runItems.nodeId, error: s.runItems.error, data: s.runItems.data, createdAt: s.runs.createdAt })
      .from(s.runItems)
      .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
      .where(eq(s.runItems.unitId, unitId))
      .orderBy(desc(s.runs.createdAt))
      .limit(20)
      .all();
    const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key }).from(s.graphNodes).where(sql`exists (select 1 from json_each(${s.graphNodes.unitIds}) where value = ${unitId})`).all();
    const resolved = speechRuleIndex(db, unit.projectId).resolve([unit]).get(unit.key);
    const speech = resolved ? { listener: resolved.listener, ruleId: resolved.rule.id, rule: describeRule(resolved.rule), level: resolved.rule.level, byOrder: resolved.byOrder, routeDependent: !!resolved.routeDependent, others: !!resolved.others } : null;
    // Who this line may address, nearest first: the scene's other speakers (extras included) and
    // names people already typed as a listener there, for the listener picker.
    const sceneLines = db.select({ seq: s.units.seq, speaker: s.units.speaker, listener: s.units.listener, origin: s.units.listenerOrigin }).from(s.units).where(eq(s.units.groupId, unit.groupId)).all();
    const distance = new Map<string, number>();
    for (const other of sceneLines) {
      for (const name of [other.speaker, other.origin === 'human' ? other.listener : null]) {
        if (!name || name === unit.speaker || isSpecialListener(name)) continue;
        const far = Math.abs(other.seq - unit.seq);
        if (far < (distance.get(name) ?? Infinity)) distance.set(name, far);
      }
    }
    const sceneNames = [...distance].sort((a, b) => a[1] - b[1]).map(([name]) => name);
    return c.json({ ...unit, group, candidates, tagIds, history, graphNodes: nodes, speech, sceneNames });
  })
  /** The editor's AI continuation of a line (docs/DESIGN.md J3b A): the whole line, starting with `prefix`. Cancelled with the request. */
  .post('/units/:unitId/complete', validate('json', z.object({ prefix: z.string().max(4000).default('') })), async (c) => {
    const { db, secrets } = c.var.deps;
    try {
      return c.json(await completeLine(db, secrets, c.req.param('unitId'), c.req.valid('json').prefix, c.req.raw.signal));
    } catch (error) {
      if (error instanceof CompleteRefused) return c.json({ error: error.message, retryAfterSeconds: error.retryAfterSeconds }, error.status);
      throw error;
    }
  })
  /** The editor's 'AI 번역' / '다듬기' of a line (docs/DESIGN.md J3b C): a new AI candidate. Cancelled with the request. */
  .post('/units/:unitId/assist', validate('json', z.object({ mode: z.enum(['translate', 'refine']), draft: z.string().max(8000).default('') })), async (c) => {
    const { db, secrets } = c.var.deps;
    try {
      return c.json(await assistLine(db, secrets, c.req.param('unitId'), c.req.valid('json'), c.req.raw.signal));
    } catch (error) {
      if (error instanceof CompleteRefused) return c.json({ error: error.message, retryAfterSeconds: error.retryAfterSeconds }, error.status);
      throw error;
    }
  })
  /** Other lines with the same source (case and end punctuation aside), translated or not: what a confirmed translation may be applied to. */
  .get('/units/:unitId/same', (c) => {
    const { db } = c.var.deps;
    const unit = found(db.select({ id: s.units.id, projectId: s.units.projectId, source: s.units.source }).from(s.units).where(eq(s.units.id, c.req.param('unitId'))).get(), '대사');
    const rows = db
      .select({ id: s.units.id, groupId: s.units.groupId, groupTitle: s.groups.title, translation: s.units.translation, speaker: s.units.speaker, listener: s.units.listener, kind: s.statuses.kind })
      .from(s.units)
      .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
      .innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
      .where(and(eq(s.units.projectId, unit.projectId), ne(s.units.id, unit.id), sql`${sameSource(sql`${s.units.source}`)} = ${sameSource(sql`${unit.source}`)}`, sql`${sameSource(sql`${unit.source}`)} != ''`))
      .orderBy(asc(s.units.seq))
      .limit(200)
      .all();
    return c.json(rows.map(({ kind, ...row }) => ({ ...row, final: kind === 'final' })));
  })
  /** Already translated lines of the project with the same or a similar source (the editor's suggestions). */
  .get('/units/:unitId/matches', (c) => {
    const { db } = c.var.deps;
    const unit = found(db.select({ id: s.units.id, projectId: s.units.projectId, source: s.units.source }).from(s.units).where(eq(s.units.id, c.req.param('unitId'))).get(), '대사');
    const rules = db.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, unit.projectId)).get()?.rules;
    return c.json(lineMatches(db, unit, rules));
  })
  .patch('/units/:unitId', validate('json', unitPatch), (c) => {
    const { db } = c.var.deps;
    const unitId = c.req.param('unitId');
    const body = c.req.valid('json');
    const unit = found(db.select().from(s.units).where(eq(s.units.id, unitId)).get(), '대사');
    assertProjectRefs(db, unit.projectId, { statusId: body.statusId, tagIds: body.tagIds, candidateId: body.candidateId });
    if (refusesListener(unit, body.listener)) badRequest('나레이션에는 청자가 없습니다.');
    db.transaction((tx) => {
      const change: Parameters<typeof humanLinePatch>[2] = { statusId: body.statusId };
      if (body.translation !== undefined) {
        const candidate = tx.insert(s.candidates).values({ unitId, text: body.translation, origin: 'human' }).returning().get();
        change.translation = body.translation;
        change.candidateId = candidate.id;
      } else if (body.candidateId) {
        const candidate = found(tx.select().from(s.candidates).where(and(eq(s.candidates.id, body.candidateId), eq(s.candidates.unitId, unitId))).get(), '후보');
        change.translation = candidate.text;
        change.candidateId = candidate.id;
      }
      const patch = humanLinePatch(tx, unit, change);
      if (body.note !== undefined) patch.note = body.note.trim();
      if (Object.keys(patch).length) tx.update(s.units).set(patch).where(eq(s.units.id, unitId)).run();
      if (body.listener !== undefined) setHumanListener(tx, [unitId], body.listener);
      if (body.tagIds) {
        const current = tx.select({ tagId: s.unitTags.tagId }).from(s.unitTags).where(eq(s.unitTags.unitId, unitId)).all().map((row) => row.tagId);
        attachUnitTags(tx, unit.projectId, [unitId], { add: body.tagIds, remove: current.filter((id) => !body.tagIds!.includes(id)) }, { onMisplaced: 'refuse' });
      }
    });
    events.changed(unit.projectId, 'units', 'statuses');
    return c.json({ ok: true });
  })

  // ── graphs ─────────────────────────────────────────────────────────
  /** The main route (본 줄기) for highlighting on the graph. */
  /** The slice of the dialogue graph for the stored choices (길 따라 보기, services/route-slice.ts), with the picks. */
  .get('/projects/:projectId/route', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    return c.json({ ...projectSlice(db, projectId), picks: db.select({ picks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.picks ?? {} });
  })
  /** A person's arm at a choice of the slice; armId null takes the pick back. */
  .put('/projects/:projectId/route-picks', validate('json', z.object({ nodeId: z.string(), armId: z.string().nullable() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { nodeId, armId } = c.req.valid('json');
    const current = db.select({ picks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, projectId)).get();
    if (!current) badRequest('프로젝트를 찾을 수 없습니다.');
    const inProject = (id: string) => db.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.id, id), eq(s.graphNodes.projectId, projectId))).get();
    const picks = { ...current.picks };
    if (armId === null) delete picks[nodeId];
    else {
      if (!inProject(nodeId) || !inProject(armId)) badRequest('이 프로젝트의 그래프 노드가 아닙니다.');
      if (!db.select({ id: s.graphEdges.id }).from(s.graphEdges).where(and(eq(s.graphEdges.projectId, projectId), eq(s.graphEdges.fromId, nodeId), eq(s.graphEdges.toId, armId))).get()) badRequest('두 노드를 잇는 연결이 없습니다.');
      picks[nodeId] = armId;
    }
    db.update(s.projects).set({ routePicks: picks }).where(eq(s.projects.id, projectId)).run();
    events.changed(projectId, 'graph', 'units');
    return c.json({ picks });
  })
  .delete('/projects/:projectId/route-picks', (c) => {
    const projectId = c.req.param('projectId');
    c.var.deps.db.update(s.projects).set({ routePicks: {} }).where(eq(s.projects.id, projectId)).run();
    events.changed(projectId, 'graph', 'units');
    return c.json({ picks: {} });
  })
  /** 합류 점검: the checked joins of the slice and whether the lines they were checked against still read the same. */
  .get('/projects/:projectId/join-checks', (c) => c.json({ checks: joinStates(c.var.deps.db, c.req.param('projectId')) }))
  /** One join of the slice: each incoming route's last lines before it and the lines after it (source and current translation). */
  .get('/projects/:projectId/route/joins/:nodeId', (c) => {
    return c.json(found(joinDetail(c.var.deps.db, c.req.param('projectId'), c.req.param('nodeId')) ?? undefined, '합류 지점'));
  })
  /** Mark a join checked. `sig` is the signature of the lines the person read; if they changed meanwhile the mark is refused. */
  .put('/projects/:projectId/join-checks/:nodeId', validate('json', z.object({ sig: z.string().min(1, '확인한 내용의 서명이 필요합니다.') })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    const detail = joinDetail(db, projectId, nodeId);
    if (!detail) badRequest('지금 길 조각의 합류 지점이 아닙니다.');
    if (detail.sig !== c.req.valid('json').sig) badRequest('점검하는 사이 이 합류의 번역이 바뀌었습니다. 바뀐 내용을 다시 확인해 주세요.');
    const current = db.select({ checks: s.projects.joinChecks }).from(s.projects).where(eq(s.projects.id, projectId)).get();
    const at = new Date().toISOString();
    db.update(s.projects).set({ joinChecks: { ...current?.checks, [nodeId]: { at, sig: detail.sig } } }).where(eq(s.projects.id, projectId)).run();
    events.changed(projectId, 'graph', 'units');
    return c.json({ nodeId, at, state: 'checked' as const });
  })
  .delete('/projects/:projectId/join-checks/:nodeId', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const current = db.select({ checks: s.projects.joinChecks }).from(s.projects).where(eq(s.projects.id, projectId)).get();
    if (!current) badRequest('프로젝트를 찾을 수 없습니다.');
    const { [c.req.param('nodeId')]: _removed, ...rest } = current.checks;
    db.update(s.projects).set({ joinChecks: rest }).where(eq(s.projects.id, projectId)).run();
    events.changed(projectId, 'graph', 'units');
    return c.json({ ok: true });
  })
  /** The dialogue graph's sections alone: the graph page needs them before it knows which layout to load. */
  .get('/projects/:projectId/graph/sections', (c) => c.json(graphSections(c.var.deps.db, c.req.param('projectId'))))
  .get('/projects/:projectId/graph/:scope{dialogue|scene}', validate('query', z.object({ section: z.string().optional() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const scope = c.req.param('scope') as 'dialogue' | 'scene';
    const section = scope === 'dialogue' ? (c.req.valid('query').section ?? '') : '';
    const where = and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, scope), eq(s.graphLayouts.section, section));
    const layout = db.select({ status: s.graphLayouts.status, error: s.graphLayouts.error }).from(s.graphLayouts).where(where).get();
    if (scope === 'scene') {
      const nodes = db
        .select({ id: s.groups.id, label: s.groups.title, key: s.groups.key, total: sql<number>`(select count(*) from units u where u.group_id = "groups"."id")` })
        .from(s.groups)
        .where(and(eq(s.groups.projectId, projectId), eq(s.groups.kind, 'scene')))
        .all();
      return c.json({
        status: layout?.status ?? 'missing',
        error: layout?.error ?? null,
        layout: db.select({ data: s.graphLayouts.data }).from(s.graphLayouts).where(where).get()?.data ?? null,
        nodes: nodes.map((node) => ({ ...node, type: null as string | null, kind: 'scene', groupId: node.id, preview: `${node.total}개 대사`, speaker: null as string | null, text: null as string | null })),
        nodeTypes: {} as Record<string, NodeType>,
        sections: [] as { name: string; nodes: number; groupIds: string[] }[],
      });
    }
    const sections = graphSections(db, projectId);
    // The stored layout goes out as the JSON text it is stored as: parsing and re-serializing a
    // 50k-node layout (15 MB) held the server for a quarter of a second. A section's layout is
    // small, so its node ids are read from it to send only that section's nodes.
    const raw = db.select({ data: sql<string | null>`${s.graphLayouts.data}` }).from(s.graphLayouts).where(where).get()?.data ?? 'null';
    // Nodes folded into a straight run or into an edge (a choice) are not layout nodes but are shown through them: send them too.
    const parsed = section && raw !== 'null' ? (JSON.parse(raw) as s.LayoutData) : null;
    const only = parsed ? [...parsed.nodes.map((node) => node.id).filter((id) => !id.startsWith('portal:')), ...(parsed.chains ?? []).flatMap((chain) => chain.nodeIds), ...parsed.edges.flatMap((edge) => (edge.via ? [edge.via] : []))] : null;
    // One preview line per node keeps the payload small; details load on selection.
    const nodes = db
      .select({
        id: s.graphNodes.id,
        key: s.graphNodes.key,
        type: s.graphNodes.type,
        kind: s.graphNodes.kind,
        label: s.graphNodes.label,
        groupId: s.graphNodes.groupId,
        total: sql<number>`json_array_length(${s.graphNodes.unitIds})`,
        preview: sql<string | null>`(select coalesce(u.speaker || ': ', '') || substr(u.source, 1, 90) from units u where u.id = json_extract("graph_nodes"."unit_ids", '$[0]'))`,
        // The first line apart, so a card can lead with who speaks.
        speaker: sql<string | null>`(select u.speaker from units u where u.id = json_extract("graph_nodes"."unit_ids", '$[0]'))`,
        text: sql<string | null>`(select substr(u.source, 1, 120) from units u where u.id = json_extract("graph_nodes"."unit_ids", '$[0]'))`,
      })
      .from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), only ? inList(s.graphNodes.id, only) : undefined))
      .all();
    const nodeTypes = db.select({ nodeTypes: s.projects.nodeTypes }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.nodeTypes ?? {};
    const head = JSON.stringify({ status: layout?.status ?? 'missing', error: layout?.error ?? null, nodes, nodeTypes, sections });
    return c.body(`${head.slice(0, -1)},"layout":${raw}}`, 200, { 'content-type': 'application/json; charset=UTF-8' }) as unknown as ReturnType<
      typeof c.json<{ status: string; error: string | null; layout: s.LayoutData | null; nodes: typeof nodes; nodeTypes: typeof nodeTypes; sections: typeof sections }>
    >;
  })
  /** A stored view of graph nodes (see graph-views.ts): what it holds and the section showing most of it. */
  .get('/projects/:projectId/graph/views/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const view = found(readView(db, projectId, c.req.param('id')), '보기');
    return c.json({ id: view.id, label: view.label, nodeIds: view.nodeIds, section: sectionWithMost(db, projectId, view.nodeIds) });
  })
  /** Recompute stored layouts, e.g. after the layout options changed. The source graph itself is untouched. */
  .post('/projects/:projectId/graph/relayout', (c) => {
    void computeLayouts(c.var.deps.db, c.req.param('projectId'));
    return c.json({ ok: true }, 202);
  })
  .get('/graph-nodes/:nodeId', (c) => {
    const { db } = c.var.deps;
    const node = found(db.select().from(s.graphNodes).where(eq(s.graphNodes.id, c.req.param('nodeId'))).get(), '노드');
    const lines = node.unitIds.length ? db.select(unitColumns).from(s.units).where(inArray(s.units.id, node.unitIds)).all() : [];
    const order = new Map(node.unitIds.map((id, index) => [id, index]));
    const neighbour = (direction: 'in' | 'out') =>
      db
        .select({ id: s.graphNodes.id, key: s.graphNodes.key, kind: s.graphNodes.kind, label: s.graphNodes.label, edgeLabel: s.graphEdges.label })
        .from(s.graphEdges)
        .innerJoin(s.graphNodes, eq(s.graphNodes.id, direction === 'in' ? s.graphEdges.fromId : s.graphEdges.toId))
        .where(eq(direction === 'in' ? s.graphEdges.toId : s.graphEdges.fromId, node.id))
        .all();
    const project = db.select({ nodeTypes: s.projects.nodeTypes }).from(s.projects).where(eq(s.projects.id, node.projectId)).get();
    const typeInfo = node.type ? (project?.nodeTypes[node.type] ?? null) : null;
    const group = node.groupId ? db.select({ id: s.groups.id, title: s.groups.title }).from(s.groups).where(eq(s.groups.id, node.groupId)).get() : null;
    return c.json({
      ...node,
      typeInfo,
      group,
      // Each line with whom it addresses and the speech level its rule asks for (the pane shows them small).
      units: (() => {
        const resolved = speechRuleIndex(db, node.projectId).resolve(lines);
        return lines
          .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
          .map((line) => ({ ...line, heard: knownListenerOf(line), level: resolved.get(line.key)?.rule.level ?? null }));
      })(),
      incoming: neighbour('in'),
      outgoing: neighbour('out'),
    });
  });
