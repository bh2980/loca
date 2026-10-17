import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';

function setup() {
  const db = openDatabase(':memory:');
  const sources = ['Run!', 'run', 'Run.', 'Walk'];
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: sources.map((source, n) => ({ key: `u${n}`, group: 'g', source })) });
  const { projectId } = importProject(db, file, null as never);
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes);
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
  const post = (url: string, body: unknown) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = (id: string) => db.select({ translation: s.units.translation }).from(s.units).where(eq(s.units.id, id)).get()?.translation ?? null;
  return { db, units, post, text };
}

describe('same-source apply in one request (#49)', () => {
  it('writes every same-source line in one go, as a person’s save', async () => {
    const { db, units, post, text } = setup();
    const [first, second, third] = units;
    const response = await post(`/units/${first!.id}/same-source`, { text: '달려!', lines: [{ unitId: second!.id, base: '' }, { unitId: third!.id, base: '' }] });
    expect(await response.json()).toMatchObject({ ok: true, applied: 2, skipped: 0 });
    expect([text(second!.id), text(third!.id)]).toEqual(['달려!', '달려!']);
    const row = db.select({ statusBy: s.units.statusBy }).from(s.units).where(eq(s.units.id, second!.id)).get();
    expect(row?.statusBy).toBe('human');
  });

  it('skips a line changed since it was shown, and one that does not share the source', async () => {
    const { units, post, text } = setup();
    const [first, second, third, other] = units;
    await post(`/units/${second!.id}/save`, { text: '뛰어' });
    const response = await post(`/units/${first!.id}/same-source`, { text: '달려!', lines: [{ unitId: second!.id, base: '' }, { unitId: third!.id, base: '' }, { unitId: other!.id, base: '' }] });
    expect(await response.json()).toMatchObject({ applied: 1, skipped: 2 });
    expect([text(second!.id), text(third!.id), text(other!.id)]).toEqual(['뛰어', '달려!', null]);
  });
});
