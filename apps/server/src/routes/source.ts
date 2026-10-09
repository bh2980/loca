import { Hono } from 'hono';
import { and, asc, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { NodeType } from '@tw/shared';
import { found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { computeLayouts } from '../services/layout.ts';

const listQuery = z.object({
  groupId: z.string().optional(),
  /** Kind of the containing group (scene / document / ui). */
  kind: z.enum(['scene', 'document', 'ui']).optional(),
  statusId: z.string().optional(),
  tagId: z.string().optional(),
  q: z.string().trim().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const unitPatch = z.object({
  /** New text from a person: stored as a human candidate and selected. */
  translation: z.string().optional(),
  candidateId: z.string().optional(),
  statusId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
});

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
  source: s.units.source,
  translation: s.units.translation,
  statusId: s.units.statusId,
  updatedAt: s.units.updatedAt,
};

export const sourceRoutes = new Hono<Env>()
  .get('/projects/:projectId/groups', validate('query', z.object({ kind: z.enum(['scene', 'document', 'ui']).optional(), q: z.string().trim().optional() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { kind, q } = c.req.valid('query');
    const conditions = [eq(s.groups.projectId, projectId)];
    if (kind) conditions.push(eq(s.groups.kind, kind));
    if (q) conditions.push(or(like(s.groups.title, `%${q}%`), like(s.groups.key, `%${q}%`))!);
    const rows = db.select({ id: s.groups.id, key: s.groups.key, kind: s.groups.kind, title: s.groups.title, description: s.groups.description, sort: s.groups.sort }).from(s.groups).where(and(...conditions)).orderBy(asc(s.groups.sort)).all();
    const counts = db
      .select({ groupId: s.units.groupId, statusId: s.units.statusId, count: count() })
      .from(s.units)
      .where(eq(s.units.projectId, projectId))
      .groupBy(s.units.groupId, s.units.statusId)
      .all();
    const byGroup = Map.groupBy(counts, (row) => row.groupId);
    return c.json(
      rows.map((group) => {
        const statuses = Object.fromEntries((byGroup.get(group.id) ?? []).map((row) => [row.statusId, row.count]));
        return { ...group, total: Object.values(statuses).reduce((sum, value) => sum + value, 0), statuses };
      }),
    );
  })
  .get('/groups/:groupId', (c) => {
    const { db } = c.var.deps;
    return c.json(found(db.select().from(s.groups).where(eq(s.groups.id, c.req.param('groupId'))).get(), '장면'));
  })
  .get('/projects/:projectId/units', validate('query', listQuery), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const query = c.req.valid('query');
    const conditions: SQL[] = [eq(s.units.projectId, projectId)];
    if (query.groupId) conditions.push(eq(s.units.groupId, query.groupId));
    if (query.kind) conditions.push(eq(s.groups.kind, query.kind));
    if (query.statusId) conditions.push(eq(s.units.statusId, query.statusId));
    if (query.tagId) conditions.push(sql`${s.units.id} in (select unit_id from ${s.unitTags} where tag_id = ${query.tagId})`);
    if (query.q) conditions.push(textFilter(query.q));
    const where = and(...conditions);
    const total = db.select({ count: count() }).from(s.units).innerJoin(s.groups, eq(s.groups.id, s.units.groupId)).where(where).get()!.count;
    const rows = db
      .select({ ...unitColumns, groupTitle: s.groups.title, origin: s.candidates.origin, model: s.candidates.model })
      .from(s.units)
      .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
      .leftJoin(s.candidates, eq(s.candidates.id, s.units.candidateId))
      .where(where)
      .orderBy(asc(s.groups.sort), asc(s.units.sort))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const tagRows = rows.length ? db.select().from(s.unitTags).where(inArray(s.unitTags.unitId, rows.map((row) => row.id))).all() : [];
    const tags = Map.groupBy(tagRows, (row) => row.unitId);
    return c.json({ total, rows: rows.map((row) => ({ ...row, tagIds: (tags.get(row.id) ?? []).map((tag) => tag.tagId) })) });
  })
  .patch('/projects/:projectId/units', validate('json', z.object({ unitIds: z.array(z.string()).min(1), statusId: z.string().optional(), addTagIds: z.array(z.string()).default([]), removeTagIds: z.array(z.string()).default([]) })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const body = c.req.valid('json');
    db.transaction((tx) => {
      if (body.statusId) tx.update(s.units).set({ statusId: body.statusId }).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, body.unitIds))).run();
      if (body.removeTagIds.length) tx.delete(s.unitTags).where(and(inArray(s.unitTags.unitId, body.unitIds), inArray(s.unitTags.tagId, body.removeTagIds))).run();
      if (body.addTagIds.length)
        tx.insert(s.unitTags).values(body.unitIds.flatMap((unitId) => body.addTagIds.map((tagId) => ({ unitId, tagId })))).onConflictDoNothing().run();
    });
    events.changed(projectId, 'units', 'statuses');
    return c.json({ ok: true });
  })
  /**
   * Review inbox: every line whose status is marked "in review", however it got there (a person,
   * a workflow's status change, the import). With the last run's issues as the reason, if any.
   */
  .get('/projects/:projectId/reviews', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const where = and(eq(s.units.projectId, projectId), eq(s.statuses.inReview, true));
    const total = db.select({ count: count() }).from(s.units).innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId)).where(where).get()!.count;
    const rows = db
      .select({ ...unitColumns, groupTitle: s.groups.title, statusName: s.statuses.name })
      .from(s.units)
      .innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
      .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
      .where(where)
      .orderBy(asc(s.groups.sort), asc(s.units.sort))
      .limit(500)
      .all();
    const latest = new Map<string, { workflowName: string; runId: string; issues: string[] }>();
    if (rows.length)
      for (const item of db
        .select({ unitId: s.runItems.unitId, runId: s.runs.id, workflowName: s.runs.workflowName, data: s.runItems.data })
        .from(s.runItems)
        .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
        .where(inArray(s.runItems.unitId, rows.map((row) => row.id)))
        .orderBy(desc(s.runs.createdAt))
        .all())
        if (!latest.has(item.unitId)) latest.set(item.unitId, { workflowName: item.workflowName, runId: item.runId, issues: item.data.issues ?? [] });
    return c.json({ total, rows: rows.map((row) => ({ ...row, lastRun: latest.get(row.id) ?? null })) });
  })
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
    return c.json({ ...unit, group, candidates, tagIds, history, graphNodes: nodes });
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
  .get('/projects/:projectId/graph/:scope{dialogue|scene}', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const scope = c.req.param('scope') as 'dialogue' | 'scene';
    const layout = db.select().from(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, scope))).get();
    if (scope === 'scene') {
      const nodes = db
        .select({ id: s.groups.id, label: s.groups.title, key: s.groups.key, total: sql<number>`(select count(*) from units u where u.group_id = "groups"."id")` })
        .from(s.groups)
        .where(and(eq(s.groups.projectId, projectId), eq(s.groups.kind, 'scene')))
        .all();
      return c.json({
        status: layout?.status ?? 'missing',
        error: layout?.error ?? null,
        layout: layout?.data ?? null,
        nodes: nodes.map((node) => ({ ...node, type: null as string | null, kind: 'scene', groupId: node.id, preview: `${node.total}개 대사` })),
        nodeTypes: {} as Record<string, NodeType>,
      });
    }
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
      })
      .from(s.graphNodes)
      .where(eq(s.graphNodes.projectId, projectId))
      .all();
    const nodeTypes = db.select({ nodeTypes: s.projects.nodeTypes }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.nodeTypes ?? {};
    return c.json({ status: layout?.status ?? 'missing', error: layout?.error ?? null, layout: layout?.data ?? null, nodes, nodeTypes });
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
      units: lines.sort((a, b) => order.get(a.id)! - order.get(b.id)!),
      incoming: neighbour('in'),
      outgoing: neighbour('out'),
    });
  });
