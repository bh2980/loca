import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { fileRunProposal } from '../services/proposals.ts';
import { proposalRoutes } from './proposals.ts';

describe('proposal routes', () => {
  it('lists run proposals with their run, filters by status, and decides many at once oldest first', async () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u0', group: 'g', source: 'Hi' }] }));
    const app = new Hono<Env>().use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', proposalRoutes);
    const workflow = db.insert(s.workflows).values({ projectId, name: 'wf', definition: { nodes: [], edges: [], settings: {} } as never }).returning().get();
    const run = db.insert(s.runs).values({ projectId, workflowId: workflow.id, workflowName: 'wf', workflowVersion: 1, status: 'completed', definition: workflow.definition, scope: {}, models: {}, total: 0 } as never).returning().get();
    const first = fileRunProposal(db, { projectId, runId: run.id, nodeId: 'n', tool: 'save_knowledge', input: { characters: [{ name: 'Alice' }] } });
    const second = fileRunProposal(db, { projectId, runId: run.id, nodeId: 'n', tool: 'save_knowledge', input: { relationships: [{ from: 'Alice', to: 'Alice', kind: '자기' }] } });
    db.update(s.proposals).set({ createdAt: new Date(Date.now() - 1000) }).where(eq(s.proposals.id, first.id)).run();
    const listed = await (await app.request(`/projects/${projectId}/proposals?status=pending`)).json() as { id: string; source: string; run: { workflow: string } }[];
    expect(listed.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    expect(listed[0]).toMatchObject({ source: 'run', run: { id: run.id, workflow: 'wf' } });
    const none = await (await app.request(`/projects/${projectId}/proposals?status=accepted`)).json();
    expect(none).toEqual([]);
    const decided = await (await app.request(`/projects/${projectId}/proposals/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [second.id, first.id, 'nope'], action: 'accept' }) })).json() as { results: { id: string; status: string }[] };
    // The character is saved before the relationship that names it, whatever order the ids came in.
    expect(decided.results.filter((r) => r.status !== 'missing').map((r) => [r.id, r.status])).toEqual([[first.id, 'accepted'], [second.id, 'accepted']]);
    expect(decided.results.find((r) => r.id === 'nope')?.status).toBe('missing');
    expect(db.select().from(s.relationships).all()).toHaveLength(1);
  });
});
