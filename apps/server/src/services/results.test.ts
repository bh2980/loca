import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { importFileSchema, resultRequestSchema, type ResultRequest } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { scriptRoutes } from '../routes/script.ts';
import { importProject } from './importer.ts';
import { resultCheck, resultFile, resultPlan } from './results.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1',
    project: { name: '릴레이 "역"' },
    groups: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
    units: [
      { key: 'done', group: 'a', source: 'Hello {NAME}', meta: { voice: 'v1' } },
      { key: 'broken', group: 'a', source: 'Bye {NAME}' },
      { key: 'draft', group: 'a', source: 'Draft {NAME}' },
      { key: 'blank', group: 'b', source: 'Blank' },
      { key: 'skip', group: 'b', source: '---' },
    ],
  }));
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const final = statuses.find((status) => status.kind === 'final')!;
  const middle = statuses.find((status) => status.kind !== 'final')!;
  const set = (key: string, statusId: string, translation: string | null) => db.update(s.units).set({ statusId, translation }).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).run();
  set('done', final.id, '안녕 {NAME}');
  // Final, but the placeholder is gone: goes in, and is warned about.
  set('broken', final.id, '잘 가');
  // Translated but not finished; its placeholder is gone too, which matters only if it goes in.
  set('draft', middle.id, '초안');
  // Final with nothing to put in.
  set('blank', final.id, null);
  // Not meant to be translated, even with a translation in a final status.
  set('skip', final.id, '---번역');
  return { db, projectId, final, middle };
}

const ask = (request: ResultRequest = {}) => resultRequestSchema.parse(request);
const byKey = (file: ReturnType<typeof resultFile>) => new Map(file!.units.map((unit) => [unit.key, unit]));

describe('the file for the game', () => {
  it('puts in the final statuses by default and the source for the rest, marked, so every key is there', () => {
    const { db, projectId } = setup();
    const units = byKey(resultFile(db, projectId, ask()));
    expect([...units.keys()]).toEqual(['done', 'broken', 'draft', 'blank', 'skip']);
    expect(units.get('done')).toMatchObject({ translation: '안녕 {NAME}', meta: { voice: 'v1' } });
    expect(units.get('done')).not.toHaveProperty('fromSource');
    for (const [key, source] of [['draft', 'Draft {NAME}'], ['blank', 'Blank'], ['skip', '---']] as const) expect(units.get(key)).toMatchObject({ translation: source, fromSource: true });
  });

  it('leaves the rest out when asked', () => {
    const { db, projectId } = setup();
    expect([...byKey(resultFile(db, projectId, ask({ rest: 'omit' }))).keys()]).toEqual(['done', 'broken']);
  });

  it('puts in the statuses chosen, by id or by name', () => {
    const { db, projectId, middle } = setup();
    for (const chosen of [middle.id, middle.name]) {
      const units = byKey(resultFile(db, projectId, ask({ statuses: [chosen], rest: 'omit' })));
      expect([...units.keys()]).toEqual(['draft']);
    }
  });

  it('narrows to the filter: groups, or the lines picked by id', () => {
    const { db, projectId } = setup();
    expect([...byKey(resultFile(db, projectId, ask({ filter: { groups: ['b'] } }))).keys()]).toEqual(['blank', 'skip']);
    const id = db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'draft'))).get()!.id;
    expect([...byKey(resultFile(db, projectId, ask({ filter: { ids: [id] } }))).keys()]).toEqual(['draft']);
  });

  it('is more than one page of a list', () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: Array.from({ length: 450 }, (_, n) => ({ key: `u${n}`, group: 'g', source: `Line ${n}` })) }));
    expect(resultFile(db, projectId, ask())!.units).toHaveLength(450);
    expect(resultPlan(db, projectId, ask()).inFile).toBe(450);
  });

  it('is nothing without the project', () => {
    const { db } = setup();
    expect(resultFile(db, 'missing', ask())).toBeUndefined();
  });
});

describe('what the dialog says about it', () => {
  it('counts what goes in and says why the rest does not', () => {
    const { db, projectId, final, middle } = setup();
    const plan = resultPlan(db, projectId, ask());
    expect(plan).toMatchObject({ total: 5, translated: 2, inFile: 5, rest: { total: 3, excluded: 1, empty: 1, statuses: { [middle.id]: 1 } } });
    // A status lists its lines meant to be translated: 번역 제외 is told apart.
    expect(plan.statuses).toEqual({ [final.id]: 3, [middle.id]: 1 });
    expect(plan.sample.map((unit) => unit.key)).toEqual(['done', 'broken', 'draft']);
    const omitted = resultPlan(db, projectId, ask({ rest: 'omit' }));
    expect(omitted).toMatchObject({ inFile: 2, translated: 2, rest: { total: 3 } });
    expect(omitted.sample.map((unit) => unit.key)).toEqual(['done', 'broken']);
  });

  it('names a chosen status that does not exist', () => {
    const { db, projectId, middle } = setup();
    expect(resultPlan(db, projectId, ask({ statuses: [middle.name, '오타'] })).unknownStatuses).toEqual(['오타']);
    expect(resultPlan(db, projectId, ask()).unknownStatuses).toEqual([]);
  });

  it('warns only about lines whose translation goes in', async () => {
    const { db, projectId, middle } = setup();
    const check = await resultCheck(db, projectId, ask());
    expect(check.total).toBe(1);
    expect(check.rows.map((row) => row.key)).toEqual(['broken']);
    expect((await resultCheck(db, projectId, ask({ statuses: [middle.id] }))).rows.map((row) => row.key)).toEqual(['draft']);
  });
});

describe('the route', () => {
  it('names the file after the project, encoded, and says when the project is not there', async () => {
    const { db, projectId } = setup();
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', scriptRoutes);
    const post = (id: string) => app.request(`/projects/${id}/results`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"rest":"omit"}' });
    const response = await post(projectId);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${encodeURIComponent('릴레이 "역"')}-translations.json"`);
    expect(await response.json()).toMatchObject({ format: 'translation-workbench/translations-v1', units: [{ key: 'done' }, { key: 'broken' }] });
    expect((await post('missing')).status).toBe(404);
  });
});
