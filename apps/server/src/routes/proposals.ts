import { Hono } from 'hono';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { decideProposal, listedProposal, proposalRuns, undoProposals } from '../services/proposals.ts';
import { continueAfterDecisions } from '../services/chat-run.ts';

/** Changes proposed by CLI chats and the loca CLI, decided in the chat panel. */
export const proposalRoutes = new Hono<Env>()
  // Without `session`: everything not tied to a chat (the CLI's and the workflows' apply nodes), newest first.
  // `status` filters, `runId` narrows to one run's proposals; page with limit/offset (x-total-count is the full count).
  .get(
    '/projects/:projectId/proposals',
    validate('query', z.object({
      session: z.string().optional(),
      status: z.enum(['pending', 'running', 'accepted', 'rejected', 'failed']).optional(),
      runId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
      offset: z.coerce.number().int().min(0).default(0),
    })),
    (c) => {
      const { db } = c.var.deps;
      const { session, status, runId, limit, offset } = c.req.valid('query');
      const where = and(
        eq(s.proposals.projectId, c.req.param('projectId')),
        session ? eq(s.proposals.sessionId, session) : isNull(s.proposals.sessionId),
        status ? eq(s.proposals.status, status) : undefined,
        runId ? eq(s.proposals.runId, runId) : undefined,
      );
      const rows = db.select().from(s.proposals).where(where).orderBy(desc(s.proposals.createdAt)).limit(limit).offset(offset).all();
      const runs = proposalRuns(db, rows);
      c.header('x-total-count', String(db.select({ count: count() }).from(s.proposals).where(where).get()!.count));
      return c.json(rows.map((row) => listedProposal(row, row.runId ? (runs.get(row.runId) ?? null) : null)));
    },
  )
  // Many at once (a run can file hundreds): decided one after the other, oldest first (characters before the
  // relationships that name them), each claimed like a single decision. One that fails does not stop the rest.
  .post(
    '/projects/:projectId/proposals/decide',
    validate('json', z.object({ ids: z.array(z.string()).min(1).max(5000), action: z.enum(['accept', 'reject']), reason: z.string().trim().max(1000).optional() })),
    async (c) => {
      const { db } = c.var.deps;
      const { ids, action, reason } = c.req.valid('json');
      const rows = db.select().from(s.proposals).where(and(eq(s.proposals.projectId, c.req.param('projectId')), inArray(s.proposals.id, ids))).all().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const results: { id: string; status: string; error?: string }[] = ids.filter((id) => !rows.some((row) => row.id === id)).map((id) => ({ id, status: 'missing', error: '제안을 찾을 수 없습니다.' }));
      const sessions = new Set<string>();
      for (const proposal of rows) {
        try {
          const row = await decideProposal(db, proposal.id, action === 'accept', 'person', reason || null);
          results.push({ id: row.id, status: row.status, ...(row.status === 'failed' && { error: JSON.stringify(row.result).slice(0, 300) }) });
          if (row.sessionId && row.status !== 'pending' && row.status !== 'running') sessions.add(row.sessionId);
        } catch (error) {
          results.push({ id: proposal.id, status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
      }
      for (const sessionId of sessions) continueAfterDecisions(c.var.deps, sessionId);
      return c.json({ results });
    },
  )
  // A rejection may say why; the agent hears it with the decision (takeDecisions).
  .post('/proposals/:id/:action{accept|reject}', validate('json', z.object({ reason: z.string().trim().max(1000).optional() })), async (c) => {
    try {
      const row = await decideProposal(c.var.deps.db, c.req.param('id'), c.req.param('action') === 'accept', 'person', c.req.valid('json').reason || null);
      // The agent hears the results and carries on once the conversation has nothing left to decide (#43).
      if (row.sessionId && row.status !== 'pending' && row.status !== 'running') continueAfterDecisions(c.var.deps, row.sessionId);
      return c.json(row);
    } catch (error) {
      badRequest(error instanceof Error ? error.message : String(error));
    }
  })
  .post('/chat/:sessionId/undo', validate('json', z.object({ ids: z.array(z.string()).min(1).max(500) })), async (c) => {
    return c.json(await undoProposals(c.var.deps.db, c.req.param('sessionId'), c.req.valid('json').ids));
  });
