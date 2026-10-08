import { Hono } from 'hono';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { importFileSchema, STATUS_COLORS } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { forgetProjectContext } from '../services/context.ts';
import { importProject } from '../services/importer.ts';
import { computeLayouts } from '../services/layout.ts';

const statusInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().default(STATUS_COLORS[0]), kind: z.enum(['initial', 'normal', 'final']).default('normal') });
const tagInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().default(STATUS_COLORS[2]) });

export const projectRoutes = new Hono<Env>()
  .get('/', (c) => {
    const { db } = c.var.deps;
    const rows = db
      .select({
        id: s.projects.id,
        name: s.projects.name,
        description: s.projects.description,
        sourceLanguage: s.projects.sourceLanguage,
        targetLanguage: s.projects.targetLanguage,
        updatedAt: s.projects.updatedAt,
        units: sql<number>`(select count(*) from units u where u.project_id = "projects"."id")`,
      })
      .from(s.projects)
      .orderBy(desc(s.projects.updatedAt))
      .all();
    return c.json(rows);
  })
  .post('/validate', validate('json', z.unknown()), (c) => {
    const result = importFileSchema.safeParse(c.req.valid('json'));
    if (!result.success)
      return c.json({ ok: false as const, issues: result.error.issues.slice(0, 50).map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
    const file = result.data;
    return c.json({
      ok: true as const,
      summary: {
        name: file.project.name,
        groups: file.groups.length,
        units: file.units.length,
        graphNodes: file.graph?.nodes.length ?? 0,
        graphEdges: file.graph?.edges.length ?? 0,
        characters: file.characters.length,
        documents: file.documents.length,
        terms: file.terms.length,
      },
    });
  })
  .post('/', validate('json', importFileSchema), (c) => {
    const { db } = c.var.deps;
    const firstProfile = db.select({ id: s.profiles.id }).from(s.profiles).orderBy(asc(s.profiles.name)).limit(1).get();
    const summary = importProject(db, c.req.valid('json'), firstProfile?.id);
    void computeLayouts(db, summary.projectId);
    events.changed(undefined, 'projects');
    return c.json(summary, 201);
  })
  .get('/:projectId', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const project = found(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
    const byStatus = db
      .select({ statusId: s.units.statusId, count: count() })
      .from(s.units)
      .where(eq(s.units.projectId, projectId))
      .groupBy(s.units.statusId)
      .all();
    const groupCount = db.select({ count: count() }).from(s.groups).where(eq(s.groups.projectId, projectId)).get()!.count;
    const waiting = db
      .select({ count: count() })
      .from(s.runItems)
      .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
      .where(and(eq(s.runs.projectId, projectId), eq(s.runItems.state, 'waiting')))
      .get()!.count;
    return c.json({ ...project, byStatus, groupCount, waiting });
  })
  .patch('/:projectId', validate('json', z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    found(db.update(s.projects).set(c.req.valid('json')).where(eq(s.projects.id, projectId)).returning().get(), '프로젝트');
    events.changed(projectId, 'projects');
    return c.json({ ok: true });
  })
  .delete('/:projectId', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const active = db.select({ id: s.runs.id }).from(s.runs).where(and(eq(s.runs.projectId, projectId), eq(s.runs.status, 'running'))).all();
    for (const run of active) c.var.deps.runner.cancel(run.id);
    db.delete(s.projects).where(eq(s.projects.id, projectId)).run();
    forgetProjectContext(projectId);
    events.changed(undefined, 'projects');
    return c.json({ ok: true });
  })
  /** Translation results in the standard format's key space, ready for a game-side re-importer. */
  .get('/:projectId/export', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const project = found(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
    const rows = db
      .select({ key: s.units.key, source: s.units.source, translation: s.units.translation, status: s.statuses.name })
      .from(s.units)
      .innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
      .where(eq(s.units.projectId, projectId))
      .orderBy(asc(s.units.groupId), asc(s.units.sort))
      .all();
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(project.name)}-translations.json"`);
    return c.json({ format: 'translation-workbench/translations-v1', project: project.name, targetLanguage: project.targetLanguage, units: rows });
  })

  // ── statuses & tags ────────────────────────────────────────────────
  .get('/:projectId/statuses', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const statuses = db
      .select({
        id: s.statuses.id,
        name: s.statuses.name,
        color: s.statuses.color,
        kind: s.statuses.kind,
        sort: s.statuses.sort,
        units: sql<number>`(select count(*) from units u where u.status_id = "statuses"."id")`,
      })
      .from(s.statuses)
      .where(eq(s.statuses.projectId, projectId))
      .orderBy(asc(s.statuses.sort))
      .all();
    const tags = db
      .select({
        id: s.tags.id,
        name: s.tags.name,
        color: s.tags.color,
        units: sql<number>`(select count(*) from unit_tags ut where ut.tag_id = "tags"."id")`,
      })
      .from(s.tags)
      .where(eq(s.tags.projectId, projectId))
      .orderBy(asc(s.tags.name))
      .all();
    return c.json({ statuses, tags });
  })
  .post('/:projectId/statuses', validate('json', statusInput), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const sort = db.select({ max: sql<number>`coalesce(max(${s.statuses.sort}), -1)` }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!.max + 1;
    const row = db.insert(s.statuses).values({ ...c.req.valid('json'), projectId, sort }).returning().get();
    events.changed(projectId, 'statuses');
    return c.json(row, 201);
  })
  .patch('/:projectId/statuses/:id', validate('json', statusInput.partial()), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    found(db.update(s.statuses).set(c.req.valid('json')).where(and(eq(s.statuses.id, c.req.param('id')), eq(s.statuses.projectId, projectId))).returning().get(), '상태');
    events.changed(projectId, 'statuses', 'units');
    return c.json({ ok: true });
  })
  .put('/:projectId/statuses/order', validate('json', z.object({ ids: z.array(z.string()) })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    db.transaction((tx) => {
      c.req.valid('json').ids.forEach((id, sort) => tx.update(s.statuses).set({ sort }).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).run());
    });
    events.changed(projectId, 'statuses');
    return c.json({ ok: true });
  })
  /** Lines in a deleted status move to `moveTo`; workflows that still reference it fail validation. */
  .delete('/:projectId/statuses/:id', validate('json', z.object({ moveTo: z.string() })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const id = c.req.param('id');
    const { moveTo } = c.req.valid('json');
    if (moveTo === id) badRequest('삭제할 상태로는 옮길 수 없습니다.');
    found(db.select().from(s.statuses).where(and(eq(s.statuses.id, moveTo), eq(s.statuses.projectId, projectId))).get(), '옮길 상태');
    db.transaction((tx) => {
      tx.update(s.units).set({ statusId: moveTo }).where(eq(s.units.statusId, id)).run();
      tx.delete(s.statuses).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).run();
    });
    events.changed(projectId, 'statuses', 'units', 'workflows');
    return c.json({ ok: true });
  })
  .post('/:projectId/tags', validate('json', tagInput), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const row = db.insert(s.tags).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'statuses');
    return c.json(row, 201);
  })
  .patch('/:projectId/tags/:id', validate('json', tagInput.partial()), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    found(db.update(s.tags).set(c.req.valid('json')).where(and(eq(s.tags.id, c.req.param('id')), eq(s.tags.projectId, projectId))).returning().get(), '태그');
    events.changed(projectId, 'statuses', 'units');
    return c.json({ ok: true });
  })
  .delete('/:projectId/tags/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    db.delete(s.tags).where(and(eq(s.tags.id, c.req.param('id')), eq(s.tags.projectId, projectId))).run();
    events.changed(projectId, 'statuses', 'units', 'workflows');
    return c.json({ ok: true });
  });
