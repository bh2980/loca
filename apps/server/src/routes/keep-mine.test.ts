import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { onError, type Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { LINE_CHANGED } from '../services/line-save.ts';
import { sourceRoutes } from './source.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hello' }] });
  const { projectId } = importProject(db, file, null as never);
  const app = new Hono<Env>().onError(onError)
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes);
  const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
  const send = (body: unknown) => app.request(`/units/${unit.id}/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const current = () => db.select().from(s.candidates).where(eq(s.candidates.id, db.select({ id: s.units.candidateId }).from(s.units).where(eq(s.units.id, unit.id)).get()!.id!)).get()!;
  /** The line's rev as a browser that read it now would hold it. */
  const rev = () => db.select({ updatedAt: s.units.updatedAt }).from(s.units).where(eq(s.units.id, unit.id)).get()!.updatedAt.getTime();
  return { send, current, rev };
}

describe('내 수정 유지', () => {
  it('saves over a change made meanwhile and says so on the person\'s text; without it the save is refused', async () => {
    const { send, current, rev } = setup();
    await send({ text: '안녕' });
    const read = rev();
    // Changed elsewhere while the person typed from '안녕'.
    await send({ text: '안녕하세요' });
    const refused = await send({ text: '안녕!', rev: read });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: LINE_CHANGED });
    // The person saw the change and kept their own text: the save is made from the line as it is now.
    expect((await send({ text: '안녕!', rev: rev(), keepMine: true })).status).toBe(200);
    expect(current()).toMatchObject({ text: '안녕!', origin: 'human', note: '그사이 바뀐 번역 대신 내 수정을 유지함' });
  });
});
