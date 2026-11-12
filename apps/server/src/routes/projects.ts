import { deleteChat } from '../services/chat-delete.ts';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { ACTIVE_RUN_STATUSES } from '../engine/run-create.ts';
import { z } from 'zod';
import { agentSettingsSchema, detectFormatRules, importFileSchema, importWarnings, patchOf, summarizeImport } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { forgetProjectContext } from '../services/context.ts';
import { createStatus, createTag, deleteStatuses, deleteTags, orderStatuses, orderTags, TaxonomyMutationError, updateStatus, updateTag } from '../services/project-taxonomy.ts';
import { projectSettingsInput, updateProjectSettings } from '../services/project-settings.ts';
import { importProject } from '../services/importer.ts';
import { cancelLayout, computeLayouts } from '../services/layout.ts';
import { REGEX_TARGETS, generateRegex } from '../services/regex-assist.ts';
import { editorCallsToday } from '../services/editor-complete.ts';
import { statusInput, tagInput } from '../schemas/projects.ts';

export const projectRoutes = new Hono<Env>()
  .post('/validate', validate('json', z.unknown()), (c) => {
    const result = importFileSchema.safeParse(c.req.valid('json'));
    if (!result.success)
      return c.json({ ok: false as const, issues: result.error.issues.slice(0, 50).map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
    return c.json({ ok: true as const, summary: summarizeImport(result.data), warnings: importWarnings(result.data) });
  })
  .post('/', validate('json', importFileSchema), (c) => {
    const { db } = c.var.deps;
    const summary = importProject(db, c.req.valid('json'), undefined, c.var.deps.secrets);
    void computeLayouts(db, summary.projectId);
    return c.json(summary, 201);
  })
  /** How many 에디터 AI completions the project made today (its daily cap counts them; ai_calls, calls topic). */
  .get('/:projectId/editor-calls', (c) => c.json({ today: editorCallsToday(c.var.deps.db, c.req.param('projectId')) }))
  .get('/:projectId/detect-format-rules', (c) => {
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
  .delete('/:projectId', async (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const active = db.select({ id: s.runs.id }).from(s.runs).where(and(eq(s.runs.projectId, projectId), inArray(s.runs.status, ACTIVE_RUN_STATUSES))).all();
    for (const run of active) c.var.deps.runner.cancel(run.id);
    for (const chat of db.select({ id: s.chatSessions.id }).from(s.chatSessions).where(eq(s.chatSessions.projectId, projectId)).all()) await deleteChat(db, chat.id);
    cancelLayout(projectId);
    db.delete(s.projects).where(eq(s.projects.id, projectId)).run();
    forgetProjectContext(projectId);
    return c.json({ ok: true });
  })

  // ── statuses & tags ────────────────────────────────────────────────
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
  .put('/:projectId/statuses/order', validate('json', z.object({ ids: z.array(z.string()) })), (c) => c.json(orderStatuses(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids)))
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
