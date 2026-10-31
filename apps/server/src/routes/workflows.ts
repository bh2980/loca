import { Hono } from 'hono';
import { fitScope, startWorkflowRun } from '../services/start-run.ts';
import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AI_OUTPUT_IDS, type AiOutput, choiceKey, httpParams, FUNCTIONS, type FunctionName, isWholeScriptWorkflow, workflowInput, scriptParams, workflowDefinitionSchema, type WorkflowDefinition, runModelsSchema, withRunModels, WORKFLOW_TEMPLATES, EMPTY_MODEL_CHOICE, runScopeSchema } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { workflowIssues } from '../services/workflow-issues.ts';
import { events } from '../events.ts';
import { callHttp, httpOutput, lineView, validateScriptData } from '../engine/functions/index.ts';
import { runScript } from '../engine/functions/sandbox.ts';
import { WHOLE_SCRIPT_BUSY, refuseSecondWholeScript, selectRunTerms, selectRunUnits } from '../engine/run-create.ts';
import { listBatches, preflight } from '../services/preflight.ts';
import { choiceLabel } from '../services/routes.ts';
import { previewRequest } from '../services/request-preview.ts';
import { continuePreflight, switchedRun } from '../services/run-continue.ts';
import { deleteWorkflow, saveWorkflow, workflowCallers, WorkflowMutationError } from '../services/workflow-mutations.ts';
import { issueTagIds } from '../services/issue-tags.ts';
import { runRows } from '../services/run-rows.ts';
import { workflowRows } from '../services/workflow-rows.ts';
import { connectionName, connectionNames, runItemIds, runItemRows, runProgress } from '../services/run-detail.ts';
import { aiCallRows } from '../services/log-rows.ts';
import { rowChangesOf } from '../db/row-changes.ts';

const scopeSchema = runScopeSchema;
/** A run's scope and, optionally, the models it uses instead of its nodes' own (by AI node id). */
const runSchema = scopeSchema.extend({ models: runModelsSchema.optional() });
const runLimitsSchema = z.object({ maxCalls: z.number().int().min(1).optional(), maxInputTokens: z.number().int().min(1).optional() });
const runItemQuery = z.object({ state: z.string().optional(), nodeId: z.string().optional(), offset: z.coerce.number().default(0), limit: z.coerce.number().max(500).default(100) });
const continueSchema = z.object({ models: runModelsSchema.optional(), retryFailed: z.boolean().default(false) });

/** A whole-script run continued or resumed while another one runs: refused like a second start. */
/** What POST /runs/:id/resume may carry: new caps (null removes one). */
export const resumeSchema = z.object({ limits: z.object({ maxCalls: z.number().int().min(1).nullable().optional(), maxInputTokens: z.number().int().min(1).nullable().optional() }).optional() });

function refuseWhileAnotherWholeScript(db: Db, run: typeof s.runs.$inferSelect) {
  if (!isWholeScriptWorkflow(run.definition)) return;
  try {
    refuseSecondWholeScript(db, run.projectId, run.id);
  } catch {
    badRequest(`${WHOLE_SCRIPT_BUSY} 그 실행이 끝나거나 멈춘 뒤에 이어서 하세요.`);
  }
}

function blankWorkflow(): WorkflowDefinition {
  return workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { input: 'lines' } },
    ],
    edges: [],
  });
}

const NEW_WORKFLOW_NAME = '새 워크플로';

/** "새 워크플로", then "새 워크플로 2", "3"… for the first name the project has not used. */
function freeWorkflowName(db: Db, projectId: string): string {
  const taken = new Set(db.select({ name: s.workflows.name }).from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().map((row) => row.name));
  if (!taken.has(NEW_WORKFLOW_NAME)) return NEW_WORKFLOW_NAME;
  for (let n = 2; ; n++) if (!taken.has(`${NEW_WORKFLOW_NAME} ${n}`)) return `${NEW_WORKFLOW_NAME} ${n}`;
}

const TEMPLATE_KEYS = WORKFLOW_TEMPLATES.map((template) => template.key) as [string, ...string[]];

/** A workflow name not taken in the project: `base`, then `base 2`, `3`… */
function freeNameFor(db: Db, projectId: string, base: string): string {
  const taken = new Set(db.select({ name: s.workflows.name }).from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().map((row) => row.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

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
      const name = body.name ?? (fromTemplate ? freeNameFor(db, projectId, fromTemplate.name) : freeWorkflowName(db, projectId));
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
    try {
      const row = saveWorkflow(db, current.projectId, { id: current.id, ...body });
      return c.json({ ...row, calledBy: workflowCallers(db, current.projectId, current.id), issues: workflowIssues(db, current.projectId, row.definition, current.id) });
    } catch (error) {
      if (error instanceof WorkflowMutationError) {
        if (error.status === 404) found(undefined, '워크플로');
        badRequest(error.message);
      }
      throw error;
    }
  })
  .post('/workflows/:id/validate', validate('json', z.object({ definition: workflowDefinitionSchema })), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json(workflowIssues(db, workflow.projectId, c.req.valid('json').definition, workflow.id));
  })
  .delete('/workflows/:id', (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    try {
      deleteWorkflow(db, workflow.projectId, workflow.id);
    } catch (error) {
      if (error instanceof WorkflowMutationError) badRequest(error.message);
      throw error;
    }
    return c.json({ ok: true });
  })
  /** 보낼 내용: one request of a saved AI node for a sample item (no model call). */
  .get('/workflows/:id/nodes/:nodeId/request', validate('query', z.object({ sample: z.string().optional() })), (c) => {
    const workflow = found(c.var.deps.db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json(found(previewRequest(c.var.deps.db, workflow, c.req.param('nodeId'), c.req.valid('query').sample) ?? undefined, 'AI 노드'));
  })
  .post('/workflows/:id/preview', validate('json', scopeSchema), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    fitScope(workflow.definition, c.req.valid('json'));
    const select = workflowInput(workflow.definition) === 'terms' ? selectRunTerms : selectRunUnits;
    return c.json({ count: select(db, workflow.projectId, c.req.valid('json')).length });
  })
  /** The run plan and its cost estimate, computed without calling a model (see services/preflight.ts). */
  .post('/workflows/:id/preflight', validate('json', runSchema), async (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const { models, ...scope } = c.req.valid('json');
    fitScope(workflow.definition, scope);
    try {
      return c.json(await preflight(db, { ...workflow, definition: withRunModels(workflow.definition, models) }, scope));
    } catch (error) {
      badRequest(error instanceof Error ? error.message : String(error));
    }
  })
  .post('/workflows/:id/runs', validate('json', runSchema.extend({ limits: runLimitsSchema.optional() })), async (c) => {
    const { limits, models, ...scope } = c.req.valid('json');
    return c.json(await startWorkflowRun(c.var.deps.db, c.req.param('id'), { scope, models, limits }), 201);
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
  /** The project's AI log: every model request, newest first (see ai-calls.ts), with totals. */
  .get('/projects/:projectId/ai-calls', validate('query', z.object({ kind: z.enum(s.AI_CALL_KINDS).optional(), status: z.enum(['running', 'ok', 'failed']).optional(), ref: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { kind, status, ref, limit } = c.req.valid('query');
    const where = and(eq(s.aiCalls.projectId, projectId), kind ? eq(s.aiCalls.kind, kind) : undefined, status ? eq(s.aiCalls.status, status) : undefined, ref ? eq(s.aiCalls.refId, ref) : undefined);
    // What was sent can be a whole script; it is fetched one call at a time (below), not listed.
    const { request: _request, response: _response, ...listed } = getTableColumns(s.aiCalls);
    const calls = db.select({ ...listed, hasRequest: sql<boolean>`${s.aiCalls.request} is not null`, hasResponse: sql<boolean>`${s.aiCalls.response} is not null` }).from(s.aiCalls).where(where).orderBy(desc(s.aiCalls.startedAt)).limit(limit).all();
    const names = connectionNames(db);
    const totals = db
      .select({
        kind: s.aiCalls.kind,
        calls: sql<number>`count(*)`,
        running: sql<number>`sum(${s.aiCalls.status} = 'running')`,
        failed: sql<number>`sum(${s.aiCalls.status} = 'failed')`,
        inputTokens: sql<number>`coalesce(sum(${s.aiCalls.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${s.aiCalls.outputTokens}), 0)`,
      })
      .from(s.aiCalls)
      .where(eq(s.aiCalls.projectId, projectId))
      .groupBy(s.aiCalls.kind)
      .all();
    return c.json({ calls: calls.map((call) => ({ ...call, hasRequest: Boolean(call.hasRequest), hasResponse: Boolean(call.hasResponse), connectionName: connectionName(names, call.connectionId, call.connectionKind) })), totals });
  })
  /** Which of the project's model requests a list shows, newest first, as ids (calls topic: one is logged or finishes). */
  .get('/projects/:projectId/ai-calls/ids', validate('query', z.object({ kind: z.enum(s.AI_CALL_KINDS).optional(), ref: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) })), (c) => {
    const { db } = c.var.deps;
    const { kind, ref, limit } = c.req.valid('query');
    const where = and(eq(s.aiCalls.projectId, c.req.param('projectId')), kind ? eq(s.aiCalls.kind, kind) : undefined, ref ? eq(s.aiCalls.refId, ref) : undefined);
    return c.json({ ids: db.select({ id: s.aiCalls.id }).from(s.aiCalls).where(where).orderBy(desc(s.aiCalls.startedAt)).limit(limit).all().map((row) => row.id) });
  })
  /** The project's model requests by id, with the feed's count when read (the browser's AI log collection). */
  .post('/projects/:projectId/ai-calls/by-ids', validate('json', z.object({ ids: z.array(z.string()).max(500) })), (c) => {
    const seq = rowChangesOf(c.var.deps.db.$client).seq;
    return c.json({ rows: aiCallRows(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids), seq });
  })
  /** What one model request sent (system prompt, then the prompt) and, for a failed one, what it printed before failing; each when kept. */
  .get('/projects/:projectId/ai-calls/:id/request', (c) => {
    const row = found(c.var.deps.db.select({ request: s.aiCalls.request, response: s.aiCalls.response }).from(s.aiCalls).where(and(eq(s.aiCalls.id, c.req.param('id')), eq(s.aiCalls.projectId, c.req.param('projectId')))).get(), 'AI 호출');
    return c.json({ request: row.request, response: row.response });
  })
  /**
   * How fast a model has answered before, for "보통 약 N분": the median seconds per 1,000 input tokens
   * over finished requests of this kind with this model, across every project.
   */
  .get('/ai-calls/pace', validate('query', z.object({ model: z.string().min(1), kind: z.enum(s.AI_CALL_KINDS) })), (c) => {
    const { model, kind } = c.req.valid('query');
    const rows = c.var.deps.db
      .select({ input: s.aiCalls.inputTokens, started: s.aiCalls.startedAt, finished: s.aiCalls.finishedAt })
      .from(s.aiCalls)
      .where(and(eq(s.aiCalls.model, model), eq(s.aiCalls.kind, kind), eq(s.aiCalls.status, 'ok'), sql`${s.aiCalls.inputTokens} > 0`, sql`${s.aiCalls.finishedAt} is not null`))
      .orderBy(desc(s.aiCalls.startedAt))
      .limit(50)
      .all();
    const rates = rows.map((row) => (row.finished!.getTime() - row.started.getTime()) / 1000 / (row.input! / 1000)).sort((a, b) => a - b);
    return c.json({ samples: rates.length, secondsPer1k: rates.length ? rates[Math.floor(rates.length / 2)] : null });
  })
  .get('/projects/:projectId/runs', (c) => c.json(runRows(c.var.deps.db, c.req.param('projectId'))))
  /** The batches this run was planned in (stored per line when it started), as the run dialog lists them. */
  .get('/runs/:id/plan', (c) => {
    const { db } = c.var.deps;
    const run = found(db.select({ id: s.runs.id }).from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const lines = db
      .selectDistinct({ plan: s.runItems.plan, groupId: s.units.groupId, speaker: s.units.speaker, seq: s.units.seq, tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4` })
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
    const callLimits = Object.fromEntries(
      run.definition.nodes.flatMap((node) => {
        if (node.type === 'ai') return [[node.id, node.config.concurrency]];
        return node.type === 'function' && FUNCTIONS[node.config.fn as FunctionName]?.async ? [[node.id, node.config.concurrency]] : [];
      }),
    );
    const { id: _id, ...progress } = runProgress(db, runner, run.projectId, [run.id])[0]!;
    // What each model choice resolved to when the run started.
    return c.json({ ...rest, ...progress, models: Object.values(models).map((model) => ({ label: model.label, connectionId: model.route.connectionId, name: model.route.name, model: model.route.model })), callLimits });
  })
  .get('/runs/:id/items', validate('query', runItemQuery), (c) => {
    const { db } = c.var.deps;
    const run = found(db.select({ projectId: s.runs.projectId }).from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const { total, subject, ids } = runItemIds(db, c.req.param('id'), c.req.valid('query'));
    return c.json({ total, subject, rows: runItemRows(db, run.projectId, ids) });
  })
  /** One page of a run's items as ids: the run page reads the items from the browser's run items collection. */
  .get('/runs/:id/items/ids', validate('query', runItemQuery), (c) => c.json(runItemIds(c.var.deps.db, c.req.param('id'), c.req.valid('query'))))
  /** Run items by id, with the feed's count when read (the browser's run items collection). */
  .post('/projects/:projectId/run-items', validate('json', z.object({ ids: z.array(z.string()).max(500) })), (c) => {
    const seq = rowChangesOf(c.var.deps.db.$client).seq;
    return c.json({ rows: runItemRows(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids), seq });
  })
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
    return c.json({ lines: result.lines, plan: result.plan });
  })
  /** Continue a paused or finished run, on other models for some AI steps and/or with its failed lines again. */
  .post('/runs/:id/continue', validate('json', continueSchema), (c) => {
    const { db, runner } = c.var.deps;
    const run = found(db.select().from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const { models, retryFailed } = c.req.valid('json');
    refuseWhileAnotherWholeScript(db, run);
    const switched = switchedRun(db, run, models);
    if (!switched.ok) badRequest(switched.error);
    const result = runner.continue(run.id, { definition: switched.definition, models: switched.models, changes: switched.changes, retryFailed });
    if (!result.ok) badRequest(result.error);
    return c.json({ ok: true, retried: result.retried, changes: switched.changes });
  })
  .post('/runs/:id/:action{pause|resume|cancel}', async (c) => {
    const { runner } = c.var.deps;
    const id = c.req.param('id');
    const action = c.req.param('action') as 'pause' | 'resume' | 'cancel';
    if (action === 'resume') {
      const run = found(c.var.deps.db.select().from(s.runs).where(eq(s.runs.id, id)).get(), '실행');
      refuseWhileAnotherWholeScript(c.var.deps.db, run);
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
      runner.resume(id, body.data.limits);
      return c.json({ ok: true });
    }
    runner[action](id);
    return c.json({ ok: true });
  });
