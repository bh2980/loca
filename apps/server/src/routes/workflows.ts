import { Hono } from 'hono';
import { and, asc, count, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ANALYSIS_SECTIONS, analysisTemplate, CONNECTION_KIND_INFO, knowledgeTemplate, lineMarksSchema, listenerTemplate, speechFixTemplate, termExtractionTemplate, translationTemplate, validateWorkflow, workflowDefinitionSchema, type WorkflowDefinition, runModelsSchema, withRunModels } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { lineView } from '../engine/functions/index.ts';
import { runScript } from '../engine/functions/sandbox.ts';
import { createRunInSteps, FILLING, selectRunUnits } from '../engine/runner.ts';
import { listBatches, preflight } from '../services/preflight.ts';
import { choiceLabel, defaultModelChoice, snapshotWorkflowModels } from '../services/routes.ts';
import { continuePreflight, switchedRun } from '../services/run-continue.ts';

const scopeSchema = z.object({ groupIds: z.array(z.string()).optional(), unitIds: z.array(z.string()).optional(), tagIds: z.array(z.string()).optional(), marks: lineMarksSchema.optional(), ignoreStatus: z.boolean().optional() });
/** A run's scope and, optionally, the models it uses instead of its nodes' own (by AI node id). */
const runSchema = scopeSchema.extend({ models: runModelsSchema.optional() });
const continueSchema = z.object({ models: runModelsSchema.optional(), retryFailed: z.boolean().default(false) });

/** Connection names now, for logs that keep only the id; a deleted connection reads as its kind. */
const connectionNames = (db: Db) => new Map(db.select({ id: s.connections.id, name: s.connections.name }).from(s.connections).all().map((row) => [row.id, row.name]));
const connectionName = (names: Map<string, string>, id: string | null, kind: string | null) =>
  (id && names.get(id)) ?? (kind ? (CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.label ?? kind) : null);

export function workflowIssues(db: Db, projectId: string, definition: WorkflowDefinition) {
  const ids = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));
  return validateWorkflow(definition, {
    connections: new Map(db.select({ id: s.connections.id, kind: s.connections.kind }).from(s.connections).all().filter((row) => row.kind !== 'http').map((row) => [row.id, row.kind])),
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

/** Single-purpose templates that only need a model. */
const TEMPLATES = { terms: termExtractionTemplate, listener: listenerTemplate, knowledge: knowledgeTemplate, speechFix: speechFixTemplate };

function templateWorkflow(db: Db, projectId: string): WorkflowDefinition {
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all();
  const initial = statuses.find((status) => status.kind === 'initial') ?? statuses[0];
  const final = statuses.find((status) => status.kind === 'final') ?? statuses.at(-1)!;
  const middle = statuses.filter((status) => status.kind === 'normal');
  return translationTemplate({
    model: defaultModelChoice(db),
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
  .post(
    '/projects/:projectId/workflows',
    validate('json', z.object({ name: z.string().trim().min(1), from: z.enum(['template', 'blank', 'terms', 'listener', 'knowledge', 'speechFix', 'analysis']).default('template'), /** What an analysis template reads for; empty = everything. */ sections: z.array(z.enum(ANALYSIS_SECTIONS)).optional() })),
    (c) => {
      const { db } = c.var.deps;
      const projectId = c.req.param('projectId');
      const { name, from, sections } = c.req.valid('json');
      const definition =
        from === 'template' ? templateWorkflow(db, projectId) : from === 'blank' ? blankWorkflow(db, projectId) : from === 'analysis' ? analysisTemplate({ model: defaultModelChoice(db), sections }) : TEMPLATES[from]({ model: defaultModelChoice(db) });
      const row = db.insert(s.workflows).values({ projectId, name, definition }).returning().get();
      events.changed(projectId, 'workflows');
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
    if (current.version !== body.version) badRequest('다른 곳에서 먼저 저장했습니다. 새로고침 후 다시 저장하세요.');
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
  /** The run plan and its cost estimate, computed without calling a model (see services/preflight.ts). */
  .post('/workflows/:id/preflight', validate('json', runSchema), async (c) => {
    const { db } = c.var.deps;
    const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const { models, ...scope } = c.req.valid('json');
    return c.json(await preflight(db, { ...workflow, definition: withRunModels(workflow.definition, models) }, scope));
  })
  .post('/workflows/:id/runs', validate('json', runSchema.extend({ limits: z.object({ maxCalls: z.number().int().min(1).optional(), maxInputTokens: z.number().int().min(1).optional() }).optional() })), async (c) => {
    const { db } = c.var.deps;
    const stored = found(db.select().from(s.workflows).where(eq(s.workflows.id, c.req.param('id'))).get(), '워크플로');
    const { limits, models, ...scope } = c.req.valid('json');
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
  .post('/projects/:projectId/script-test', validate('json', z.object({ code: z.string(), ports: z.array(z.string()).min(1), unitId: z.string().optional() })), async (c) => {
    const { db } = c.var.deps;
    const { code, ports, unitId } = c.req.valid('json');
    const unit = unitId
      ? db.select().from(s.units).where(and(eq(s.units.id, unitId), eq(s.units.projectId, c.req.param('projectId')))).get()
      : db.select().from(s.units).where(eq(s.units.projectId, c.req.param('projectId'))).orderBy(asc(s.units.seq)).limit(1).get();
    if (!unit) badRequest('시험할 대사가 없습니다.');
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
  /**
   * AI jobs that are not workflow runs (work analysis, glossary fill), for 실행 기록 to list beside
   * the runs, each with its model requests from the AI log.
   */
  .get('/projects/:projectId/jobs', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const analyses = db.select().from(s.analysisJobs).where(eq(s.analysisJobs.projectId, projectId)).orderBy(desc(s.analysisJobs.createdAt)).limit(100).all();
    const fills = db.select().from(s.termJobs).where(eq(s.termJobs.projectId, projectId)).orderBy(desc(s.termJobs.createdAt)).limit(100).all();
    const runIds = db.select({ id: s.runs.id }).from(s.runs).where(eq(s.runs.projectId, projectId)).orderBy(desc(s.runs.createdAt)).limit(200).all().map((run) => run.id);
    const ids = [...analyses, ...fills].map((job) => job.id).concat(runIds);
    const stats = new Map(
      (ids.length
        ? db
            .select({ refId: s.aiCalls.refId, calls: sql<number>`count(*)`, inputTokens: sql<number>`coalesce(sum(${s.aiCalls.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${s.aiCalls.outputTokens}), 0)` })
            .from(s.aiCalls)
            .where(and(eq(s.aiCalls.projectId, projectId), inArray(s.aiCalls.refId, ids)))
            .groupBy(s.aiCalls.refId)
            .all()
        : []
      ).map((row) => [row.refId!, row]),
    );
    const names = connectionNames(db);
    const used = (job: { connectionId: string | null; model: string | null; effort: string | null }) => (job.model ? choiceLabel(connectionName(names, job.connectionId, null) ?? '', { model: job.model, effort: job.effort }) : null);
    // Jobs from before the AI log have their own usage totals; the log adds the request count.
    const usage = (id: string, own: { inputTokens?: number; outputTokens?: number } | null) => ({
      calls: stats.get(id)?.calls ?? null,
      inputTokens: stats.get(id)?.inputTokens || own?.inputTokens || 0,
      outputTokens: stats.get(id)?.outputTokens || own?.outputTokens || 0,
    });
    return c.json({
      /** Model requests per workflow run, from the AI log (runs started before it have none). */
      runCalls: Object.fromEntries(runIds.flatMap((id) => (stats.has(id) ? [[id, stats.get(id)!] as const] : []))),
      jobs: [
      ...analyses.map((job) => ({ kind: 'analysis' as const, id: job.id, title: '작품 분석', model: used(job), status: job.status, error: job.error, done: job.partsDone, total: job.partsTotal, createdAt: job.createdAt, finishedAt: job.finishedAt, ...usage(job.id, job.usage) })),
      ...fills.map((job) => ({ kind: 'terms' as const, id: job.id, title: '용어 AI 채우기', model: used(job), status: job.status, error: job.error, done: job.done, total: job.total, createdAt: job.createdAt, finishedAt: job.finishedAt, ...usage(job.id, job.usage) })),
      ],
    });
  })
  .get('/projects/:projectId/runs', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const runs = db
      .select({ id: s.runs.id, workflowId: s.runs.workflowId, workflowName: s.runs.workflowName, workflowVersion: s.runs.workflowVersion, status: s.runs.status, notice: s.runs.notice, total: s.runs.total, createdAt: s.runs.createdAt, finishedAt: s.runs.finishedAt })
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
            group by i.run_id, i.unit_id
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
      .innerJoin(s.units, eq(s.units.id, s.runItems.unitId))
      .where(eq(s.runItems.runId, run.id))
      .all()
      .filter((line) => line.plan !== null)
      .sort((x, y) => x.seq - y.seq);
    const batches = [...Map.groupBy(lines, (line) => line.plan!).entries()].sort((x, y) => x[0] - y[0]).map(([, list]) => list);
    return c.json(listBatches(db, batches));
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
    // What each model choice resolved to when the run started, its fallbacks after it.
    return c.json({ ...rest, models: Object.values(models).map((model) => ({ label: model.label, routes: model.routes.map((route) => ({ connectionId: route.connectionId, name: route.name, model: route.model })) })), nodes, usage, byModel, filling: run.notice === FILLING });
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
      .select({ id: s.runItems.id, unitId: s.runItems.unitId, key: s.units.key, speaker: s.units.speaker, source: s.units.source, nodeId: s.runItems.nodeId, state: s.runItems.state, visits: s.runItems.visits, data: s.runItems.data, error: s.runItems.error, updatedAt: s.runItems.updatedAt, statusName: s.statuses.name, statusColor: s.statuses.color })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.unitId))
      .leftJoin(s.statuses, eq(s.statuses.id, s.units.statusId))
      .where(where)
      .orderBy(asc(s.units.seq))
      .limit(limit)
      .offset(offset)
      .all();
    return c.json({ total, rows });
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
    runner[action](id);
    return c.json({ ok: true });
  });
