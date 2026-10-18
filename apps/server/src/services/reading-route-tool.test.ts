import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { agentToolAvailable, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { agentCatalog } from './agent-catalog.ts';
import { agentTools } from './agent-tools.ts';
import { projectReadingRoute } from './reading-route.ts';

const fixture = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'Reading route tool fixture', sourceLanguage: 'ko', targetLanguage: 'en' },
  groups: [{ key: 'scene', kind: 'scene', title: 'Scene' }],
  units: [
    { key: 'A1', group: 'scene', source: 'Start first' },
    { key: 'A2', group: 'scene', source: 'Start second' },
    { key: 'B', group: 'scene', source: 'Mandatory left arm' },
    { key: 'C1', group: 'scene', source: 'Choice one' },
    { key: 'C2', group: 'scene', source: 'Choice two' },
    { key: 'D', group: 'scene', source: 'Mandatory right arm' },
    { key: 'E1', group: 'scene', source: 'End first' },
    { key: 'E2', group: 'scene', source: 'End second' },
    { key: 'DUP', group: 'scene', source: 'Ambiguous line' },
  ],
  graph: {
    nodeTypes: {
      Script: { kind: 'script', label: 'Script' },
      State: { kind: 'state', label: 'State' },
      Choice: { kind: 'condition', label: 'Choice' },
    },
    nodes: [
      { key: 'node.A', kind: 'script', type: 'Script', units: ['A1', 'A2'] },
      { key: 'node.fan', kind: 'state', type: 'State', units: [] },
      { key: 'node.B', kind: 'script', type: 'Script', units: ['B'] },
      { key: 'node.choice', kind: 'condition', type: 'Choice', units: [] },
      { key: 'node.C1', kind: 'script', type: 'Script', units: ['C1'] },
      { key: 'node.C2', kind: 'script', type: 'Script', units: ['C2'] },
      { key: 'node.D', kind: 'script', type: 'Script', units: ['D'] },
      { key: 'node.E', kind: 'script', type: 'Script', units: ['E1', 'E2'] },
      { key: 'node.dup1', kind: 'script', type: 'Script', units: ['DUP'] },
      { key: 'node.dup2', kind: 'script', type: 'Script', units: ['DUP'] },
    ],
    edges: [
      { from: 'node.A', to: 'node.fan' },
      { from: 'node.fan', to: 'node.B' },
      { from: 'node.fan', to: 'node.choice' },
      { from: 'node.fan', to: 'node.D' },
      { from: 'node.B', to: 'node.E' },
      { from: 'node.choice', to: 'node.C1' },
      { from: 'node.choice', to: 'node.C2' },
      { from: 'node.C1', to: 'node.E' },
      { from: 'node.C2', to: 'node.E' },
      { from: 'node.D', to: 'node.E' },
    ],
  },
});

function setup() {
  const db = openDatabase(':memory:');
  const first = importProject(db, fixture, null as never).projectId;
  const second = importProject(db, fixture, null as never).projectId;
  const nodeId = (projectId: string, key: string) => db.select({ id: s.graphNodes.id }).from(s.graphNodes)
    .where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, key))).get()!.id;
  const unit = (projectId: string, key: string) => db.select({ id: s.units.id, key: s.units.key }).from(s.units)
    .where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get()!;
  const routeTool = agentCatalog(db, first).find((item) => item.name === 'find_reading_route');
  if (!routeTool) throw new Error('Missing find_reading_route catalog tool');
  return { db, first, second, nodeId, unit, routeTool };
}

describe('find_reading_route chat tool', () => {
  it('resolves exact line keys to node boundaries and matches the shared route service', async () => {
    const { db, first, nodeId, unit, routeTool } = setup();
    db.update(s.projects).set({ routePicks: { oldStart: 'keep' } }).where(eq(s.projects.id, first)).run();
    db.update(s.units).set({ translation: '기존 번역' }).where(and(eq(s.units.projectId, first), eq(s.units.key, 'A1'))).run();
    const picksBefore = db.select({ routePicks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, first)).get()!.routePicks;
    const translationsBefore = db.select({ id: s.units.id, translation: s.units.translation }).from(s.units).where(eq(s.units.projectId, first)).all();
    const result = await routeTool.run({ start: 'A2', end: 'E1' }) as {
      ok: boolean;
      start: { nodeId: string; key: string };
      end: { nodeId: string; key: string };
      lineCount: number;
      stageCount: number;
      parallelStageCount: number;
      open: { to: string; search: { routeStart: string; routeEnd: string } };
    };
    const expected = projectReadingRoute(db, first, { start: nodeId(first, 'node.A'), end: nodeId(first, 'node.E') });

    expect(result).toMatchObject({
      ok: true,
      start: { nodeId: nodeId(first, 'node.A'), key: 'A1' },
      end: { nodeId: nodeId(first, 'node.E'), key: 'E2' },
      lineCount: expected.sequence.length,
      stageCount: expected.stages.length,
      parallelStageCount: expected.stages.filter((stage) => stage.parallel).length,
      open: { to: '/p/$projectId/graph', search: { scope: 'dialogue', routeStart: nodeId(first, 'node.A'), routeEnd: nodeId(first, 'node.E') } },
    });
    expect(expected.sequence.map(({ unitId }) => unitId)).toEqual([
      unit(first, 'A1').id, unit(first, 'A2').id, unit(first, 'B').id,
      unit(first, 'E1').id, unit(first, 'E2').id,
    ]);
    expect(expected.stages.filter((stage) => stage.parallel)).toHaveLength(0);
    expect(db.select({ routePicks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, first)).get()!.routePicks).toEqual(picksBefore);
    expect(db.select({ id: s.units.id, translation: s.units.translation }).from(s.units).where(eq(s.units.projectId, first)).all()).toEqual(translationsBefore);
  });

  it('accepts node ids, rejects unknown, cross-project, and ambiguous line references safely', async () => {
    const { first, second, nodeId, unit, routeTool } = setup();
    const sameProjectById = await routeTool.run({ start: nodeId(first, 'node.A'), end: nodeId(first, 'node.E') }) as { ok: boolean; start: { nodeId: string } };
    const unknown = await routeTool.run({ start: 'not-a-line-or-node', end: 'E1' }) as { ok: boolean; error: string };
    const foreignId = await routeTool.run({ start: unit(second, 'A1').id, end: 'E1' }) as { ok: boolean; error: string };
    const ambiguous = await routeTool.run({ start: 'DUP', end: 'E1' }) as { ok: boolean; error: string };

    expect(sameProjectById).toMatchObject({ ok: true, start: { nodeId: nodeId(first, 'node.A') } });
    for (const result of [unknown, foreignId, ambiguous]) expect(result.ok).toBe(false);
    expect(unknown.error).toBeTruthy();
    expect(foreignId.error).toBeTruthy();
    expect(ambiguous.error).toBeTruthy();
  });

  it('reports unreachable when disconnected from the selected end', async () => {
    const { db, first, nodeId, routeTool } = setup();
    const end = nodeId(first, 'node.E');
    db.delete(s.graphEdges).where(and(eq(s.graphEdges.projectId, first), eq(s.graphEdges.toId, end))).run();
    const result = await routeTool.run({ start: 'A1', end: 'E1' }) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(projectReadingRoute(db, first, { start: nodeId(first, 'node.A'), end }).status).toBe('unreachable');
  });

  it('supports substring fallback and container nodes with attached children', async () => {
    const { first, nodeId, routeTool } = setup();
    const res = await routeTool.run({ start: 'Start first', end: 'End second' }) as { ok: boolean; start: { key: string }; end: { key: string } };
    expect(res.ok).toBe(true);
    expect(res.start.key).toBe('A1');
    expect(res.end.key).toBe('E2');

    const fanRes = await routeTool.run({ start: nodeId(first, 'node.fan'), end: 'E1' }) as { ok: boolean; start: { key: string } };
    expect(fanRes.ok).toBe(true);
  });

  it('is registered as a read-only tool with the existing script and scene permissions', () => {
    const { db, first, routeTool } = setup();
    const entry = agentCatalog(db, first).find((item) => item.name === 'find_reading_route')!;

    expect(routeTool.changes).toBe(false);
    expect(entry.schema.safeParse({ start: 'A1', end: 'E1' }).success).toBe(true);
    expect(agentToolAvailable({}, 'find_reading_route')).toBe(true);
    expect(agentToolAvailable({ permissions: { script: { read: false } } }, 'find_reading_route')).toBe(false);
  });
});
