import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { applyIssueTags } from '../services/issue-tags.ts';
import { sourceRoutes } from './source.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'P' },
    groups: [{ key: 'g', title: 'G' }],
    units: [
      { key: 'a', group: 'g', source: 'Hello' },
      { key: 'b', group: 'g', source: 'Goodbye' },
    ],
  });
  const { projectId } = importProject(db, file, null as never);
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes);
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
  const finalStatus = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'final'))).get()!;
  const send = (method: string, url: string, body: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const issueTag = (unitId: string) => applyIssueTags(db, projectId, unitId, { add: ['format'] });
  const tagsOf = (unitId: string) => db.select({ tagId: s.unitTags.tagId }).from(s.unitTags).where(eq(s.unitTags.unitId, unitId)).all().map(({ tagId }) => tagId);
  const line = (unitId: string) => db.select({ translation: s.units.translation, statusId: s.units.statusId, candidateId: s.units.candidateId }).from(s.units).where(eq(s.units.id, unitId)).get()!;
  const candidatesOf = (unitId: string) => db.select().from(s.candidates).where(eq(s.candidates.unitId, unitId)).all();
  return { db, projectId, units, finalStatus, send, issueTag, tagsOf, line, candidatesOf };
}

describe('final statuses require a translation', () => {
  it('refuses a whitespace save before adding a candidate or clearing issue tags', async () => {
    const { units, finalStatus, send, issueTag, tagsOf, candidatesOf } = setup();
    const unit = units[0]!;
    issueTag(unit.id);
    const tagsBefore = tagsOf(unit.id);

    const response = await send('POST', `/units/${unit.id}/save`, { text: '  \n', statusId: finalStatus.id });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('완료 상태에는 번역이 있어야 합니다.');
    expect(candidatesOf(unit.id)).toEqual([]);
    expect(tagsOf(unit.id)).toEqual(tagsBefore);
  });

  it('refuses a blank candidate before replacing text or clearing issue tags', async () => {
    const { db, units, finalStatus, send, issueTag, tagsOf, line, candidatesOf } = setup();
    const unit = units[0]!;
    await send('POST', `/units/${unit.id}/save`, { text: '기존 번역' });
    issueTag(unit.id);
    const blank = db.insert(s.candidates).values({ unitId: unit.id, text: ' \t ', origin: 'human' }).returning().get();
    const tagsBefore = tagsOf(unit.id);
    const candidatesBefore = candidatesOf(unit.id);
    const lineBefore = line(unit.id);

    const response = await send('POST', `/units/${unit.id}/save`, { candidateId: blank.id, statusId: finalStatus.id });

    expect(response.status).toBe(400);
    expect(line(unit.id)).toEqual(lineBefore);
    expect(candidatesOf(unit.id)).toEqual(candidatesBefore);
    expect(tagsOf(unit.id)).toEqual(tagsBefore);
  });

  it('does not let a final line be cleared while retaining its final status', async () => {
    const { units, finalStatus, send, line } = setup();
    const unit = units[0]!;
    await send('POST', `/units/${unit.id}/save`, { text: '번역문', statusId: finalStatus.id });
    const before = line(unit.id);

    const response = await send('POST', `/units/${unit.id}/save`, { text: '  ', base: '번역문' });

    expect(response.status).toBe(400);
    expect(line(unit.id)).toEqual(before);
  });

  it('prevalidates every selected line before a bulk move to final', async () => {
    const { projectId, units, finalStatus, send, line } = setup();
    const [translated, blank] = units;
    await send('POST', `/units/${translated!.id}/save`, { text: '있음' });
    const before = [line(translated!.id), line(blank!.id)];

    const response = await send('PATCH', `/projects/${projectId}/units`, { unitIds: [translated!.id, blank!.id], statusId: finalStatus.id });

    expect(response.status).toBe(400);
    expect([line(translated!.id), line(blank!.id)]).toEqual(before);
  });

  it('allows nonblank text to be saved with a final status', async () => {
    const { units, finalStatus, send, line } = setup();
    const unit = units[0]!;

    const response = await send('POST', `/units/${unit.id}/save`, { text: '완성된 번역', statusId: finalStatus.id });

    expect(response.status).toBe(200);
    expect(line(unit.id)).toMatchObject({ translation: '완성된 번역', statusId: finalStatus.id });
  });
});
