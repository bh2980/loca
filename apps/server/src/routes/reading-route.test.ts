import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';

const fixture = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'Reading route API fixture', sourceLanguage: 'ko', targetLanguage: 'en' },
  groups: [{ key: 'scene', kind: 'scene', title: 'Scene' }],
  units: [
    { key: 'u.before', group: 'scene', source: 'Before' },
    { key: 'u.start', group: 'scene', source: 'Start' },
    { key: 'u.middle', group: 'scene', source: 'Middle' },
    { key: 'u.end', group: 'scene', source: 'End' },
    { key: 'u.after', group: 'scene', source: 'After' },
  ],
  graph: {
    nodeTypes: { Script: { kind: 'script', label: 'Script' }, State: { kind: 'state', label: 'State' } },
    nodes: [
      { key: 'n.before', kind: 'script', type: 'Script', units: ['u.before'] },
      { key: 'n.start', kind: 'script', type: 'Script', units: ['u.start'] },
      { key: 'n.control', kind: 'state', type: 'State', units: [] },
      { key: 'n.middle', kind: 'script', type: 'Script', units: ['u.middle'] },
      { key: 'n.end', kind: 'script', type: 'Script', units: ['u.end'] },
      { key: 'n.after', kind: 'script', type: 'Script', units: ['u.after'] },
    ],
    edges: [
      { from: 'n.before', to: 'n.start' }, { from: 'n.start', to: 'n.control' },
      { from: 'n.control', to: 'n.middle' }, { from: 'n.middle', to: 'n.end' }, { from: 'n.end', to: 'n.after' },
    ],
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
  const send = (url: string) => app.request(url);
  const id = (projectId: string, table: 'node' | 'unit', key: string) => {
    if (table === 'node') return db.select({ id: s.graphNodes.id, key: s.graphNodes.key }).from(s.graphNodes)
      .where(eq(s.graphNodes.projectId, projectId)).all().find((row) => row.key === key)!.id;
    return db.select({ id: s.units.id, key: s.units.key }).from(s.units)
      .where(eq(s.units.projectId, projectId)).all().find((row) => row.key === key)!.id;
  };
  const get = (projectId: string, start?: string, end?: string, via?: string) => {
    const query = new URLSearchParams();
    if (start !== undefined) query.set('start', start);
    if (end !== undefined) query.set('end', end);
    if (via !== undefined) query.set('via', via);
    return send(`/projects/${projectId}/reading-route${query.size ? `?${query}` : ''}`);
  };
  return { db, first, second, send, id, get };
}

const waitLoopFixture = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'Wait loop fixture', sourceLanguage: 'ko', targetLanguage: 'en' },
  groups: [{ key: 'scene', kind: 'scene', title: 'Scene' }],
  units: [
    { key: 'u.tower1', group: 'scene', source: 'Tower 1' },
    { key: 'u.tower2', group: 'scene', source: 'Tower 2' },
    { key: 'u.dawn', group: 'scene', source: 'Dawn arrived' },
  ],
  graph: {
    nodeTypes: {
      Script: { kind: 'script', label: 'Script' },
      Wait: { kind: 'wait', label: 'Wait' },
    },
    nodes: [
      { key: 'n.tower1', kind: 'script', type: 'Script', units: ['u.tower1'] },
      { key: 'n.tower2', kind: 'script', type: 'Script', units: ['u.tower2'] },
      { key: 'w.signal', kind: 'wait', type: 'Wait', units: [] },
      { key: 'e.dawn', kind: 'script', type: 'Script', units: ['u.dawn'] },
    ],
    edges: [
      { from: 'n.tower1', to: 'n.tower2' },
      { from: 'n.tower2', to: 'w.signal' },
      { from: 'w.signal', to: 'n.tower1', label: 'repeat' },
      { from: 'w.signal', to: 'e.dawn', label: 'decoded' },
    ],
  },
});

const containerFixture = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'Container fixture', sourceLanguage: 'ko', targetLanguage: 'en' },
  groups: [{ key: 'scene', kind: 'scene', title: 'Scene' }],
  units: [
    { key: 'u.comm1', group: 'scene', source: 'Commentary line 1' },
    { key: 'u.comm1_end', group: 'scene', source: 'Commentary line 1 end' },
    { key: 'u.comm2', group: 'scene', source: 'Commentary line 2' },
    { key: 'u.comm2_end', group: 'scene', source: 'Commentary line 2 end' },
  ],
  graph: {
    nodeTypes: {
      Container: { kind: 'state', label: 'Container' },
      Line: { kind: 'script', label: 'Line' },
    },
    nodes: [
      { key: 'c.cont1', kind: 'state', type: 'Container', units: [] },
      { key: 'l.comm1', kind: 'script', type: 'Line', units: ['u.comm1'] },
      { key: 'l.comm1_end', kind: 'script', type: 'Line', units: ['u.comm1_end'] },
      { key: 'c.cont2', kind: 'state', type: 'Container', units: [] },
      { key: 'l.comm2', kind: 'script', type: 'Line', units: ['u.comm2'] },
      { key: 'l.comm2_end', kind: 'script', type: 'Line', units: ['u.comm2_end'] },
      { key: 'n.exit', kind: 'state', type: 'Container', units: [] },
    ],
    edges: [
      { from: 'c.cont1', to: 'l.comm1' },
      { from: 'l.comm1', to: 'l.comm1_end', label: 'Sibling 0' },
      { from: 'c.cont1', to: 'c.cont2', label: 'Sibling 0' },
      { from: 'c.cont2', to: 'l.comm2' },
      { from: 'l.comm2', to: 'l.comm2_end', label: 'Sibling 0' },
      { from: 'c.cont2', to: 'n.exit', label: 'Sibling 0' },
    ],
  },
});

const branchFixture = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'Branch fixture', sourceLanguage: 'ko', targetLanguage: 'en' },
  groups: [{ key: 'scene', kind: 'scene', title: 'Scene' }],
  units: [
    { key: 'u.intro', group: 'scene', source: 'Intro line' },
    { key: 'u.choiceA', group: 'scene', source: 'Option A dialogue' },
    { key: 'u.choiceB', group: 'scene', source: 'Option B dialogue' },
    { key: 'u.outro', group: 'scene', source: 'Outro line' },
  ],
  graph: {
    nodeTypes: {
      Script: { kind: 'script', label: 'Script' },
      Choice: { kind: 'condition', label: 'Choice' },
    },
    nodes: [
      { key: 'n.intro', kind: 'script', type: 'Script', units: ['u.intro'] },
      { key: 'n.fork', kind: 'condition', type: 'Choice', units: [] },
      { key: 'n.branchA', kind: 'script', type: 'Script', units: ['u.choiceA'] },
      { key: 'n.branchB', kind: 'script', type: 'Script', units: ['u.choiceB'] },
      { key: 'n.outro', kind: 'script', type: 'Script', units: ['u.outro'] },
    ],
    edges: [
      { from: 'n.intro', to: 'n.fork' },
      { from: 'n.fork', to: 'n.branchA', label: 'Option A' },
      { from: 'n.fork', to: 'n.branchB', label: 'Option B' },
      { from: 'n.branchA', to: 'n.outro' },
      { from: 'n.branchB', to: 'n.outro' },
    ],
  },
});

describe('reading route API', () => {
  it('returns 404 for a project that does not exist', async () => {
    const { send } = setup();
    expect((await send('/projects/missing-project/reading-route')).status).toBe(404);
  });

  it('requires both endpoints and does not infer a default interval', async () => {
    const { first, get, id } = setup();
    const startId = id(first, 'node', 'n.start');
    const endId = id(first, 'node', 'n.end');
    const noEndpoints = await get(first);
    const noEnd = await get(first, startId);
    const noStart = await get(first, undefined, endId);

    expect(noEndpoints.status).toBe(200);
    expect(noEnd.status).toBe(200);
    expect(noStart.status).toBe(200);
    for (const response of [noEndpoints, noEnd, noStart]) {
      const result = await response.json() as { status: string; sequence: unknown[]; stages: unknown[] };
      expect(result).toMatchObject({ status: 'needs-endpoints', sequence: [], stages: [] });
    }
  });

  it('returns the selected directed interval and leaves translations and route picks unchanged', async () => {
    const { db, first, id, get } = setup();
    const start = id(first, 'node', 'n.start');
    const end = id(first, 'node', 'n.end');
    const startUnit = id(first, 'unit', 'u.start');
    db.update(s.projects).set({ routePicks: { preserved: 'value' } }).where(eq(s.projects.id, first)).run();
    db.update(s.units).set({ translation: '기존 번역' }).where(eq(s.units.id, startUnit)).run();
    const routePicksBefore = db.select({ routePicks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, first)).get()!.routePicks;
    const translationsBefore = db.select({ id: s.units.id, translation: s.units.translation }).from(s.units).where(eq(s.units.projectId, first)).all();

    const response = await get(first, start, end);
    expect(response.status).toBe(200);
    const result = await response.json() as { status: string; nodeIds: string[]; sequence: { unitId: string }[] };
    expect(result.status).toBe('found');
    expect(result.sequence.map(({ unitId }) => unitId)).toEqual([
      id(first, 'unit', 'u.start'), id(first, 'unit', 'u.middle'), id(first, 'unit', 'u.end'),
    ]);
    expect(result.nodeIds).toEqual([start, id(first, 'node', 'n.control'), id(first, 'node', 'n.middle'), end]);
    expect(db.select({ routePicks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, first)).get()!.routePicks).toEqual(routePicksBefore);
    expect(db.select({ id: s.units.id, translation: s.units.translation }).from(s.units).where(eq(s.units.projectId, first)).all()).toEqual(translationsBefore);
  });

  it('rejects foreign endpoints with HTTP 400', async () => {
    const { first, second, id, get } = setup();
    const foreignStart = id(second, 'node', 'n.start');
    const foreignEnd = id(second, 'node', 'n.end');
    const localStart = id(first, 'node', 'n.start');
    const localEnd = id(first, 'node', 'n.end');

    expect((await get(first, foreignStart, localEnd)).status).toBe(400);
    expect((await get(first, localStart, foreignEnd)).status).toBe(400);
    expect((await get(first, '', localEnd)).status).toBe(400);
  });

  it('finds dialogue when end is a container node whose text is in an attached leaf child node', async () => {
    const db = openDatabase(':memory:');
    const projectId = importProject(db, containerFixture, null as never).projectId;
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);

    const startNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'l.comm1'))).get()!.id;
    const endContainer = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'c.cont2'))).get()!.id;

    const response = await app.request(`/projects/${projectId}/reading-route?start=${startNode}&end=${endContainer}`);
    expect(response.status).toBe(200);
    const result = await response.json() as { status: string; nodeIds: string[]; sequence: { unitId: string }[] };
    expect(result.status).toBe('found');
    expect(result.sequence.map(({ unitId }) => unitId)).toEqual([
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm1'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm1_end'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm2'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm2_end'))).get()!.id,
    ]);
  });

  it('finds linear path through wait loops with repeat and decoded edges without failing as unreachable', async () => {
    const db = openDatabase(':memory:');
    const projectId = importProject(db, waitLoopFixture, null as never).projectId;
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);

    const startNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'n.tower1'))).get()!.id;
    const endNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'e.dawn'))).get()!.id;

    const response = await app.request(`/projects/${projectId}/reading-route?start=${startNode}&end=${endNode}`);
    expect(response.status).toBe(200);
    const result = await response.json() as { status: string; nodeIds: string[]; sequence: { unitId: string }[]; stages: { parallel: boolean }[] };
    expect(result.status).toBe('found');
    expect(result.nodeIds).toEqual([
      startNode,
      db.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'n.tower2'))).get()!.id,
      db.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'w.signal'))).get()!.id,
      endNode,
    ]);
    expect(result.sequence.map(({ unitId }) => unitId)).toEqual([
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.tower1'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.tower2'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.dawn'))).get()!.id,
    ]);
    expect(result.stages.every((st) => !st.parallel)).toBe(true);
  });

  it('finds the full story script between commentary lines across container states', async () => {
    const db = openDatabase(':memory:');
    const projectId = importProject(db, containerFixture, null as never).projectId;
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);

    const startNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'l.comm1'))).get()!.id;
    const endNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'l.comm2_end'))).get()!.id;

    const response = await app.request(`/projects/${projectId}/reading-route?start=${startNode}&end=${endNode}`);
    expect(response.status).toBe(200);
    const result = await response.json() as { status: string; nodeIds: string[]; sequence: { unitId: string }[]; stages: { parallel: boolean }[] };
    expect(result.status).toBe('found');
    expect(result.sequence.map(({ unitId }) => unitId)).toEqual([
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm1'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm1_end'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm2'))).get()!.id,
      db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.comm2_end'))).get()!.id,
    ]);
    expect(result.stages.every((st) => !st.parallel)).toBe(true);
  });

  it('switches between alternative branches when via is passed', async () => {
    const db = openDatabase(':memory:');
    const projectId = importProject(db, branchFixture, null as never).projectId;
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);

    const startNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'n.intro'))).get()!.id;
    const endNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'n.outro'))).get()!.id;
    const branchANode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'n.branchA'))).get()!.id;
    const branchBNode = db.select({ id: s.graphNodes.id }).from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'n.branchB'))).get()!.id;

    const unitChoiceA = db.select({ id: s.units.id }).from(s.units)
      .where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.choiceA'))).get()!.id;
    const unitChoiceB = db.select({ id: s.units.id }).from(s.units)
      .where(and(eq(s.units.projectId, projectId), eq(s.units.key, 'u.choiceB'))).get()!.id;

    // 1. Without via, route reports fork options
    const defaultRes = await app.request(`/projects/${projectId}/reading-route?start=${startNode}&end=${endNode}`);
    expect(defaultRes.status).toBe(200);
    const defaultData = await defaultRes.json() as { status: string; forks: { nodeId: string; options: { targetId: string }[] }[] };
    expect(defaultData.status).toBe('found');
    expect(defaultData.forks.length).toBeGreaterThan(0);
    expect(defaultData.forks[0]!.options.map((o) => o.targetId)).toEqual(expect.arrayContaining([branchANode, branchBNode]));

    // 2. With via pointing to branch A
    const resA = await app.request(`/projects/${projectId}/reading-route?start=${startNode}&end=${endNode}&via=${branchANode}`);
    const dataA = await resA.json() as { status: string; sequence: { unitId: string }[]; forks: { selectedId: string }[] };
    expect(dataA.status).toBe('found');
    expect(dataA.sequence.map((s) => s.unitId)).toContain(unitChoiceA);
    expect(dataA.sequence.map((s) => s.unitId)).not.toContain(unitChoiceB);
    expect(dataA.forks[0]!.selectedId).toBe(branchANode);

    // 3. With via pointing to branch B
    const resB = await app.request(`/projects/${projectId}/reading-route?start=${startNode}&end=${endNode}&via=${branchBNode}`);
    const dataB = await resB.json() as { status: string; sequence: { unitId: string }[]; forks: { selectedId: string }[] };
    expect(dataB.status).toBe('found');
    expect(dataB.sequence.map((s) => s.unitId)).toContain(unitChoiceB);
    expect(dataB.sequence.map((s) => s.unitId)).not.toContain(unitChoiceA);
    expect(dataB.forks[0]!.selectedId).toBe(branchBNode);
  });
});
