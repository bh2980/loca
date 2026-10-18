import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';

describe('listener filter choices', () => {
  it('counts known listeners and uses the shared unknown mark rules', async () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'P' },
      groups: [{ key: 'g', title: 'G' }],
      units: Array.from({ length: 6 }, (_, n) => ({ key: `u${n}`, group: 'g', source: `Line ${n}` })),
    });
    const { projectId } = importProject(db, file, null as never);
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
    db.update(s.units).set({ kind: 'dialogue', speaker: 'Ann' }).where(eq(s.units.projectId, projectId)).run();
    db.update(s.units).set({ listener: 'Bob', listenerOrigin: 'human' }).where(eq(s.units.id, units[0]!.id)).run();
    db.update(s.units).set({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.95 }).where(eq(s.units.id, units[1]!.id)).run();
    db.update(s.units).set({ listener: 'group', listenerOrigin: 'human' }).where(eq(s.units.id, units[2]!.id)).run();
    db.update(s.units).set({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.5 }).where(eq(s.units.id, units[3]!.id)).run();
    db.update(s.units).set({ speaker: null }).where(eq(s.units.id, units[5]!.id)).run();

    const response = await app.request(`/projects/${projectId}/listeners`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      listeners: [{ name: 'Bob', lines: 2 }, { name: 'group', lines: 1 }],
      unknownCount: 2,
    });
  });
});
