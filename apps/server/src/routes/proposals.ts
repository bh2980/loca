import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { decideProposal, listedProposal } from '../services/proposals.ts';
import { continueAfterDecisions } from '../services/chat-run.ts';

/** Changes proposed by pi chat sessions and the CLI, decided in the chat panel. */
export const proposalRoutes = new Hono<Env>()
  .get('/projects/:projectId/proposals', validate('query', z.object({ session: z.string().optional() })), (c) => {
    const { db } = c.var.deps;
    const { session } = c.req.valid('query');
    const scope = session ? eq(s.proposals.sessionId, session) : isNull(s.proposals.sessionId);
    return c.json(
      db
        .select()
        .from(s.proposals)
        .where(and(eq(s.proposals.projectId, c.req.param("projectId")), scope))
        .orderBy(desc(s.proposals.createdAt))
        .limit(100)
        .all()
        .map(listedProposal),
    );
  })
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
  });
