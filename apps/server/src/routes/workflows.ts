import { Hono } from 'hono';
import { startRun } from '../services/start-run.ts';
import { askedScope } from '../services/run-plan.ts';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { httpParams, workflowInput, scriptParams, workflowDefinitionSchema, type WorkflowDefinition, runCapsSchema, runModelsSchema, withRunModels, WORKFLOW_TEMPLATES, EMPTY_MODEL_CHOICE, runScopeInputSchema, type RunScopeInput, nodeCallsOut, nodeConcurrency } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { workflowIssues } from '../services/workflow-issues.ts';
import { callHttp, httpOutput, lineView, validateScriptData } from '../engine/functions/index.ts';
import { runScript } from '../engine/functions/sandbox.ts';
import { subjectOf } from '../engine/subjects.ts';
import { listBatches, preflight } from '../services/preflight.ts';
import { previewRequest } from '../services/request-preview.ts';
import { continuePreflight, continueRun } from '../services/run-continue.ts';
import { deleteWorkflow, duplicateWorkflow, freeWorkflowName, saveWorkflow, workflowCallers } from '../services/workflow-mutations.ts';
import { issueTagIds } from '../services/issue-tags.ts';
import { workflowRows } from '../services/workflow-rows.ts';
import { runItemIds, runNodeExits, runProgress } from '../services/run-detail.ts';
import { rowChangesOf } from '../db/row-changes.ts';
import { tokensSql } from '../db/tokens.ts';

/** A run's scope as asked (the line filter or the terms, by name or id) and, optionally, the models it uses instead of its nodes' own (by AI node id). */
const runSchema = runScopeInputSchema.extend({ models: runModelsSchema.optional() });
/** The scope a request asks for, resolved for this workflow; one that does not fit it or names what the project does not have is a 400. */
function scopeOf(db: Db, workflow: Pick<typeof s.workflows.$inferSelect, 'projectId' | 'definition'>, asked: RunScopeInput) {
  const resolved = askedScope(db, workflow.projectId, workflowInput(workflow.definition), asked);
  return resolved.ok ? resolved.scope : badRequest(resolved.error);
}
const runItemQuery = z.object({ state: z.string().optional(), nodeId: z.string().optional(), through: z.string().optional(), exit: z.string().optional(), offset: z.coerce.number().default(0), limit: z.coerce.number().max(500).default(100) });
/** How a run goes on (services/run-continue.ts): other models for some AI steps, its failed lines again, new caps. */
const continueSchema = z.object({ models: runModelsSchema.optional(), retryFailed: z.boolean().default(false), limits: runCapsSchema.optional() });
/** What POST /runs/:id/resume may carry: new caps (null removes one). */
export const resumeSchema = z.object({ limits: runCapsSchema.optional() });

function blankWorkflow(): WorkflowDefinition {
  return workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { input: 'lines' } },
    ],
    edges: [],
  });
}

const NEW_WORKFLOW_NAME = '새 워크플로';

const TEMPLATE_KEYS = WORKFLOW_TEMPLATES.map((template) => template.key) as [string, ...string[]];

/** A template's definition with this project's statuses (by kind and review flag, never by name), and failure tag. The model is left empty: validation asks the person to pick one. */
function templateDefinition(db: Db, projectId: string, key: string): { name: string; definition: WorkflowDefinition } {
  const template = WORKFLOW_TEMPLATES.find((entry) => entry.key === key) ?? badRequest('알 수 없는 템플릿입니다.');
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all();
  const normal = statuses.filter((status) => status.kind === 'normal');
  const definition = workflowDefinitionSchema.parse(
    template.build({
      model: EMPTY_MODEL_CHOICE,
      untranslated: statuses.find((status) => status.kind === 'initial')?.id,
      confirmed: statuses.find((status) => status.kind === 'final')?.id,
      needsReview: normal.find((status) => status.inReview)?.id,
      translated: normal.find((status) => !status.inReview)?.id,
      issueTags: issueTagIds(db, projectId),
    }),
  );
  return { name: template.name, definition };
}

/** How many of a run's model calls its page lists: the latest ones. */
const STEPS_LISTED = 200;

export const workflowRoutes = new Hono<Env>()
  .get('/projects/:projectId/workflows', (c) => c.json(workflowRows(c.var.deps.db, c.req.param('projectId'))))
  .post(
    '/projects/:projectId/workflows',
    validate('json', z.object({ name: z.string().trim().min(1).optional(), template: z.enum(TEMPLATE_KEYS).optional() })),
    (c) => {
      const { db } = c.var.deps;
      const projectId = c.req.param('projectId');
      const body = c.req.valid('json');
      const fromTemplate = body.template ? templateDefinition(db, projectId, body.template) : null;
      const name = body.name ?? freeWorkflowName(db, projectId, fromTemplate?.name ?? NEW_WORKFLOW_NAME);
      const definition = fromTemplate?.definition ?? blankWorkflow();
      const row = saveWorkflow(db, projectId, { name, description: '', definition });
      return c.json(row, 201);
    },
  )
  .get('/workflows/:id', (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    // calledBy: the workflows with a 워크플로 호출 node that picks this one (the editor header lists them).
    return c.json({ ...workflow, calledBy: workflowCallers(db, workflow.projectId, workflow.id), issues: workflowIssues(db, workflow.projectId, workflow.definition, workflow.id) });
  })
  .put('/workflows/:id', validate('json', z.object({ name: z.string().trim().min(1), description: z.string().default(''), definition: workflowDefinitionSchema, version: z.number().int() })), (c) => {
    const { db } = c.var.deps;
    const body = c.req.valid('json');
    const current = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const row = saveWorkflow(db, current.projectId, { id: current.id, ...body });
    return c.json({ ...row, calledBy: workflowCallers(db, current.projectId, current.id), issues: workflowIssues(db, current.projectId, row.definition, current.id) });
  })
  /** 복제: a copy with the same description and definition under a name of its own (services/workflow-mutations.ts). */
  .post('/workflows/:id/duplicate', validate('json', z.object({ name: z.string().trim().min(1).optional() })), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select({ id: s.workflows.id, projectId: s.workflows.projectId }).from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json(duplicateWorkflow(db, workflow.projectId, workflow.id, c.req.valid('json').name), 201);
  })
  .post('/workflows/:id/validate', validate('json', z.object({ definition: workflowDefinitionSchema })), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json(workflowIssues(db, workflow.projectId, c.req.valid('json').definition, workflow.id));
  })
  .delete('/workflows/:id', (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    deleteWorkflow(db, workflow.projectId, workflow.id);
    return c.json({ ok: true });
  })
  /** 보낼 내용: one request of a saved AI node for a sample item (no model call). */
  .get('/workflows/:id/nodes/:nodeId/request', validate('query', z.object({ sample: z.string().optional() })), (c) => {
    const workflow = found(c.var.deps.db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json(found(previewRequest(c.var.deps.db, workflow, c.req.param('nodeId'), c.req.valid('query').sample) ?? undefined, 'AI 노드'));
  })
  .post('/workflows/:id/preview', validate('json', runScopeInputSchema), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json({ count: subjectOf(workflowInput(workflow.definition)).select(db, workflow.projectId, scopeOf(db, workflow, c.req.valid('json'))).length });
  })
  /** The run plan and its cost estimate, computed without calling a model (see services/preflight.ts). */
  .post('/workflows/:id/preflight', validate('json', runSchema), async (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const { models, ...asked } = c.req.valid('json');
    const scope = scopeOf(db, workflow, asked);
    return c.json(await preflight(db, { ...workflow, definition: withRunModels(workflow.definition, models) }, scope));
  })
  /** Starts a run (services/start-run.ts): the caps are the suggested ones unless given (a number sets one, null runs without it). */
  .post('/workflows/:id/runs', validate('json', runSchema.extend({ limits: runCapsSchema.optional() })), async (c) => {
    const { limits, models, ...asked } = c.req.valid('json');
    const started = await startRun(c.var.deps.db, { workflowId: c.req.param('id'), scope: { asked }, models, limits });
    if (!started.ok) badRequest(started.error);
    return c.json({ runId: started.runId, total: started.total }, 201);
  })

  /** Try a script node on one real line. Read-only: nothing is stored. */
  .post('/projects/:projectId/script-test', validate('json', z.object({ code: z.string(), ports: z.array(z.string()).min(1), fields: scriptParams.shape.fields, unitId: z.string().optional() })), async (c) => {
    const { db } = c.var.deps;
    const { code, ports, fields, unitId } = c.req.valid('json');
    const unit = unitId
      ? db.select().from(s.units).where(and(eq(s.units.id, unitId), eq(s.units.projectId, c.req.param('projectId')))).get()
      : db.select().from(s.units).where(eq(s.units.projectId, c.req.param('projectId'))).orderBy(asc(s.units.seq)).limit(1).get();
    if (!unit) badRequest('시험할 대사가 없습니다.');
    const input = lineView({ subject: 'lines', unit, item: { data: { path: [], outputs: {} }, visits: {} } as never, tagIds: [], projectId: unit.projectId, runId: 'test' });
    const started = Date.now();
    try {
      const result = await runScript(code, input);
      const port = result.port ?? ports[0];
      // The data as the run would store it: held to the declared fields (a bad value is reported as the error).
      // `raw`: what the code returned, for "이 결과로 칸 채우기" before any field is declared.
      return c.json({ ok: true as const, input, result: { ...result, data: validateScriptData(result.data, fields) }, raw: result.data ?? null, port, validPort: ports.includes(port), ms: Date.now() - started });
    } catch (error) {
      return c.json({ ok: false as const, input, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started });
    }
  })

  /** One HTTP node call for the project's first line (the person asked for it): the response as it came, and the declared fields read from it. */
  .post('/projects/:projectId/http-test', validate('json', z.object({ params: httpParams })), async (c) => {
    const { db, secrets } = c.var.deps;
    const { params } = c.req.valid('json');
    const unit = db.select().from(s.units).where(eq(s.units.projectId, c.req.param('projectId'))).orderBy(asc(s.units.seq)).limit(1).get();
    if (!unit) badRequest('시험할 대사가 없습니다.');
    const input = lineView({ subject: 'lines', unit, item: { data: { path: [], outputs: {} }, visits: {} } as never, tagIds: [], projectId: unit.projectId, runId: 'test' });
    const started = Date.now();
    try {
      const raw = await callHttp(params, input, { db, secrets, signal: AbortSignal.timeout(params.timeoutSeconds * 1000) });
      return c.json({ ok: true as const, input, raw, result: httpOutput(params, raw), ms: Date.now() - started });
    } catch (error) {
      return c.json({ ok: false as const, input, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started });
    }
  })

  // ── runs ───────────────────────────────────────────────────────────
  /** Which of the project's model requests a list shows, newest first, as ids (calls topic: one is logged or finishes). */
  .get('/projects/:projectId/ai-calls/ids', validate('query', z.object({ kind: z.enum(s.AI_CALL_KINDS).optional(), ref: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) })), (c) => {
    const { db } = c.var.deps;
    const { kind, ref, limit } = c.req.valid('query');
    const where = and(eq(s.aiCalls.projectId, c.req.param('projectId')), kind ? eq(s.aiCalls.kind, kind) : undefined, ref ? eq(s.aiCalls.refId, ref) : undefined);
    return c.json({ ids: db.select({ id: s.aiCalls.id }).from(s.aiCalls).where(where).orderBy(desc(s.aiCalls.startedAt)).limit(limit).all().map((row) => row.id) });
  })
  /** What one model request sent (system prompt, then the prompt) and, for a failed one, what it printed before failing; each when kept. */
  .get('/projects/:projectId/ai-calls/:id/request', (c) => {
    const row = found(c.var.deps.db.select({ request: s.aiCalls.request, response: s.aiCalls.response }).from(s.aiCalls).where(and(eq(s.aiCalls.id, c.req.param('id')), eq(s.aiCalls.projectId, c.req.param('projectId')))).get(), 'AI 호출');
    return c.json({ request: row.request, response: row.response });
  })
  /** The batches this run was planned in (stored per line when it started), as the run dialog lists them. */
  .get('/runs/:id/plan', (c) => {
    const { db } = c.var.deps;
    const run = found(db.select({ id: s.runs.id }).from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const lines = db
      .selectDistinct({ plan: s.runItems.plan, groupId: s.units.groupId, speaker: s.units.speaker, seq: s.units.seq, tokens: tokensSql(s.units.source) })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.subjectId))
      .where(eq(s.runItems.runId, run.id))
      .all()
      .filter((line) => line.plan !== null)
      .sort((x, y) => x.seq - y.seq);
    const batches = [...Map.groupBy(lines, (line) => line.plan!).entries()].sort((x, y) => x[0] - y[0]).map(([, list]) => list);
    return c.json(listBatches(db, batches));
  })
  /** A run as it started (definition, models, limits) and how it is doing now (runProgress). */
  .get('/runs/:id', (c) => {
    const { db, runner } = c.var.deps;
    const run = found(db.select().from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const { models, ...rest } = run;
    // Requests a node can have at once: an AI node's 동시 처리 수, an HTTP or script node's own.
    const callLimits = Object.fromEntries(run.definition.nodes.filter(nodeCallsOut).map((node) => [node.id, nodeConcurrency(node)]));
    const { id: _id, ...progress } = runProgress(db, runner, run.projectId, [run.id])[0]!;
    // What each model choice resolved to when the run started.
    return c.json({ ...rest, ...progress, models: Object.values(models).map((model) => ({ label: model.label, connectionId: model.target.connectionId, name: model.target.name, model: model.target.model })), callLimits });
  })
  /** One page of a run's items as ids: the run page reads the items from the browser's run items collection. */
  .get('/runs/:id/items/ids', validate('query', runItemQuery), (c) => c.json(runItemIds(c.var.deps.db, c.req.param('id'), c.req.valid('query'))))
  /** What a node did with its items: the run graph's node pane. */
  .get('/runs/:id/node-exits', validate('query', z.object({ nodeId: z.string() })), (c) => c.json(runNodeExits(c.var.deps.db, c.req.param('id'), c.req.valid('query').nodeId)))
  /** How runs are doing now, by id, with the feed's count when read (the browser's run progress collection). */
  .post('/projects/:projectId/run-progress', validate('json', z.object({ ids: z.array(z.string()).max(50) })), (c) => {
    const seq = rowChangesOf(c.var.deps.db.$client).seq;
    return c.json({ rows: runProgress(c.var.deps.db, c.var.deps.runner, c.req.param('projectId'), c.req.valid('json').ids), seq });
  })
  /** The run's latest model calls as ids, newest first (the run page's AI 호출 tab: the rows themselves never change). */
  .get('/runs/:id/steps/ids', (c) => {
    const { db } = c.var.deps;
    return c.json({ ids: db.select({ id: s.runSteps.id }).from(s.runSteps).where(eq(s.runSteps.runId, c.req.param('id'))).orderBy(desc(s.runSteps.startedAt)).limit(STEPS_LISTED).all().map((row) => row.id) });
  })
  /** Model calls of the project's runs by id, with the feed's count when read (the browser's run steps collection). */
  .post('/projects/:projectId/run-steps', validate('json', z.object({ ids: z.array(z.string()).max(500) })), (c) => {
    const { db } = c.var.deps;
    const seq = rowChangesOf(db.$client).seq;
    const runs = db.select({ id: s.runs.id }).from(s.runs).where(eq(s.runs.projectId, c.req.param('projectId')));
    return c.json({ rows: db.select().from(s.runSteps).where(and(inList(s.runSteps.id, c.req.valid('json').ids), inArray(s.runSteps.runId, runs))).all(), seq });
  })
  /** The estimate for continuing a paused or finished run on other models (#41). */
  .post('/runs/:id/continue/preflight', validate('json', continueSchema), async (c) => {
    const { db } = c.var.deps;
    const run = found(db.select().from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const { models, retryFailed } = c.req.valid('json');
    const result = await continuePreflight(db, run, models, retryFailed);
    if (!result.ok) badRequest(result.error);
    return c.json({ workflowId: result.workflowId, lines: result.lines, plan: result.plan });
  })
  /** Continue a paused or finished run, on other models for some AI steps and/or with its failed lines again, with new caps if given. */
  .post('/runs/:id/continue', validate('json', continueSchema), (c) => {
    const result = continueRun(c.var.deps.db, c.req.param('id'), c.req.valid('json'));
    if (!result.ok) badRequest(result.error);
    return c.json({ ok: true, retried: result.retried, changes: result.changes });
  })
  .post('/runs/:id/:action{pause|resume|cancel}', async (c) => {
    const { runner, db } = c.var.deps;
    const id = c.req.param('id');
    const action = c.req.param('action') as 'pause' | 'resume' | 'cancel';
    if (action === 'resume') {
      // An optional body raises (or clears, with null) the caps before the run goes on.
      const text = await c.req.text();
      let raw: unknown = {};
      try {
        if (text.trim()) raw = JSON.parse(text);
      } catch {
        badRequest('상한이 올바르지 않습니다.');
      }
      const body = resumeSchema.safeParse(raw);
      if (!body.success) badRequest('상한이 올바르지 않습니다.');
      const result = continueRun(db, id, { limits: body.data.limits });
      if (!result.ok) badRequest(result.error);
      return c.json({ ok: true });
    }
    runner[action](id);
    return c.json({ ok: true });
  });
