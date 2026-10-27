import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { APP_DEFAULT_SECTIONS, appDefaultsPatchSchema } from '@tw/shared';
import { found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { pullDefaults, pushDefaults, readAppDefaults, writeAppDefaults } from '../services/app-defaults.ts';

const sections = z.array(z.enum(APP_DEFAULT_SECTIONS)).min(1);

/** 홈 설정: the defaults a new project is made from, and a project's 가져오기 / 홈 기본값으로 저장. */
export const appSettingsRoutes = new Hono<Env>()
  .get('/app/defaults', (c) => c.json(readAppDefaults(c.var.deps.db)))
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
