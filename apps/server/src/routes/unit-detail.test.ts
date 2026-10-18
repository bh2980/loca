import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';

describe('unit detail neighbors', () => {
  it('returns the immediate same-group lines across a paginated list boundary', async () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'P' },
      groups: [{ key: 'scene', title: 'Scene' }],
      units: Array.from({ length: 11 }, (_, index) => ({
        key: `u${index}`,
        group: 'scene',
        kind: 'dialogue',
        speaker: `Speaker ${index}`,
        source: `Line ${index}`,
        translation: `Translation ${index}`,
      })),
    });
    const { projectId } = importProject(db, file, null as never);
    const target = db.select().from(s.units).where(eq(s.units.key, 'u9')).get()!;
    const app = new Hono<Env>()
      .use(async (context, next) => {
        context.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);

    const response = await app.request(`/units/${target.id}`);
    expect(response.status).toBe(200);
    const detail = await response.json() as {
      projectId: string;
      neighbors: {
        previous: { id: string; source: string; translation: string | null } | null;
        next: { id: string; source: string; translation: string | null } | null;
      };
    };
    expect(detail.projectId).toBe(projectId);
    expect(detail.neighbors.previous).toMatchObject({ source: 'Line 8', translation: 'Translation 8' });
    expect(detail.neighbors.next).toMatchObject({ source: 'Line 10', translation: 'Translation 10' });
  });
});
