import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { Env } from '../context.ts';
import { sourceRoutes } from './source.ts';

describe('graph layout direction variants', () => {
  it('serves each stored orientation with its original ELK edges intact', async () => {
    const db = openDatabase(':memory:');
    const project = db.insert(s.projects).values({ name: 'Direction fixture', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
    db.insert(s.graphNodes).values([
      { id: 'n1', projectId: project.id, key: 'one', kind: 'state', unitIds: [] },
      { id: 'n2', projectId: project.id, key: 'two', kind: 'state', unitIds: [] },
    ]).run();
    const verticalEdge = { id: 'e-v', from: 'n1', to: 'n2', points: [130, 100, 130, 160] };
    const horizontalEdge = { id: 'e-h', from: 'n1', to: 'n2', points: [260, 38, 320, 38] };
    db.insert(s.graphLayouts).values([
      { projectId: project.id, scope: 'dialogue', section: '', direction: 'vertical', status: 'ready', data: { version: 8, width: 280, height: 220, nodes: [{ id: 'n1', x: 0, y: 0, width: 260, height: 76 }, { id: 'n2', x: 0, y: 144, width: 260, height: 76 }], edges: [verticalEdge] } },
      { projectId: project.id, scope: 'dialogue', section: '', direction: 'horizontal', status: 'ready', data: { version: 8, width: 600, height: 76, nodes: [{ id: 'n1', x: 0, y: 0, width: 260, height: 76 }, { id: 'n2', x: 320, y: 0, width: 260, height: 76 }], edges: [horizontalEdge] } },
    ]).run();
    const app = new Hono<Env>().use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    }).route('/', sourceRoutes);
    try {
      const read = async (direction: 'vertical' | 'horizontal') => (await app.request(`/projects/${project.id}/graph/dialogue?direction=${direction}`)).json() as Promise<{ status: string; layout: { edges: typeof verticalEdge[] } }>;
      const [vertical, horizontal] = await Promise.all([read('vertical'), read('horizontal')]);
      expect(vertical.status).toBe('ready');
      expect(vertical.layout.edges).toEqual([verticalEdge]);
      expect(horizontal.status).toBe('ready');
      expect(horizontal.layout.edges).toEqual([horizontalEdge]);
    } finally {
      db.$client.close();
    }
  });
});
