import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { APP_COLLECTIONS, APP_DEFAULT_SECTIONS, APP_FEED, HELD_READ_MAX, appDefaultsPatchSchema } from '@loca/shared';
import { found, validate, type Env } from '../http.ts';
import * as s from '../db/schema.ts';
import { feedSnapshot, heldRows } from '../feed.ts';
import { pullDefaults, pushDefaults, writeAppDefaults } from '../domain/app-defaults.ts';

const sections = z.array(z.enum(APP_DEFAULT_SECTIONS)).min(1);

/** 홈 설정: the defaults a new project is made from, and a project's 가져오기 / 홈 기본값으로 저장. */
export const appSettingsRoutes = new Hono<Env>()
  /** The app's collections (the projects list, the home defaults, the home connections) as the browser loads them first. */
  .get('/app/sync/:collection', validate('param', z.object({ collection: z.enum(APP_COLLECTIONS) })), (c) => c.json(feedSnapshot(c.var.deps.db, c.var.deps, APP_FEED, c.req.valid('param').collection)))
  /** Model requests outside any project (model tests) by id, with the feed's count when read: the one collection the app's scope holds in part. */
  .post('/app/sync/aiCalls', validate('json', z.object({ ids: z.array(z.string()).max(HELD_READ_MAX) })), (c) => c.json(heldRows(c.var.deps.db, c.var.deps, APP_FEED, 'aiCalls', c.req.valid('json').ids)))
  // Each section sent replaces the stored one whole.
  .patch('/app/defaults', validate('json', appDefaultsPatchSchema), (c) => c.json(writeAppDefaults(c.var.deps.db, c.req.valid('json'))))
  .post('/projects/:projectId/defaults/pull', validate('json', z.object({ sections })), (c) => {
    const { db, secrets } = c.var.deps;
    const projectId = found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, c.req.param('projectId'))).get(), '프로젝트').id;
    return c.json(pullDefaults(db, projectId, c.req.valid('json').sections, secrets));
  })
  .post('/projects/:projectId/defaults/push', validate('json', z.object({ sections, workflowIds: z.array(z.string()).default([]) })), (c) => {
    const { db, secrets } = c.var.deps;
    const projectId = found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, c.req.param('projectId'))).get(), '프로젝트').id;
    const body = c.req.valid('json');
    return c.json(pushDefaults(db, projectId, body.sections, body.workflowIds, secrets));
  });
