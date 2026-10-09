import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { decideProposal } from '../services/proposals.ts';

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
        .all(),
    );
  })
  .post('/proposals/:id/:action{accept|reject}', async (c) => {
    try {
      return c.json(await decideProposal(c.var.deps.db, c.req.param('id'), c.req.param('action') === 'accept'));
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }
  });
