import { Hono } from 'hono';
import { and, asc, count, desc, eq, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { agentSettingsSchema, aiConfirmSchema, detectFormatRules, editorAiSchema, formatRulesSchema, importFileSchema, importWarnings, markColorsSchema, patchOf, summarizeImport } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { forgetProjectContext } from '../services/context.ts';
import { markConditions } from '../services/line-marks.ts';
import { createStatus, createTag, deleteStatuses, deleteTags, orderTags, projectTags, TaxonomyMutationError, updateStatus, updateTag } from '../services/project-taxonomy.ts';
import { projectSettingsInput, updateProjectSettings } from '../services/project-settings.ts';
import { importProject } from '../services/importer.ts';
import type { DecidedTable } from '../services/status-by.ts';
import { defaultModelChoice } from '../services/routes.ts';
import { cancelLayout, computeLayouts } from '../services/layout.ts';
import { REGEX_TARGETS, generateRegex } from '../services/regex-assist.ts';
import { editorCallsToday } from '../services/editor-complete.ts';
import { statusInput, tagInput } from '../schemas/projects.ts';

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
    return c.json({ ok: true as const, summary: summarizeImport(result.data), warnings: importWarnings(result.data) });
  })
  .post('/', validate('json', importFileSchema), (c) => {
    const { db } = c.var.deps;
    const summary = importProject(db, c.req.valid('json'), defaultModelChoice(db));
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
    // Lines in review-inbox statuses.
    const reviewCount = db
      .select({ count: count() })
      .from(s.units)
      .innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
      .where(and(eq(s.units.projectId, projectId), eq(s.statuses.inReview, true)))
      .get()!.count;
    // What AI decided and no person has looked at (✦): the #AI가 정함 mark of lines, knowledge and terms (shared aiDecided / markConditions), so each count is what its link lists.
    const aiLines = db.select({ count: count() }).from(s.units).where(and(eq(s.units.projectId, projectId), ...markConditions(projectId, ['ai']))).get()!.count;
    const aiConfirmed = (...tables: DecidedTable[]) =>
      tables.reduce((sum, table) => {
        const t = table as typeof s.terms;
        return sum + db.select({ count: count() }).from(t).where(and(eq(t.projectId, projectId), eq(t.statusBy, 'ai'), notInArray(t.status, ['candidate', 'rejected']))).get()!.count;
      }, 0);
    // Knowledge by the tab that lists it (자료 › 문서 / 인물 / 관계·말투 / 사건; the pairs table lists the pairs holding these items), so a count opens the tab it counts.
    const aiDecided = {
      lines: aiLines,
      terms: aiConfirmed(s.terms),
      knowledge: { documents: aiConfirmed(s.documents), characters: aiConfirmed(s.characters), pairs: aiConfirmed(s.relationships, s.speechRules), events: aiConfirmed(s.storyEvents) },
    };
    return c.json({ ...project, aiConfirm: aiConfirmSchema.parse(project.aiConfirm), editorAi: editorAiSchema.parse(project.editorAi), editorCallsToday: editorCallsToday(db, projectId), byStatus, groupCount, reviewCount, aiDecided });
  })
  .get('/:projectId/detect-format-rules', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
    const rows = db.select({ source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).all();
    return c.json(detectFormatRules(rows.map((r) => r.source)));
  })
  .get('/projects/:projectId/detect-format-rules', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
    const rows = db.select({ source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).all();
    return c.json(detectFormatRules(rows.map((r) => r.source)));
  })
  .patch('/:projectId', validate('json', projectSettingsInput.extend({ agentSettings: agentSettingsSchema.optional() })), (c) => {
    found(updateProjectSettings(c.var.deps.db, c.req.param('projectId'), c.req.valid('json')) ?? undefined, '프로젝트');
    return c.json({ ok: true });
  })
  .delete('/:projectId', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const active = db.select({ id: s.runs.id }).from(s.runs).where(and(eq(s.runs.projectId, projectId), eq(s.runs.status, 'running'))).all();
    for (const run of active) c.var.deps.runner.cancel(run.id);
    cancelLayout(projectId);
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
      .orderBy(asc(s.units.seq))
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
        inReview: s.statuses.inReview,
        units: sql<number>`(select count(*) from units u where u.status_id = "statuses"."id")`,
      })
      .from(s.statuses)
      .where(eq(s.statuses.projectId, projectId))
      .orderBy(asc(s.statuses.sort))
      .all();
    return c.json({ statuses, tags: projectTags(db, projectId) });
  })
  .post('/:projectId/statuses', validate('json', statusInput), (c) => {
    const projectId = c.req.param('projectId');
    const row = createStatus(c.var.deps.db, projectId, c.req.valid('json'));
    return c.json(row, 201);
  })
  .patch('/:projectId/statuses/:id', validate('json', patchOf(statusInput)), (c) => {
    try {
      updateStatus(c.var.deps.db, c.req.param('projectId'), c.req.param('id'), c.req.valid('json'));
    } catch (error) {
      if (error instanceof TaxonomyMutationError && error.status === 404) found(undefined, '상태');
      if (error instanceof TaxonomyMutationError) badRequest(error.message);
      throw error;
    }
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
  /** Lines in the deleted statuses move to `moveTo`; workflows that still reference them fail validation. */
  .post('/:projectId/statuses/delete', validate('json', z.object({ ids: z.array(z.string()).min(1), moveTo: z.string() })), (c) => {
    const { ids, moveTo } = c.req.valid('json');
    try {
      return c.json(deleteStatuses(c.var.deps.db, c.req.param('projectId'), ids, moveTo));
    } catch (error) {
      if (error instanceof TaxonomyMutationError && error.status === 404) found(undefined, error.message.includes('옮길') ? '옮길 상태' : '상태');
      if (error instanceof TaxonomyMutationError) badRequest(error.message);
      throw error;
    }
  })
  .post('/:projectId/tags', validate('json', tagInput), (c) => {
    const projectId = c.req.param('projectId');
    const row = createTag(c.var.deps.db, projectId, c.req.valid('json'));
    return c.json(row, 201);
  })
  .patch('/:projectId/tags/:id', validate('json', patchOf(tagInput)), (c) => {
    try {
      updateTag(c.var.deps.db, c.req.param('projectId'), c.req.param('id'), c.req.valid('json'));
    } catch (error) {
      if (error instanceof TaxonomyMutationError && error.status === 404) found(undefined, '태그');
      if (error instanceof TaxonomyMutationError) badRequest(error.message);
      throw error;
    }
    return c.json({ ok: true });
  })
  .put('/:projectId/tags/order', validate('json', z.object({ ids: z.array(z.string()) })), (c) => c.json(orderTags(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids)))
  .post('/:projectId/tags/delete', validate('json', z.object({ ids: z.array(z.string()).min(1) })), (c) => {
    try {
      return c.json(deleteTags(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids));
    } catch (error) {
      if (error instanceof TaxonomyMutationError && error.status === 404) found(undefined, '태그');
      if (error instanceof TaxonomyMutationError) badRequest(error.message);
      throw error;
    }
  })
  /** 자연어로 정규식 만들기: one format rule from a description, checked with the settings' own pattern rule. Nothing is saved. */
  .post('/:projectId/generate-regex', validate('json', z.object({ prompt: z.string().trim().min(1).max(500), target: z.enum(REGEX_TARGETS) })), async (c) => {
    const { db, secrets } = c.var.deps;
    const projectId = c.req.param('projectId');
    found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
    return c.json(await generateRegex(db, secrets, projectId, c.req.valid('json'), c.req.raw.signal));
  });
