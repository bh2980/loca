import { Worker } from 'node:worker_threads';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { graphEdges, graphLayouts, graphNodes, groups, type LayoutData } from '../db/schema.ts';
import { events } from '../events.ts';
import type { LayoutJob } from './layout-worker.ts';
import { deriveSceneEdges } from './scene-graph.ts';

const NODE_SIZE: Record<string, [number, number]> = {
  script: [260, 76],
  condition: [132, 76],
  wait: [132, 60],
  event: [132, 60],
  state: [132, 60],
  unknown: [132, 60],
  connector: [20, 20],
};
const SCENE_SIZE: [number, number] = [280, 84];

function runWorker(job: LayoutJob): Promise<LayoutData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), {
      workerData: job,
      execArgv: process.execArgv,
      resourceLimits: { stackSizeMb: 256, maxOldGenerationSizeMb: 4096 },
    });
    worker.once('message', (message: { ok: true; data: LayoutData } | { ok: false; error: string }) => {
      if (message.ok) resolve(message.data);
      else reject(new Error(message.error));
      void worker.terminate();
    });
    worker.once('error', reject);
  });
}

function save(db: Db, projectId: string, scope: 'dialogue' | 'scene', value: Partial<typeof graphLayouts.$inferInsert>) {
  db.insert(graphLayouts)
    .values({ projectId, scope, status: 'pending', ...value })
    .onConflictDoUpdate({ target: [graphLayouts.projectId, graphLayouts.scope], set: { ...value, updatedAt: new Date() } })
    .run();
}

export function sceneJob(db: Db, projectId: string): LayoutJob {
  const nodes = db.select({ id: graphNodes.id, groupId: graphNodes.groupId }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
  const edges = db.select({ fromId: graphEdges.fromId, toId: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all();
  const sceneIds = db.select({ id: groups.id }).from(groups).where(and(eq(groups.projectId, projectId), eq(groups.kind, 'scene'))).all();
  const scenes = new Set(sceneIds.map((group) => group.id));
  // Document / UI nodes are passed through like control nodes, never treated as an endpoint.
  const derived = deriveSceneEdges(
    nodes.map((node) => ({ id: node.id, groupId: node.groupId && scenes.has(node.groupId) ? node.groupId : null })),
    edges,
  );
  return {
    nodes: sceneIds.map((group) => ({ id: group.id, width: SCENE_SIZE[0], height: SCENE_SIZE[1] })),
    edges: derived
      .filter((edge) => scenes.has(edge.from) && scenes.has(edge.to))
      .map((edge, index) => ({ id: `s${index}`, from: edge.from, to: edge.to })),
  };
}

export function dialogueJob(db: Db, projectId: string): LayoutJob {
  const nodes = db.select({ id: graphNodes.id, kind: graphNodes.kind }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
  const edges = db.select({ id: graphEdges.id, from: graphEdges.fromId, to: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all();
  return {
    nodes: nodes.map((node) => {
      const [width, height] = NODE_SIZE[node.kind] ?? NODE_SIZE.unknown;
      return { id: node.id, width, height };
    }),
    edges,
  };
}

/** Layout is computed once per import (the source graph never changes) and stored. */
export async function computeLayouts(db: Db, projectId: string): Promise<void> {
  for (const [scope, build] of [['scene', sceneJob], ['dialogue', dialogueJob]] as const) {
    save(db, projectId, scope, { status: 'pending', data: null, error: null });
    events.changed(projectId, 'graph');
    try {
      const job = build(db, projectId);
      const data = job.nodes.length ? await runWorker(job) : { width: 0, height: 0, nodes: [], edges: [] };
      save(db, projectId, scope, { status: 'ready', data, error: null });
    } catch (error) {
      save(db, projectId, scope, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
    events.changed(projectId, 'graph');
  }
}
