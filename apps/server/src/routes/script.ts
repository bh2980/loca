import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { batchChangeSchema, lineFilterSchema, resultRequestSchema } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { proposeChange, undoChanges } from '../services/change-gate.ts';
import { resultCheck, resultFile, resultPlan } from '../services/results.ts';
import { runErrors } from '../services/run-errors.ts';
import { agentCatalog, jsonSchemaOf } from '../services/agent-catalog.ts';
import { previewContext } from '../services/context-preview.ts';
import { checkBatch, refusalText } from '../services/proposal-check.ts';
import { callTool, describeTool } from '../services/tool-run.ts';
import { viewFlow } from '../services/view-flow.ts';
import { projectReadingRoute } from '../services/reading-route.ts';
import { inChunks } from '../db/chunk.ts';
import { speakerRows } from '../services/project-rows.ts';
import { checkScript, exportLines, findLines, firstAppearance, lineContext, runStats, sceneStats, scenesWith } from '../services/script-query.ts';

/**
 * The script API behind the `loca` CLI. Reading answers directly; writing (import, change tools)
 * becomes one proposal, decided by the project's terminal permission mode like a conversation's.
 */
export const scriptRoutes = new Hono<Env>()
  .get('/projects/:projectId/speakers', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    return c.json(speakerRows(db, projectId).map(({ id: _id, ...row }) => row));
  })
  .get('/projects/:projectId/speakers/:name/first', (c) => c.json(firstAppearance(c.var.deps.db, c.req.param('projectId'), c.req.param('name'))))
  .post('/projects/:projectId/lines/find', validate('json', lineFilterSchema), (c) => c.json(findLines(c.var.deps.db, c.req.param('projectId'), c.req.valid('json'), { diverged: true })))
  .post('/projects/:projectId/scenes/with', validate('json', z.object({ speakers: z.array(z.string().min(1)).min(1) })), (c) =>
    c.json(scenesWith(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').speakers)),
  )
  .get('/projects/:projectId/lines/:key/context', validate('query', z.object({ around: z.coerce.number().int().min(0).max(50).default(5) })), (c) =>
    c.json(found(lineContext(c.var.deps.db, c.req.param('projectId'), c.req.param('key'), c.req.valid('query').around), '대사')),
  )
  /** What an AI node would send for this line (no model call). */
  .get('/projects/:projectId/lines/:key/ai-context', validate('query', z.object({ workflowId: z.string().optional(), nodeId: z.string().optional() })), (c) =>
    c.json(found(previewContext(c.var.deps.db, c.req.param('projectId'), c.req.param('key'), c.req.valid('query')), '대사')),
  )
  .post(
    '/projects/:projectId/checks/:kind{terms|consistency|format|length}',
    validate('json', z.object({ filter: lineFilterSchema.default({ offset: 0, limit: 200 }), ratio: z.number().min(1).max(5).optional() })),
    async (c) => {
      const { filter, ratio } = c.req.valid('json');
      return c.json(await checkScript(c.var.deps.db, c.req.param('projectId'), c.req.param('kind') as 'terms', filter, { ratio }));
    },
  )
  .get('/projects/:projectId/stats/:of{groups|sections|runs}', validate('query', z.object({ sinceHours: z.coerce.number().min(1).default(24) })), (c) => {
    const { db } = c.var.deps;
    const of = c.req.param('of');
    return c.json(of === 'runs' ? runStats(db, c.req.param('projectId'), new Date(Date.now() - c.req.valid('query').sinceHours * 3_600_000)) : sceneStats(db, c.req.param('projectId'), of === 'groups' ? 'group' : 'section'));
  })
  .post(
    '/projects/:projectId/export',
    validate('json', z.object({ filter: lineFilterSchema.default({ offset: 0, limit: 200 }), before: z.number().int().min(0).max(30).default(0), terms: z.boolean().default(false), all: z.boolean().default(true) })),
    (c) => {
      const { filter, before, terms, all } = c.req.valid('json');
      return c.json(exportLines(c.var.deps.db, c.req.param('projectId'), filter, { before, terms, all }));
    },
  )
  /** The finished translation as a file for the game (the app's 번역 결과 내보내기, `loca results`). */
  .post('/projects/:projectId/results', validate('json', resultRequestSchema), (c) => {
    const file = found(resultFile(c.var.deps.db, c.req.param('projectId'), c.req.valid('json')), '프로젝트');
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.project)}-translations.json"`);
    return c.json(file);
  })
  /** What that file would hold: its numbers and first lines. */
  .post('/projects/:projectId/results/plan', validate('json', resultRequestSchema), (c) => c.json(resultPlan(c.var.deps.db, c.req.param('projectId'), c.req.valid('json'))))
  /** The lines in that file whose translation breaks the source's placeholders, tags or line breaks. */
  .post('/projects/:projectId/results/check', validate('json', resultRequestSchema), async (c) => c.json(await resultCheck(c.var.deps.db, c.req.param('projectId'), c.req.valid('json'))))
  /** Check a batch; unless dryRun, the valid, non-conflicting lines become one proposal. */
  .post('/projects/:projectId/import', validate('json', batchChangeSchema.extend({ dryRun: z.boolean().default(false) })), async (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { dryRun, ...raw } = c.req.valid('json');
    if (dryRun) {
      const { unchanged, report } = await checkBatch(db, projectId, raw);
      return c.json({ ...report, total: raw.changes.length, unchanged: unchanged.length, proposalId: null });
    }
    // Through the same gate as every change tool, so the terminal permission mode decides it. The gate's check
    // of the batch is the one check: it leaves out the rows that cannot change and auto review asks when it did.
    const gate = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: 'propose_changes', input: raw, terminal: true });
    // Nothing to change is an answer, not a failure: the report says why.
    if (!gate.ok && gate.empty && gate.batch) return c.json({ ...gate.batch, proposalId: null });
    if (!gate.ok || !gate.batch) return badRequest(gate.ok ? '일괄 변경을 검사하지 못했습니다.' : refusalText(gate));
    return c.json({ ...gate.batch, proposalId: gate.proposalId, applied: gate.applied, status: gate.status, review: gate.review ?? null });
  })
  /** A saved view's lines along its flow (viewFlow): each node's lines, and the ways in and out that stay inside the view, by line key. */
  .get('/projects/:projectId/views/:ref/flow', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const flow = viewFlow(db, projectId, c.req.param('ref'));
    const unitIds = flow.nodes.flatMap((node) => node.units);
    const rows = new Map(inChunks(unitIds, (slice) => db.select({ id: s.units.id, key: s.units.key, speaker: s.units.speaker, listener: s.units.listener, source: s.units.source, translation: s.units.translation, status: s.statuses.name }).from(s.units).leftJoin(s.statuses, eq(s.statuses.id, s.units.statusId)).where(inArray(s.units.id, slice)).all()).map((row) => [row.id, row]));
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    // A way in names the last line of the node it comes from; a way out the first line of where it goes.
    const end = (nodeId: string, at: 'first' | 'last') => {
      const node = byId.get(nodeId)!;
      const unitId = at === 'first' ? node.units[0] : node.units.at(-1);
      return (unitId && rows.get(unitId)?.key) ?? node.label ?? node.key;
    };
    // A route view: its forks, the branch it takes at each and the others (by node key), so `loca views update --branch` can take another.
    const route = flow.view.route;
    const forks = route ? projectReadingRoute(db, projectId, { start: route.start, end: route.end, via: route.via }).forks : [];
    const forkIds = route ? [...new Set([route.start, route.end, ...forks.flatMap((fork) => [fork.nodeId, ...fork.options.map((option) => option.targetId)])])] : [];
    const keys = new Map(inChunks(forkIds, (slice) => db.select({ id: s.graphNodes.id, key: s.graphNodes.key }).from(s.graphNodes).where(inArray(s.graphNodes.id, slice)).all()).map((row) => [row.id, row.key]));
    return c.json({
      view: { id: flow.view.id, label: flow.view.label },
      route: route && {
        start: keys.get(route.start) ?? route.start,
        end: keys.get(route.end) ?? route.end,
        forks: forks.map((fork) => ({
          key: keys.get(fork.nodeId) ?? fork.nodeId,
          label: fork.label,
          taken: keys.get(fork.selectedId) ?? fork.selectedId,
          options: fork.options.map((option) => ({ key: keys.get(option.targetId) ?? option.targetId, label: option.label, preview: option.preview })),
        })),
      },
      nodes: flow.nodes.map((node) => ({
        key: node.key,
        label: node.label,
        lines: node.units.flatMap((id) => (rows.has(id) ? [(({ id: _id, ...line }) => line)(rows.get(id)!)] : [])),
        from: node.incoming.map((way) => ({ key: end(way.from, 'last'), label: way.label })),
        to: node.outgoing.map((way) => ({ key: end(way.to, 'first'), label: way.label })),
      })),
    });
  })
  /** Every item of a run that failed or left through an error exit (runErrors), whole: `loca runs start --rerun-errors`. */
  .get('/projects/:projectId/runs/:runId/errors', (c) => {
    const { db } = c.var.deps;
    const run = found(db.select({ id: s.runs.id, subject: s.runs.subject, definition: s.runs.definition, workflow: s.runs.workflowName }).from(s.runs).where(and(eq(s.runs.id, c.req.param('runId')), eq(s.runs.projectId, c.req.param('projectId')))).get(), '실행');
    return c.json({ workflow: run.workflow, subject: run.subject, items: runErrors(db, run).map(({ unitId, key }) => ({ unitId, key })) });
  })
  /** Undo changes the terminal permission mode applied (not ones a person accepted), newest first; the terminal mode decides the undo too. */
  .post('/projects/:projectId/proposals/undo', validate('json', z.object({ ids: z.array(z.string()).min(1).max(500) })), async (c) =>
    c.json(await undoChanges(c.var.deps.db, { terminal: c.req.param('projectId') }, c.req.valid('json').ids)),
  )
  /** Every agent tool, for `loca tools` / `loca call`. Change tools return a proposal instead of running. */
  .get('/projects/:projectId/tools', (c) =>
    c.json(agentCatalog(c.var.deps.db, c.req.param('projectId')).map((tool) => ({ name: tool.name, description: describeTool(tool, 'terminal'), changes: tool.changes, input: jsonSchemaOf(tool.schema) }))),
  )
  /** One tool call from the terminal (callTool): a change answers with its proposal, anything else with its whole result. */
  .post('/projects/:projectId/tools/:name', validate('json', z.record(z.string(), z.unknown())), async (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const tool = agentCatalog(db, projectId).find((candidate) => candidate.name === c.req.param('name'));
    if (!tool) return badRequest(`없거나 꺼진 도구입니다: ${c.req.param('name')}`);
    const outcome = await callTool(db, { projectId, surface: 'terminal', sessionId: null }, tool, c.req.valid('json'));
    if (outcome.kind === 'invalid') return badRequest(outcome.error);
    if (outcome.kind === 'refused') return badRequest(refusalText(outcome));
    if (outcome.kind === 'proposal') return c.json({ proposed: true as const, proposalId: outcome.proposalId, applied: outcome.applied, status: outcome.status, result: outcome.result ?? null, review: outcome.review ?? null, message: outcome.text, report: outcome.report });
    return c.json({ proposed: false as const, result: outcome.result });
  })
  /** Projects by name, so the CLI can take `--project <name>`. */
  .get('/cli/projects', (c) => {
    const { db } = c.var.deps;
    return c.json(db.select({ id: s.projects.id, name: s.projects.name }).from(s.projects).all());
  })
  .get('/projects/:projectId/proposals/:id', (c) => {
    const { db } = c.var.deps;
    return c.json(found(db.select().from(s.proposals).where(and(eq(s.proposals.id, c.req.param('id')), eq(s.proposals.projectId, c.req.param('projectId')))).get(), '제안'));
  });
