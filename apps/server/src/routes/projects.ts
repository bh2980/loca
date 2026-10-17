import { Hono } from 'hono';
import { and, asc, count, desc, eq, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { agentSettingsSchema, aiConfirmSchema, editorAiSchema, formatRulesSchema, importFileSchema, importWarnings, markColorsSchema, patchOf, TAG_SCOPES, TAG_SCOPE_LABELS, DEFAULT_TAG_COLOR, HEX_COLOR, STATUS_COLORS, summarizeImport } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { forgetProjectContext } from '../services/context.ts';
import { markConditions } from '../services/line-marks.ts';
import { projectTags, tagUseIn } from '../services/tag-scope.ts';
import { deleteItems } from '../services/item-delete.ts';
import { projectSettingsInput, updateProjectSettings } from '../services/project-settings.ts';
import { importProject } from '../services/importer.ts';
import type { DecidedTable } from '../services/status-by.ts';
import { defaultModelChoice } from '../services/routes.ts';
import { cancelLayout, computeLayouts } from '../services/layout.ts';
import { editorCallsToday } from '../services/editor-complete.ts';

export const statusInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(HEX_COLOR).default(STATUS_COLORS[0]), kind: z.enum(['initial', 'normal', 'final']).default('normal'), inReview: z.boolean().default(false), humanOnly: z.boolean().default(false) });
export const tagInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(HEX_COLOR).default(DEFAULT_TAG_COLOR),
  /** Where the tag can be put; at least one place. */
  scope: z.array(z.enum(TAG_SCOPES)).min(1).refine((scope) => new Set(scope).size === scope.length, '같은 곳이 두 번 나옵니다.').default([...TAG_SCOPES]),
});

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
        humanOnly: s.statuses.humanOnly,
        units: sql<number>`(select count(*) from units u where u.status_id = "statuses"."id")`,
      })
      .from(s.statuses)
      .where(eq(s.statuses.projectId, projectId))
      .orderBy(asc(s.statuses.sort))
      .all();
    return c.json({ statuses, tags: projectTags(db, projectId) });
  })
  .post('/:projectId/statuses', validate('json', statusInput), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const sort = db.select({ max: sql<number>`coalesce(max(${s.statuses.sort}), -1)` }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!.max + 1;
    const row = db.insert(s.statuses).values({ ...c.req.valid('json'), projectId, sort }).returning().get();
    events.changed(projectId, 'statuses');
    return c.json(row, 201);
  })
  .patch('/:projectId/statuses/:id', validate('json', patchOf(statusInput)), (c) => {
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
      tx.update(s.units).set({ statusId: moveTo }).where(and(eq(s.units.projectId, projectId), eq(s.units.statusId, id))).run();
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
  .patch('/:projectId/tags/:id', validate('json', patchOf(tagInput)), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const tag = found(db.select({ role: s.tags.role }).from(s.tags).where(and(eq(s.tags.id, c.req.param('id')), eq(s.tags.projectId, projectId))).get(), '태그');
    const body = c.req.valid('json');
    // The app's own tags (problem types, 확인 권장) keep their names and places: only the color changes.
    if (tag.role && body.name !== undefined) badRequest('앱이 쓰는 태그는 이름을 바꿀 수 없습니다. 색만 바꿀 수 있습니다.');
    if (tag.role && body.scope !== undefined) badRequest('앱이 쓰는 태그는 붙는 곳을 바꿀 수 없습니다.');
    // A place can't be taken away while the tag is still on something there.
    for (const place of body.scope ? TAG_SCOPES.filter((place) => !body.scope!.includes(place)) : []) {
      const used = tagUseIn(db, c.req.param('id'), place);
      if (used) badRequest(`‘${TAG_SCOPE_LABELS[place]}’에서 빼려면 먼저 이 태그가 붙은 ${TAG_SCOPE_LABELS[place]} ${used.toLocaleString('ko-KR')}개에서 떼어 주세요.`);
    }
    found(db.update(s.tags).set(c.req.valid('json')).where(and(eq(s.tags.id, c.req.param('id')), eq(s.tags.projectId, projectId))).returning().get(), '태그');
    events.changed(projectId, 'statuses', 'units');
    return c.json({ ok: true });
  })
  .delete('/:projectId/tags/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const tag = found(db.select({ role: s.tags.role }).from(s.tags).where(and(eq(s.tags.id, c.req.param('id')), eq(s.tags.projectId, projectId))).get(), '태그');
    if (tag.role) badRequest('앱이 쓰는 태그는 지울 수 없습니다.');
    deleteItems(db, projectId, 'tags', [c.req.param('id')]);
    return c.json({ ok: true });
  });
