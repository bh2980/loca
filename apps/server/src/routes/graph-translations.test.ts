import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import { importProject } from '../services/importer.ts';
import * as s from '../db/schema.ts';
import type { Env } from '../context.ts';
import { sourceRoutes } from './source.ts';

describe('the translations of a graph\'s cards', () => {
  it("come from the card's first line, which the graph names for the nodes of the section", async () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Cards' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u1', group: 'g', source: 'Hello' }, { key: 'u2', group: 'g', source: 'Bye' }, { key: 'u3', group: 'g', source: 'Elsewhere' }] }));
    const project = { id: projectId };
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    const byKey = (key: string) => db.select().from(s.units).where(eq(s.units.key, key)).get()!;
    const [done, empty, other] = [byKey('u1'), byKey('u2'), byKey('u3')];
    db.update(s.units).set({ translation: '  안녕하세요  ' }).where(eq(s.units.id, done.id)).run();
    db.update(s.units).set({ translation: '다른 곳' }).where(eq(s.units.id, other.id)).run();
    db.insert(s.graphNodes).values([
      { id: 'n1', projectId: project.id, key: 'one', kind: 'script', groupId: group.id, unitIds: [done.id] },
      { id: 'n2', projectId: project.id, key: 'two', kind: 'script', groupId: group.id, unitIds: [empty.id] },
      { id: 'n3', projectId: project.id, key: 'three', kind: 'script', groupId: group.id, unitIds: [other.id] },
    ]).run();
    // The section's layout draws n1 and n2 (n3 belongs to another section).
    db.insert(s.graphLayouts).values({ projectId: project.id, scope: 'dialogue', section: 'S', direction: 'vertical', status: 'ready', data: { version: 9, width: 300, height: 200, nodes: [{ id: 'n1', x: 0, y: 0, width: 260, height: 76 }, { id: 'n2', x: 0, y: 140, width: 260, height: 76 }], edges: [] } }).run();
    const app = new Hono<Env>().use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    }).route('/', sourceRoutes);
    try {
      // The section's graph names each card's first line; its translation is read from the browser's units collection.
      const graph = (await (await app.request(`/projects/${project.id}/graph/dialogue?section=S`)).json()) as { nodes: { id: string; unitId: string | null }[] };
      const lines = graph.nodes.map((node) => node.unitId);
      expect(lines).toEqual(expect.arrayContaining([done.id, empty.id]));
      expect(lines).not.toContain(other.id);
    } finally {
      db.$client.close();
    }
  });
});
