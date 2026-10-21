import { Hono } from 'hono';
import { scopeMismatch } from '../services/run-plan.ts';
import { and, asc, count, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AI_OUTPUT_IDS, type AiOutput, choiceKey, nodeName, httpParams, FUNCTIONS, type FunctionName, isWholeScriptWorkflow, nodeModels, CONNECTION_KIND_INFO, workflowInput, AUTO_MARK_IDS, type AutoMark, scriptParams, workflowDefinitionSchema, type WorkflowDefinition, runModelsSchema, withRunModels } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { workflowIssues } from '../services/workflow-issues.ts';
import { events } from '../events.ts';
import { callHttp, httpOutput, lineView, validateScriptData } from '../engine/functions/index.ts';
import { runScript } from '../engine/functions/sandbox.ts';
import { WHOLE_SCRIPT_BUSY, createRunInSteps, FILLING, refuseSecondWholeScript, selectRunTerms, selectRunUnits } from '../engine/run-create.ts';
import { listBatches, preflight } from '../services/preflight.ts';
import { choiceLabel, snapshotWorkflowModels } from '../services/routes.ts';
import { autoOf, modelLimitsOf } from '../services/budgets.ts';
import { previewRequest } from '../services/request-preview.ts';
import { continuePreflight, switchedRun } from '../services/run-continue.ts';
import { deleteWorkflow, saveWorkflow, WorkflowMutationError } from '../services/workflow-mutations.ts';

const scopeSchema = z.object({ groupIds: z.array(z.string()).optional(), unitIds: z.array(z.string()).optional(), tagIds: z.array(z.string()).optional(), marks: z.array(z.enum(AUTO_MARK_IDS as [AutoMark, ...AutoMark[]])).optional(), statusIds: z.array(z.string()).optional(), termIds: z.array(z.string()).optional() });
/** A run's scope and, optionally, the models it uses instead of its nodes' own (by AI node id). */
/** A scope that does not fit the workflow's input (line scenes for terms, the other input's marks…) is refused. */
const fitScope = (definition: WorkflowDefinition, scope: s.RunScope) => {
  const mismatch = scopeMismatch(workflowInput(definition), scope);
  if (mismatch) badRequest(mismatch);
};
const runSchema = scopeSchema.extend({ models: runModelsSchema.optional() });
const continueSchema = z.object({ models: runModelsSchema.optional(), retryFailed: z.boolean().default(false) });

/** Connection names now, for logs that keep only the id; a deleted connection reads as its kind. */
const connectionNames = (db: Db) => new Map(db.select({ id: s.connections.id, name: s.connections.name }).from(s.connections).all().map((row) => [row.id, row.name]));
const connectionName = (names: Map<string, string>, id: string | null, kind: string | null) =>
  (id && names.get(id)) ?? (kind ? (CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.label ?? kind) : null);

/** A whole-script run continued or resumed while another one runs: refused like a second start. */
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

export const workflowRoutes = new Hono<Env>()
  .get('/projects/:projectId/workflows', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const rows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).orderBy(asc(s.workflows.name)).all();
    return c.json(
      rows.map(({ definition, ...row }) => ({
        ...row,
        // What it takes in (lines or terms): the run dialog's scope fields follow it.
        input: workflowInput(definition),
        nodeCount: definition.nodes.length,
        // Its AI nodes, for pickers that show what one of them sends (대사 상세 › AI 프롬프트).
        aiNodes: definition.nodes.filter((node) => node.type === 'ai').map((node) => ({ id: node.id, name: nodeName(node) })),
        errorCount: workflowIssues(db, projectId, definition).filter((issue) => issue.level === 'error').length,
      })),
    );
  })
  .post(
    '/projects/:projectId/workflows',
    validate('json', z.object({ name: z.string().trim().min(1).optional() })),
    (c) => {
      const { db } = c.var.deps;
      const projectId = c.req.param('projectId');
      const name = c.req.valid('json').name ?? freeWorkflowName(db, projectId);
      const definition = blankWorkflow();
      const row = saveWorkflow(db, projectId, { name, description: '', definition });
      return c.json(row, 201);
    },
  )
  .get('/workflows/:id', (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    return c.json({ ...workflow, issues: workflowIssues(db, workflow.projectId, workflow.definition) });
  })
  .put('/workflows/:id', validate('json', z.object({ name: z.string().trim().min(1), description: z.string().default(''), definition: workflowDefinitionSchema, version: z.number().int() })), (c) => {
    const { db } = c.var.deps;
    const body = c.req.valid('json');
    const current = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    try {
      const row = saveWorkflow(db, current.projectId, { id: current.id, ...body });
      return c.json({ ...row, issues: workflowIssues(db, current.projectId, row.definition) });
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
    return c.json(workflowIssues(db, workflow.projectId, c.req.valid('json').definition));
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
  /** The line text per request "auto" would pick for the node as it is being edited (model, output, batch mode), with what decided it: the model's limits and this node's past requests. */
  .get('/workflows/:id/nodes/:nodeId/auto-lines', validate('query', z.object({ connectionId: z.string(), model: z.string(), output: z.enum(AI_OUTPUT_IDS as [AiOutput, ...AiOutput[]]), mode: z.enum(['unit', 'group', 'count', 'whole']) })), (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select({ id: s.workflows.id }).from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const { connectionId, model, output, mode } = c.req.valid('query');
    const { lines, ratio, cap } = autoOf(db, workflow.id, { id: c.req.param('nodeId'), config: { model: { connectionId, model }, output, batch: { mode } } }, modelLimitsOf(db, { connectionId, model }));
    return c.json({ lines, ratio, cap });
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
    return c.json(await preflight(db, { ...workflow, definition: withRunModels(workflow.definition, models) }, scope));
  })
  .post('/workflows/:id/runs', validate('json', runSchema.extend({ limits: z.object({ maxCalls: z.number().int().min(1).optional(), maxInputTokens: z.number().int().min(1).optional() }).optional() })), async (c) => {
    const { db } = c.var.deps;
    const stored = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const { limits, models, ...scope } = c.req.valid('json');
    fitScope(stored.definition, scope);
    // This run's models (the dialog's picks) stand in for the nodes' own; the workflow is not changed.
    const workflow = { ...stored, definition: withRunModels(stored.definition, models) };
    const errors = workflowIssues(db, workflow.projectId, workflow.definition).filter((issue) => issue.level === 'error');
    if (errors.length) badRequest(`워크플로에 오류가 ${errors.length}개 있습니다: ${errors[0].message}`);
    try {
      return c.json(await createRunInSteps(db, { projectId: workflow.projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope, limits }), 201);
    } catch (error) {
      badRequest(error instanceof Error ? error.message : String(error));
    }
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
  /** Each run's model requests and tokens from the AI log, for 실행 기록. */
  .get('/projects/:projectId/jobs', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const runIds = db.select({ id: s.runs.id }).from(s.runs).where(eq(s.runs.projectId, projectId)).orderBy(desc(s.runs.createdAt)).limit(200).all().map((run) => run.id);
    const stats = runIds.length
      ? db
          .select({ refId: s.aiCalls.refId, calls: sql<number>`count(*)`, inputTokens: sql<number>`coalesce(sum(${s.aiCalls.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${s.aiCalls.outputTokens}), 0)` })
          .from(s.aiCalls)
          .where(and(eq(s.aiCalls.projectId, projectId), inArray(s.aiCalls.refId, runIds)))
          .groupBy(s.aiCalls.refId)
          .all()
      : [];
    /** Model requests per workflow run, from the AI log (runs started before it have none). */
    return c.json({ runCalls: Object.fromEntries(stats.map((row) => [row.refId!, row])) });
  })
  .get('/projects/:projectId/runs', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const runs = db
      .select({ id: s.runs.id, workflowId: s.runs.workflowId, workflowName: s.runs.workflowName, workflowVersion: s.runs.workflowVersion, subject: s.runs.subject, status: s.runs.status, notice: s.runs.notice, total: s.runs.total, createdAt: s.runs.createdAt, finishedAt: s.runs.finishedAt })
      .from(s.runs)
      .where(eq(s.runs.projectId, projectId))
      .orderBy(desc(s.runs.createdAt))
      .limit(200)
      .all();
    // Per line, not per item: a line sent down several branches has an item in each, and is done
    // only when every branch is (running > queued > failed > cancelled > done).
    const counts = runs.length
      ? db.all<{ runId: string; state: s.ItemState; count: number }>(sql`
          select run_id as runId, state, count(*) as count from (
            select i.run_id, case
              when sum(i.state = 'running') > 0 then 'running'
              when sum(i.state = 'queued') > 0 then 'queued'
              when sum(i.state = 'failed') > 0 then 'failed'
              when sum(i.state = 'cancelled') > 0 then 'cancelled'
              else 'done' end as state
            from ${s.runItems} i join ${s.runs} r on r.id = i.run_id
            where r.project_id = ${projectId}
            group by i.run_id, i.subject_id
          ) group by run_id, state`)
      : [];
    const byRun = Map.groupBy(counts, (row) => row.runId);
    return c.json(runs.map((run) => ({ ...run, states: Object.fromEntries((byRun.get(run.id) ?? []).map((row) => [row.state, row.count])) })));
  })
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
  .get('/runs/:id', (c) => {
    const { db, runner } = c.var.deps;
    const run = found(db.select().from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get(), '실행');
    const nodes = db
      .select({ nodeId: s.runItems.nodeId, state: s.runItems.state, count: count() })
      .from(s.runItems)
      .where(eq(s.runItems.runId, run.id))
      .groupBy(s.runItems.nodeId, s.runItems.state)
      .all();
    const usage = db
      .select({ steps: count(), failed: sql<number>`sum(case when ${s.runSteps.ok} then 0 else 1 end)`, inputTokens: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${s.runSteps.outputTokens}), 0)`, cachedInputTokens: sql<number>`coalesce(sum(${s.runSteps.cachedInputTokens}), 0)`, reasoningTokens: sql<number>`coalesce(sum(${s.runSteps.reasoningTokens}), 0)`, costUsd: sql<number | null>`sum(${s.runSteps.costUsd})` })
      .from(s.runSteps)
      .where(eq(s.runSteps.runId, run.id))
      .get();
    // Which connection and model did the calls (a switched or shared step, a fallback that took over).
    const names = connectionNames(db);
    const byModel = db
      .select({ connectionId: s.runSteps.connectionId, model: s.runSteps.model, steps: count(), failed: sql<number>`sum(case when ${s.runSteps.ok} then 0 else 1 end)`, inputTokens: sql<number>`coalesce(sum(${s.runSteps.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${s.runSteps.outputTokens}), 0)`, costUsd: sql<number | null>`sum(${s.runSteps.costUsd})` })
      .from(s.runSteps)
      .where(eq(s.runSteps.runId, run.id))
      .groupBy(s.runSteps.connectionId, s.runSteps.model)
      .all()
      .map((row) => ({ ...row, name: connectionName(names, row.connectionId, null) }));
    const { models, ...rest } = run;
    // Requests a node has in flight now, and how many it can have at once: an AI node's 동시 처리 수,
    // an HTTP or script node's workflow setting.
    const callLimits = Object.fromEntries(
      run.definition.nodes.flatMap((node) => {
        if (node.type === 'ai') return [[node.id, node.config.concurrency]];
        return node.type === 'function' && FUNCTIONS[node.config.fn as FunctionName]?.async ? [[node.id, run.definition.settings.concurrency]] : [];
      }),
    );
    // Items that went through each node (a line that visited a node twice counts once): the run graph's "지나감".
    const passed = Object.fromEntries(
      db
        .all<{ nodeId: string; count: number }>(sql`select json_extract(step.value, '$.nodeId') as nodeId, count(distinct item.id) as count from ${s.runItems} item, json_each(item.data, '$.path') step where item.run_id = ${run.id} group by nodeId`)
        .map((row) => [row.nodeId, row.count]),
    );
    // What each model choice resolved to when the run started, its fallbacks after it.
    return c.json({ ...rest, passed, models: Object.values(models).map((model) => ({ label: model.label, routes: model.routes.map((route) => ({ connectionId: route.connectionId, name: route.name, model: route.model })) })), nodes, calls: runner.liveCalls(run.id), callLimits, usage, byModel, filling: run.notice === FILLING });
  })
  .get('/runs/:id/items', validate('query', z.object({ state: z.string().optional(), nodeId: z.string().optional(), offset: z.coerce.number().default(0), limit: z.coerce.number().max(500).default(100) })), (c) => {
    const { db } = c.var.deps;
    const { state, nodeId, offset, limit } = c.req.valid('query');
    const conditions = [eq(s.runItems.runId, c.req.param('id'))];
    if (state) conditions.push(eq(s.runItems.state, state as s.ItemState));
    if (nodeId) conditions.push(eq(s.runItems.nodeId, nodeId));
    const where = and(...conditions);
    const total = db.select({ count: count() }).from(s.runItems).where(where).get()!.count;
    const run = db.select({ subject: s.runs.subject }).from(s.runs).where(eq(s.runs.id, c.req.param('id'))).get();
    // Term runs list the term (source, current form) where line runs list the line; most used first.
    if (run?.subject === 'terms') {
      const rows = db
        .select({ id: s.runItems.id, unitId: s.runItems.subjectId, key: s.terms.source, speaker: sql<string | null>`null`, source: s.terms.source, target: s.terms.target, nodeId: s.runItems.nodeId, state: s.runItems.state, visits: s.runItems.visits, data: s.runItems.data, error: s.runItems.error, updatedAt: s.runItems.updatedAt, statusName: sql<string | null>`null`, statusColor: sql<string | null>`null` })
        .from(s.runItems)
        .innerJoin(s.terms, eq(s.terms.id, s.runItems.subjectId))
        .where(where)
        .orderBy(desc(sql`coalesce(${s.terms.lines}, 0)`), asc(s.terms.source))
        .limit(limit)
        .offset(offset)
        .all();
      return c.json({ total, subject: 'terms' as const, rows });
    }
    const rows = db
      .select({ id: s.runItems.id, unitId: s.runItems.subjectId, key: s.units.key, speaker: s.units.speaker, source: s.units.source, nodeId: s.runItems.nodeId, state: s.runItems.state, visits: s.runItems.visits, data: s.runItems.data, error: s.runItems.error, updatedAt: s.runItems.updatedAt, statusName: s.statuses.name, statusColor: s.statuses.color })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.subjectId))
      .leftJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
      .where(where)
      .orderBy(asc(s.units.seq))
      .limit(limit)
      .offset(offset)
      .all();
    return c.json({ total, subject: 'lines' as const, rows: rows.map((row) => ({ ...row, target: null as string | null })) });
  })
  .get('/runs/:id/steps', (c) => {
    const { db } = c.var.deps;
    return c.json(db.select().from(s.runSteps).where(eq(s.runSteps.runId, c.req.param('id'))).orderBy(desc(s.runSteps.startedAt)).limit(200).all());
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
  .post('/runs/:id/:action{pause|resume|cancel}', (c) => {
    const { runner } = c.var.deps;
    const id = c.req.param('id');
    const action = c.req.param('action') as 'pause' | 'resume' | 'cancel';
    if (action === 'resume') {
      const run = found(c.var.deps.db.select().from(s.runs).where(eq(s.runs.id, id)).get(), '실행');
      refuseWhileAnotherWholeScript(c.var.deps.db, run);
    }
    runner[action](id);
    return c.json({ ok: true });
  });
