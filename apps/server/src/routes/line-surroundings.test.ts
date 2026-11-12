import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@loca/shared';
import { onError, type Env } from '../http.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';

describe('line surroundings', () => {
  it('names the immediate same-group lines by id across a paginated list boundary, and repeats nothing of the row', async () => {
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
    const app = new Hono<Env>().onError(onError)
      .use(async (context, next) => {
        context.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);

    const unit = (key: string) => db.select().from(s.units).where(eq(s.units.key, key)).get()!;
    const response = await app.request(`/units/${target.id}/surroundings`);
    expect(response.status).toBe(200);
    const detail = await response.json() as Record<string, unknown>;
    // Ids only: the neighbours' words are the browser's own rows of them.
    expect(detail).toEqual({ id: target.id, neighbors: { previous: unit('u8').id, next: unit('u10').id }, graphNodes: [{ id: expect.any(String), key: 'u9' }], speech: null, sceneNames: expect.any(Array) });

    const page = await app.request(`/projects/${projectId}/units/surroundings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [unit('u0').id, unit('u10').id, 'gone'] }) });
    const { rows } = await page.json() as { rows: { id: string; neighbors: { previous: string | null; next: string | null } }[] };
    expect(rows.map((row) => [row.id, row.neighbors])).toEqual([
      [unit('u0').id, { previous: null, next: unit('u1').id }],
      [unit('u10').id, { previous: unit('u9').id, next: null }],
    ]);
  });
});
