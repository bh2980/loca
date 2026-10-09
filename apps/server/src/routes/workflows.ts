import { Hono } from 'hono';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { knowledgeTemplate, listenerTemplate, speechFixTemplate, termExtractionTemplate, translationTemplate, validateWorkflow, workflowDefinitionSchema, type WorkflowDefinition } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { lineView } from '../engine/functions/index.ts';
import { runScript } from '../engine/functions/sandbox.ts';
import { createRun, selectRunUnits } from '../engine/runner.ts';
import { snapshotProfiles } from '../services/routes.ts';

const scopeSchema = z.object({ groupIds: z.array(z.string()).optional(), unitIds: z.array(z.string()).optional(), tagIds: z.array(z.string()).optional(), ignoreStatus: z.boolean().optional() });

export function workflowIssues(db: Db, projectId: string, definition: WorkflowDefinition) {
  const ids = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));
  return validateWorkflow(definition, {
    profileIds: ids(db.select({ id: s.profiles.id }).from(s.profiles).all()),
    statusIds: ids(db.select({ id: s.statuses.id }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all()),
    tagIds: ids(db.select({ id: s.tags.id }).from(s.tags).where(eq(s.tags.projectId, projectId)).all()),
    toolConnectionIds: ids(db.select({ id: s.connections.id }).from(s.connections).where(eq(s.connections.kind, 'http')).all()),
  });
}

function blankWorkflow(db: Db, projectId: string): WorkflowDefinition {
  const initial = db.select({ id: s.statuses.id }).from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'initial'))).get();
  return workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: initial ? [initial.id] : [] } },
      { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
    ],
    edges: [{ id: 'e1', source: 'entry', sourceHandle: 'out', target: 'end' }],
  });
}

/** Single-purpose templates that only need a model profile. */
const TEMPLATES = { terms: termExtractionTemplate, listener: listenerTemplate, knowledge: knowledgeTemplate, speechFix: speechFixTemplate };

function templateWorkflow(db: Db, projectId: string): WorkflowDefinition {
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all();
  const initial = statuses.find((status) => status.kind === 'initial') ?? statuses[0];
  const final = statuses.find((status) => status.kind === 'final') ?? statuses.at(-1)!;
  const middle = statuses.filter((status) => status.kind === 'normal');
  const profile = db.select({ id: s.profiles.id }).from(s.profiles).orderBy(asc(s.profiles.name)).get();
  return translationTemplate({
    profileId: profile?.id ?? '',
    untranslated: initial.id,
    draft: middle[0]?.id ?? initial.id,
    needsReview: statuses.find((status) => status.inReview)?.id ?? middle[1]?.id ?? middle[0]?.id ?? initial.id,
    confirmed: final.id,
  });
}

export const workflowRoutes = new Hono<Env>()
  .get('/projects/:projectId/workflows', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const rows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).orderBy(asc(s.workflows.name)).all();
    return c.json(
      rows.map(({ definition, ...row }) => ({
        ...row,
        nodeCount: definition.nodes.length,
        errorCount: workflowIssues(db, projectId, definition).filter((issue) => issue.level === 'error').length,
      })),
    );
  })
  .post('/projects/:projectId/workflows', validate('json', z.object({ name: z.string().trim().min(1), from: z.enum(['template', 'blank', 'terms', 'listener', 'knowledge', 'speechFix']).default('template') })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { name, from } = c.req.valid('json');
    const profile = db.select({ id: s.profiles.id }).from(s.profiles).orderBy(asc(s.profiles.name)).get();
    const definition = from === 'template' ? templateWorkflow(db, projectId) : from === 'blank' ? blankWorkflow(db, projectId) : TEMPLATES[from]({ profileId: profile?.id ?? '' });
    const row = db.insert(s.workflows).values({ projectId, name, definition }).returning().get();
    events.changed(projectId, 'workflows');
    return c.json(row, 201);
  })
  .get('/workflows/:id', (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json({ ...workflow, issues: workflowIssues(db, workflow.projectId, workflow.definition) });
  })
  .put('/workflows/:id', validate('json', z.object({ name: z.string().trim().min(1), description: z.string().default(''), definition: workflowDefinitionSchema, version: z.number().int() })), (c) => {
    const { db } = c.var.deps;
    const body = c.req.valid('json');
    const current = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    if (current.version !== body.version) badRequest(`다른 곳에서 먼저 저장했습니다 (v${current.version}). 새로고침 후 다시 저장하세요.`);
    const row = db
      .update(s.workflows)
      .set({ name: body.name, description: body.description, definition: body.definition, version: current.version + 1 })
      .where(eq(s.workflows.id, current.id))
      .returning()
      .get();
    events.changed(current.projectId, 'workflows');
    return c.json({ ...row, issues: workflowIssues(db, current.projectId, row.definition) });
  })
  .post('/workflows/:id/validate', validate('json', z.object({ definition: workflowDefinitionSchema })), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json(workflowIssues(db, workflow.projectId, c.req.valid('json').definition));
  })
  .delete('/workflows/:id', (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    db.delete(s.workflows).where(eq(s.workflows.id, workflow.id)).run();
    events.changed(workflow.projectId, 'workflows');
    return c.json({ ok: true });
  })
  .post('/workflows/:id/preview', validate('json', scopeSchema), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json({ count: selectRunUnits(db, workflow.projectId, workflow.definition, c.req.valid('json')).length });
  })
  .post('/workflows/:id/runs', validate('json', scopeSchema), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const errors = workflowIssues(db, workflow.projectId, workflow.definition).filter((issue) => issue.level === 'error');
    if (errors.length) badRequest(`워크플로에 오류가 ${errors.length}개 있습니다: ${errors[0].message}`);
    const profileIds = [...new Set(workflow.definition.nodes.flatMap((node) => (node.type === 'ai' ? [node.config.profileId] : [])))];
    try {
      return c.json(createRun(db, { projectId: workflow.projectId, workflow, profiles: snapshotProfiles(db, profileIds), scope: c.req.valid('json') }), 201);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }
  })

  /** Try a script node on one real line. Read-only: nothing is stored. */
  .post('/projects/:projectId/script-test', validate('json', z.object({ code: z.string(), ports: z.array(z.string()).min(1), unitId: z.string().optional() })), async (c) => {
    const { db } = c.var.deps;
    const { code, ports, unitId } = c.req.valid('json');
    const unit = unitId
      ? db.select().from(s.units).where(and(eq(s.units.id, unitId), eq(s.units.projectId, c.req.param('projectId')))).get()
      : db.select().from(s.units).where(eq(s.units.projectId, c.req.param('projectId'))).orderBy(asc(s.units.sort)).limit(1).get();
    if (!unit) return badRequest('시험할 대사가 없습니다.');
    const input = lineView({ unit, item: { data: { path: [], outputs: {} }, visits: {} } as never, tagIds: [], projectId: unit.projectId, runId: 'test' });
    const started = Date.now();
    try {
      const result = await runScript(code, input);
      const port = result.port ?? ports[0];
      return c.json({ ok: true as const, input, result, port, validPort: ports.includes(port), ms: Date.now() - started });
    } catch (error) {
      return c.json({ ok: false as const, input, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started });
    }
  })

  // ── runs ───────────────────────────────────────────────────────────
  .get('/projects/:projectId/runs', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const runs = db
      .select({ id: s.runs.id, workflowId: s.runs.workflowId, workflowName: s.runs.workflowName, workflowVersion: s.runs.workflowVersion, status: s.runs.status, total: s.runs.total, createdAt: s.runs.createdAt, finishedAt: s.runs.finishedAt })
      .from(s.runs)
      .where(eq(s.runs.projectId, projectId))
      .orderBy(desc(s.runs.createdAt))
      .limit(200)
      .all();
    const counts = runs.length
      ? db
          .select({ runId: s.runItems.runId, state: s.runItems.state, count: count() })
          .from(s.runItems)
          .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
          .where(eq(s.runs.projectId, projectId))
          .groupBy(s.runItems.runId, s.runItems.state)
          .all()
      : [];
    const byRun = Map.groupBy(counts, (row) => row.runId);
    return c.json(runs.map((run) => ({ ...run, states: Object.fromEntries((byRun.get(run.id) ?? []).map((row) => [row.state, row.count])) })));
  })
  .get('/runs/:id', (c) => {
    const { db } = c.var.deps;
    const run = found(db.select().from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const nodes = db
      .select({ nodeId: s.runItems.nodeId, state: s.runItems.state, count: count() })
      .from(s.runItems)
      .where(eq(s.runItems.runId, run.id))
      .groupBy(s.runItems.nodeId, s.runItems.state)
      .all();
    const usage = db
      .select({ steps: count(), failed: sql<number>`sum(case when ${s.runSteps.ok} then 0 else 1 end)`, inputTokens: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${s.runSteps.outputTokens}), 0)` })
      .from(s.runSteps)
      .where(eq(s.runSteps.runId, run.id))
      .get();
    const { profiles, ...rest } = run;
    return c.json({ ...rest, profiles: Object.values(profiles).map((profile) => ({ id: profile.id, name: profile.name, models: profile.routes.map((route) => route.model) })), nodes, usage });
  })
  .get('/runs/:id/items', validate('query', z.object({ state: z.string().optional(), nodeId: z.string().optional(), offset: z.coerce.number().default(0), limit: z.coerce.number().max(500).default(100) })), (c) => {
    const { db } = c.var.deps;
    const { state, nodeId, offset, limit } = c.req.valid('query');
    const conditions = [eq(s.runItems.runId, c.req.param('id'))];
    if (state) conditions.push(eq(s.runItems.state, state as s.ItemState));
    if (nodeId) conditions.push(eq(s.runItems.nodeId, nodeId));
    const where = and(...conditions);
    const total = db.select({ count: count() }).from(s.runItems).where(where).get()!.count;
    const rows = db
      .select({ id: s.runItems.id, unitId: s.runItems.unitId, key: s.units.key, speaker: s.units.speaker, source: s.units.source, nodeId: s.runItems.nodeId, state: s.runItems.state, visits: s.runItems.visits, data: s.runItems.data, error: s.runItems.error, updatedAt: s.runItems.updatedAt })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.unitId))
      .where(where)
      .orderBy(asc(s.units.groupId), asc(s.units.sort))
      .limit(limit)
      .offset(offset)
      .all();
    return c.json({ total, rows });
  })
  .get('/runs/:id/steps', (c) => {
    const { db } = c.var.deps;
    return c.json(db.select().from(s.runSteps).where(eq(s.runSteps.runId, c.req.param('id'))).orderBy(desc(s.runSteps.startedAt)).limit(200).all());
  })
  .post('/runs/:id/:action{pause|resume|cancel}', (c) => {
    const { runner } = c.var.deps;
    const id = c.req.param('id');
    const action = c.req.param('action') as 'pause' | 'resume' | 'cancel';
    runner[action](id);
    return c.json({ ok: true });
  });
