import { Worker } from 'node:worker_threads';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { graphEdges, graphLayouts, graphNodes, groups, projects, type LayoutData } from '../db/schema.ts';
import { events } from '../events.ts';
import type { LayoutJob, SceneSource, WorkerJob } from './layout-worker.ts';

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

const LAYOUT_TIMEOUT_MS = 5 * 60_000;

/** Raised when the project vanished while its layout was being computed: nothing to save any more. */
class Cancelled extends Error {}

/** Projects whose layout is being computed: the live worker, and whether another run was asked for meanwhile. */
const active = new Map<string, { worker: Worker | null; rerun: boolean; cancelled: boolean }>();

function runWorker(job: WorkerJob, onWorker: (worker: Worker) => void): Promise<LayoutData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), {
      workerData: job,
      execArgv: process.execArgv,
      resourceLimits: { stackSizeMb: 256, maxOldGenerationSizeMb: 4096 },
    });
    onWorker(worker);
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
      done();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('레이아웃 계산이 5분을 넘어 중단했습니다. 그래프가 너무 크거나 복잡합니다.'))), LAYOUT_TIMEOUT_MS);
    worker.once('message', (message: { ok: true; data: LayoutData } | { ok: false; error: string }) => finish(() => (message.ok ? resolve(message.data) : reject(new Error(message.error)))));
    worker.once('error', (error) => finish(() => reject(new Error(`레이아웃 작업이 오류로 멈췄습니다: ${error.message}`))));
    worker.once('exit', (code) => finish(() => reject(new Error(`레이아웃 작업이 결과 없이 종료했습니다 (코드 ${code}). 메모리가 부족했을 수 있습니다.`))));
  });
}

function save(db: Db, projectId: string, scope: 'dialogue' | 'scene', value: Partial<typeof graphLayouts.$inferInsert>) {
  db.insert(graphLayouts)
    .values({ projectId, scope, status: 'pending', ...value })
    .onConflictDoUpdate({ target: [graphLayouts.projectId, graphLayouts.scope], set: { ...value, updatedAt: new Date() } })
    .run();
}

/** What the worker needs to derive and lay out the scene graph (see SceneSource). */
export function sceneSource(db: Db, projectId: string): SceneSource {
  const sceneIds = db.select({ id: groups.id }).from(groups).where(and(eq(groups.projectId, projectId), eq(groups.kind, 'scene'))).orderBy(asc(groups.sort), asc(groups.key)).all().map((group) => group.id);
  const scenes = new Set(sceneIds);
  return {
    scenes: sceneIds,
    nodes: db.select({ id: graphNodes.id, groupId: graphNodes.groupId }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all().map((node) => ({ id: node.id, groupId: node.groupId && scenes.has(node.groupId) ? node.groupId : null })),
    edges: db.select({ fromId: graphEdges.fromId, toId: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all(),
    size: SCENE_SIZE,
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

const projectExists = (db: Db, projectId: string) => !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();

/** Stops the layout of a project that is being deleted; its result would have nowhere to go. */
export function cancelLayout(projectId: string) {
  const state = active.get(projectId);
  if (!state) return;
  state.cancelled = true;
  state.rerun = false;
  void state.worker?.terminate().catch(() => {});
}

/**
 * Layout is computed once per import (the source graph never changes) and stored. Never rejects:
 * a failure ends up as a failed layout, and a project deleted meanwhile is dropped quietly. One
 * computation per project at a time; a request that arrives meanwhile reruns once afterwards.
 */
export async function computeLayouts(db: Db, projectId: string): Promise<void> {
  const running = active.get(projectId);
  if (running) {
    running.rerun = true;
    return;
  }
  const state = { worker: null as Worker | null, rerun: false, cancelled: false };
  active.set(projectId, state);
  try {
    do {
      state.rerun = false;
      await computeOnce(db, projectId, state);
    } while (state.rerun && !state.cancelled);
  } catch (error) {
    if (!(error instanceof Cancelled)) console.error('layout failed', error);
  } finally {
    active.delete(projectId);
  }
}

async function computeOnce(db: Db, projectId: string, state: { worker: Worker | null; cancelled: boolean }) {
  const guarded = (write: () => void) => {
    if (state.cancelled || !projectExists(db, projectId)) throw new Cancelled();
    write();
  };
  const jobs = [
    ['scene', (): WorkerJob => ({ kind: 'scenes', source: sceneSource(db, projectId) })],
    ['dialogue', (): WorkerJob => ({ kind: 'layout', job: dialogueJob(db, projectId) })],
  ] as const;
  for (const [scope, build] of jobs) {
    guarded(() => save(db, projectId, scope, { status: 'pending', data: null, error: null }));
    events.changed(projectId, 'graph');
    try {
      const work = build();
      const empty = work.kind === 'scenes' ? !work.source.scenes.length : !work.job.nodes.length;
      const data: LayoutData = empty ? { width: 0, height: 0, nodes: [], edges: [] } : await runWorker(work, (worker) => (state.worker = worker));
      state.worker = null;
      guarded(() => save(db, projectId, scope, { status: 'ready', data, error: null }));
    } catch (error) {
      state.worker = null;
      if (error instanceof Cancelled) throw error;
      guarded(() => save(db, projectId, scope, { status: 'failed', error: error instanceof Error ? error.message : String(error) }));
    }
    events.changed(projectId, 'graph');
  }
}
