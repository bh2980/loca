import { Hono } from 'hono';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { batchChangeSchema, lineFilterSchema } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { proposeChange } from '../services/change-gate.ts';
import { undoProposals } from '../services/proposals.ts';
import { runErrors } from '../services/run-errors.ts';
import { agentCatalog, jsonSchemaOf } from '../services/agent-catalog.ts';
import { previewContext } from '../services/context-preview.ts';
import { checkBatch, refusalText } from '../services/proposal-check.ts';
import { fitResult } from '../services/tool-output.ts';
import { viewFlow } from '../services/view-flow.ts';
import { inChunks } from '../db/chunk.ts';
import { checkScript, exportLines, findLines, firstAppearance, lineContext, runStats, sceneStats, scenesWith } from '../services/script-query.ts';

/**
 * The script API behind the `loca` CLI. Reading answers directly; writing (import, change tools)
 * becomes one proposal, decided by the project's terminal permission mode like a conversation's.
 */
export const scriptRoutes = new Hono<Env>()
  .get('/projects/:projectId/speakers', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const rows = db.select({ speaker: s.units.speaker, lines: count() }).from(s.units).where(eq(s.units.projectId, projectId)).groupBy(s.units.speaker).orderBy(desc(count())).all();
    const characters = db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all();
    return c.json(
      rows.map((row) => ({ ...row, character: row.speaker ? (characters.find((character) => [character.name, ...character.aliases].includes(row.speaker!))?.name ?? null) : null })),
    );
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
    '/projects/:projectId/checks/:kind{terms|consistency|format|length|speech}',
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
  /** Check a batch; unless dryRun, the valid, non-conflicting lines become one proposal. */
  .post('/projects/:projectId/import', validate('json', batchChangeSchema.extend({ dryRun: z.boolean().default(false) })), async (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { dryRun, ...raw } = c.req.valid('json');
    const { batch, unchanged, report: checked } = await checkBatch(db, projectId, raw);
    if (!batch.changes.length && !checked.errors.length) return c.json({ total: raw.changes.length, unchanged: unchanged.length, changes: 0, conflicts: [], errors: [], warnings: [], proposalId: null });
    const report = { ...checked, total: raw.changes.length, unchanged: unchanged.length };
    if (dryRun) return c.json({ ...report, proposalId: null });
    if (!agentCatalog(db, projectId).some((tool) => tool.name === 'propose_changes')) badRequest('에이전트 설정에서 ‘여러 대사 한꺼번에 변경’이 꺼져 있습니다.');
    if (batch.changes.length === report.errors.length + report.conflicts.length) return c.json({ ...report, proposalId: null });
    // Through the same gate as every change tool, so the terminal permission mode decides it. The gate checks the
    // batch again and leaves out the same rows, which it records: auto review asks when any were left out.
    const gate = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: 'propose_changes', input: raw, terminal: true });
    if (!gate.ok && /바꿀 수 있는 줄이 없습니다|바뀌는 내용이 없습니다/.test(gate.error)) return c.json({ ...report, proposalId: null });
    if (!gate.ok) badRequest(refusalText(gate));
    return c.json({ ...report, proposalId: gate.proposalId, applied: gate.applied, status: gate.status, review: gate.review ?? null });
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
    return c.json({
      view: flow.view,
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
  /** Undo changes the terminal permission mode applied (not ones a person accepted), newest first. */
  .post('/projects/:projectId/proposals/undo', validate('json', z.object({ ids: z.array(z.string()).min(1).max(500) })), async (c) =>
    c.json(await undoProposals(c.var.deps.db, { terminal: c.req.param('projectId') }, c.req.valid('json').ids)),
  )
  /** Every agent tool, for `loca tools` / `loca call`. Change tools return a proposal instead of running. */
  .get('/projects/:projectId/tools', (c) =>
    c.json(agentCatalog(c.var.deps.db, c.req.param('projectId')).map((tool) => ({ name: tool.name, description: tool.description, changes: tool.changes, input: jsonSchemaOf(tool.schema) }))),
  )
  .post('/projects/:projectId/tools/:name', validate('json', z.record(z.string(), z.unknown())), async (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const tool = agentCatalog(db, projectId).find((candidate) => candidate.name === c.req.param('name'));
    if (!tool) badRequest(`없거나 꺼진 도구입니다: ${c.req.param('name')}`);
    const input = c.req.valid('json');
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) badRequest(`입력이 맞지 않습니다: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
    if (tool.changes) {
      const gate = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: tool.name, input: parsed.data as Record<string, unknown>, terminal: true });
      if (!gate.ok) badRequest(refusalText(gate));
      return c.json({ proposed: true, proposalId: gate.proposalId, applied: gate.applied, status: gate.status, result: gate.result ?? null, review: gate.review ?? null, message: gate.text, report: gate.report });
    }
    return c.json({ proposed: false, result: fitResult(await tool.run(parsed.data)) });
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
