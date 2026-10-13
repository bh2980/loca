import { Hono } from 'hono';
import { and, asc, count, desc, eq, inArray, like, ne, notLike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { isSpecialListener, LISTENER_MIN_CONFIDENCE, type NodeType } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import { eachChunk, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { computeLayouts } from '../services/layout.ts';
import { readView, sectionWithMost } from '../services/graph-views.ts';
import { applyIssueTags } from '../services/issue-tags.ts';
import { lineMatches } from '../services/line-matches.ts';
import { describeRule, knownListener as knownListenerOf, speechRuleIndex } from '../services/speech.ts';

const listQuery = z.object({
  groupId: z.string().optional(),
  /** Kind of the containing group (scene / document / ui). */
  kind: z.enum(['scene', 'document', 'ui']).optional(),
  statusId: z.string().optional(),
  tagId: z.string().optional(),
  q: z.string().trim().optional(),
  speaker: z.string().optional(),
  /** A character name, or "-" for lines whose listener is unknown (none, or an unsure AI guess). */
  listener: z.string().optional(),
  /** Only lines whose status is shown in the review inbox. */
  review: z.enum(['1']).optional(),
  /** Only lines not yet in a final status. */
  remaining: z.enum(['1']).optional(),
  /** Only lines whose current status a run set and no person has looked at since (✦). */
  by: z.enum(['ai']).optional(),
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
  if (query.tagId) conditions.push(sql`${s.units.id} in (select unit_id from ${s.unitTags} where tag_id = ${query.tagId})`);
  if (query.q) conditions.push(textFilter(query.q));
  if (query.speaker) conditions.push(eq(s.units.speaker, query.speaker));
  // Unknown listener: dialogue only (narration has no listener), as the home page counts it.
  if (query.listener === '-') conditions.push(and(eq(s.units.kind, 'dialogue'), sql`not ${knownListener}`)!);
  else if (query.listener) conditions.push(and(eq(s.units.listener, query.listener), knownListener)!);
  if (query.review) conditions.push(sql`${s.units.statusId} in (select id from ${s.statuses} where ${s.statuses.projectId} = ${projectId} and ${s.statuses.inReview} = 1)`);
  if (query.by) conditions.push(eq(s.units.statusBy, query.by));
  if (query.remaining) conditions.push(sql`${s.units.statusId} in (select id from ${s.statuses} where ${s.statuses.projectId} = ${projectId} and ${s.statuses.kind} != 'final')`);
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
});

/** The listener counts unless it is an unsure guess (by line or by scene), as isUnsureListener. */
const knownListener = sql`(${s.units.listener} is not null and (${s.units.listenerOrigin} not in ('ai', 'scene') or ${s.units.listenerConfidence} >= ${LISTENER_MIN_CONFIDENCE}))`;

/** Trigram FTS needs 3+ characters; shorter queries fall back to LIKE over the same columns. */
function textFilter(q: string): SQL {
  if ([...q].length >= 3) {
    const phrase = `"${q.replace(/"/g, '""')}"`;
    return sql`${s.units}.rowid in (select rowid from units_fts where units_fts match ${phrase})`;
  }
  const pattern = `%${q.replace(/[%_]/g, (char) => `\\${char}`)}%`;
  return or(
    sql`${s.units.source} like ${pattern} escape '\\'`,
    sql`${s.units.translation} like ${pattern} escape '\\'`,
    sql`${s.units.speaker} like ${pattern} escape '\\'`,
    sql`${s.units.key} like ${pattern} escape '\\'`,
  )!;
}

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
  statusRunId: s.units.statusRunId,
  updatedAt: s.units.updatedAt,
};


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
    // Dialogue lines whose listener is still unknown: where speech rules cannot apply yet.
    const unknown = new Map(
      db
        .select({ groupId: s.units.groupId, count: count() })
        .from(s.units)
        .where(and(eq(s.units.projectId, projectId), eq(s.units.kind, 'dialogue'), sql`not ${knownListener}`))
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
    const rows = db
      .select({ ...unitColumns, groupTitle: s.groups.title, origin: s.candidates.origin, model: s.candidates.model })
      .from(s.units)
      .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
      .leftJoin(s.candidates, eq(s.candidates.id, s.units.candidateId))
      .where(where)
      .orderBy(asc(s.units.seq))
      .limit(query.limit)
      .offset(offset)
      .all();
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
    return c.json({ total, offset, rows: rows.map((row) => ({ ...row, tagIds: (tags.get(row.id) ?? []).map((tag) => tag.tagId), lastRun: lastRun.get(row.id) ?? null })) });
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
      }),
    ),
    (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const body = c.req.valid('json');
    db.transaction((tx) => {
      // Chunked: a selection can be a whole project, and SQLite caps bound variables per statement.
      eachChunk(body.unitIds, (slice) => {
        // A person setting the status (or confirming what a run set) makes it theirs.
        if (body.statusId || body.checked) tx.update(s.units).set({ ...(body.statusId && { statusId: body.statusId }), statusBy: 'human', statusRunId: null }).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).run();
        if (body.removeTagIds.length) tx.delete(s.unitTags).where(and(inArray(s.unitTags.unitId, slice), inArray(s.unitTags.tagId, body.removeTagIds))).run();
      });
      if (body.addTagIds.length)
        eachChunk(body.unitIds, (slice) => {
          tx.insert(s.unitTags).values(slice.flatMap((unitId) => body.addTagIds.map((tagId) => ({ unitId, tagId })))).onConflictDoNothing().run();
        }, Math.max(1, Math.floor(30_000 / (body.addTagIds.length * 2))));
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
    db.transaction((tx) => {
      const patch: Partial<typeof s.units.$inferInsert> = {};
      if (body.translation !== undefined) {
        const candidate = tx.insert(s.candidates).values({ unitId, text: body.translation, origin: 'human' }).returning().get();
        patch.translation = body.translation;
        patch.candidateId = candidate.id;
      } else if (body.candidateId) {
        const candidate = found(tx.select().from(s.candidates).where(and(eq(s.candidates.id, body.candidateId), eq(s.candidates.unitId, unitId))).get(), '후보');
        patch.translation = candidate.text;
        patch.candidateId = candidate.id;
      }
      if (body.statusId) patch.statusId = body.statusId;
      // Problem-type tags described the old text.
      if (patch.translation !== undefined && patch.translation !== unit.translation) applyIssueTags(tx, unit.projectId, unitId, { clear: 'all' });
      // A person's translation or status: the line's status is theirs now (docs/DESIGN.md 3.5).
      if (patch.statusId || patch.translation !== undefined) Object.assign(patch, { statusBy: 'human', statusRunId: null });
      if (body.listener !== undefined) Object.assign(patch, { listener: body.listener, listenerOrigin: 'human', listenerConfidence: null });
      if (Object.keys(patch).length) tx.update(s.units).set(patch).where(eq(s.units.id, unitId)).run();
      if (body.tagIds) {
        tx.delete(s.unitTags).where(eq(s.unitTags.unitId, unitId)).run();
        if (body.tagIds.length) tx.insert(s.unitTags).values(body.tagIds.map((tagId) => ({ unitId, tagId }))).run();
      }
    });
    events.changed(unit.projectId, 'units', 'statuses');
    return c.json({ ok: true });
  })

  // ── graphs ─────────────────────────────────────────────────────────
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
