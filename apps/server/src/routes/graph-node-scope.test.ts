import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';

const fixture = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'Graph node scope fixture' },
  groups: [{ key: 'scene', kind: 'scene', title: 'Scene' }],
  units: [{ key: 'line', group: 'scene', source: 'Scoped source' }],
  graph: {
    nodes: [{ key: 'script', kind: 'script', units: ['line'] }],
    edges: [],
  },
});

function setup() {
  const db = openDatabase(':memory:');
  const first = importProject(db, fixture, null as never).projectId;
  const second = importProject(db, fixture, null as never).projectId;
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes);
  const nodeId = (projectId: string) => db.select({ id: s.graphNodes.id }).from(s.graphNodes)
    .where(eq(s.graphNodes.projectId, projectId)).get()!.id;
  const get = (id: string, projectId?: string) => app.request(
    `/graph-nodes/${id}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
  );
  return { first, second, nodeId, get };
}

describe('graph node project scope', () => {
  it('returns details for a node in the requested project', async () => {
    const { first, nodeId, get } = setup();
    const response = await get(nodeId(first), first);
    expect(response.status).toBe(200);
    expect((await response.json() as { projectId: string }).projectId).toBe(first);
  });

  it('404s before returning details when a node belongs to another project', async () => {
    const { first, second, nodeId, get } = setup();
    const response = await get(nodeId(second), first);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Scoped source');
  });

  it('preserves the existing unscoped lookup for current callers', async () => {
    const { second, nodeId, get } = setup();
    const response = await get(nodeId(second));
    expect(response.status).toBe(200);
    expect((await response.json() as { projectId: string }).projectId).toBe(second);
  });
});
