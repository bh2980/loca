import { Worker } from 'node:worker_threads';
import { and, asc, eq, ne, notLike, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { graphEdges, graphLayouts, graphNodes, groups, projects, type LayoutData } from '../db/schema.ts';
import { events } from '../events.ts';
import type { LayoutJob, SceneSource, SectionLayouts, WorkerJob } from './layout-worker.ts';

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

function runWorker<T = LayoutData>(job: WorkerJob, onWorker: (worker: Worker) => void): Promise<T> {
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
    worker.once('message', (message: { ok: true; data: T } | { ok: false; error: string }) => finish(() => (message.ok ? resolve(message.data) : reject(new Error(message.error)))));
    worker.once('error', (error) => finish(() => reject(new Error(`레이아웃 작업이 오류로 멈췄습니다: ${error.message}`))));
    worker.once('exit', (code) => finish(() => reject(new Error(`레이아웃 작업이 결과 없이 종료했습니다 (코드 ${code}). 메모리가 부족했을 수 있습니다.`))));
  });
}

function save(db: Db, projectId: string, scope: 'dialogue' | 'scene', value: Partial<typeof graphLayouts.$inferInsert>, section = '') {
  db.insert(graphLayouts)
    .values({ projectId, scope, section, status: 'pending', ...value })
    .onConflictDoUpdate({ target: [graphLayouts.projectId, graphLayouts.scope, graphLayouts.section], set: { ...value, updatedAt: new Date() } })
    .run();
}

/** The dialogue graph's nodes with their scene's section, in script order of sections. */
export function sectionSource(db: Db, projectId: string) {
  const groupRows = db.select({ id: groups.id, section: groups.section }).from(groups).where(eq(groups.projectId, projectId)).orderBy(asc(groups.sort), asc(groups.key)).all();
  const sectionOf = new Map(groupRows.map((group) => [group.id, group.section || null]));
  const nodes = db.select({ id: graphNodes.id, kind: graphNodes.kind, groupId: graphNodes.groupId }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
  return {
    nodes: nodes.map((node) => {
      const [width, height] = NODE_SIZE[node.kind] ?? NODE_SIZE.unknown;
      return { id: node.id, width, height, section: node.groupId ? (sectionOf.get(node.groupId) ?? null) : null };
    }),
    edges: db.select({ id: graphEdges.id, from: graphEdges.fromId, to: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all(),
    order: [...new Set(groupRows.flatMap((group) => (group.section ? [group.section] : [])))],
  };
}

/** What the worker needs to derive and lay out the scene graph (see SceneSource). */
export function sceneSource(db: Db, projectId: string): SceneSource {
  const rows = db.select({ id: groups.id, section: groups.section }).from(groups).where(and(eq(groups.projectId, projectId), eq(groups.kind, 'scene'))).orderBy(asc(groups.sort), asc(groups.key)).all();
  const sceneIds = rows.map((group) => group.id);
  const scenes = new Set(sceneIds);
  return {
    scenes: sceneIds,
    sections: rows.map((group) => group.section),
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

const VIEW = '보기';

/**
 * A chosen set of dialogue-graph nodes laid out on its own, once (a few hundred nodes take a
 * second or two), stored under section `key` so the graph route serves it like a section. Lines
 * that continue outside the set end in portals named after the scene they continue in.
 */
export async function nodeSetLayout(db: Db, projectId: string, key: string, nodeIds: string[], label = '') {
  const existing = db.select({ status: graphLayouts.status }).from(graphLayouts).where(and(eq(graphLayouts.projectId, projectId), eq(graphLayouts.scope, 'dialogue'), eq(graphLayouts.section, key))).get();
  if (existing?.status === 'ready') return;
  const chosen = new Set(nodeIds);
  const titleOf = new Map(db.select({ id: groups.id, title: groups.title }).from(groups).where(eq(groups.projectId, projectId)).all().map((group) => [group.id, group.title]));
  const nodes = db.select({ id: graphNodes.id, kind: graphNodes.kind, groupId: graphNodes.groupId }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
  const edges = db.select({ id: graphEdges.id, from: graphEdges.fromId, to: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all();
  const data = await runWorker(
    {
      kind: 'view',
      view: VIEW,
      edges,
      nodes: nodes.map((node) => {
        const [width, height] = NODE_SIZE[node.kind] ?? NODE_SIZE.unknown;
        return { id: node.id, width, height, section: chosen.has(node.id) ? VIEW : node.groupId ? `scene:${node.groupId}` : null };
      }),
    },
    () => {},
  );
  // Portals name the scene the lines continue in, and keep its id to open it.
  data.portals = data.portals?.map((portal) => {
    const groupId = portal.section.startsWith('scene:') ? portal.section.slice('scene:'.length) : undefined;
    return groupId ? { ...portal, section: titleOf.get(groupId) ?? groupId, groupId } : portal;
  });
  save(db, projectId, 'dialogue', { status: 'ready', data: { ...data, view: { label, nodes: chosen.size } }, error: null }, key);
}

/** Projects laid out before section layouts existed: their scenes span several sections but no section layout is stored. */
export function projectsMissingSections(db: Db) {
  const rows = db.all<{ projectId: string }>(sql`
    select g.project_id as projectId from ${groups} g
    where g.section is not null and g.section != ''
      and exists (select 1 from ${graphNodes} n where n.group_id = g.id)
    group by g.project_id having count(distinct g.section) > 1
      and not exists (select 1 from ${graphLayouts} l where l.project_id = g.project_id and l.scope = 'dialogue' and l.section != '' and l.section not like 'view:%')`);
  return rows.map((row) => row.projectId);
}

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
export async function computeLayouts(db: Db, projectId: string, options: { sectionsOnly?: boolean } = {}): Promise<void> {
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
      await computeOnce(db, projectId, state, options.sectionsOnly);
    } while (state.rerun && !state.cancelled);
  } catch (error) {
    if (!(error instanceof Cancelled)) console.error('layout failed', error);
  } finally {
    active.delete(projectId);
  }
}

async function computeOnce(db: Db, projectId: string, state: { worker: Worker | null; cancelled: boolean }, sectionsOnly = false) {
  const guarded = (write: () => void) => {
    if (state.cancelled || !projectExists(db, projectId)) throw new Cancelled();
    write();
  };
  const jobs = [
    ['scene', (): WorkerJob => ({ kind: 'scenes', source: sceneSource(db, projectId) })],
    ['dialogue', (): WorkerJob => ({ kind: 'layout', job: dialogueJob(db, projectId) })],
  ] as const;
  for (const [scope, build] of sectionsOnly ? [] : jobs) {
    guarded(() => save(db, projectId, scope, { status: 'pending', data: null, error: null }));
    events.changed(projectId, 'graph');
    try {
      const work = build();
      const empty = work.kind === 'scenes' ? !work.source.scenes.length : work.kind === 'layout' ? !work.job.nodes.length : !work.nodes.length;
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

  // Each section's own dialogue layout, when the script has more than one section with lines in the graph.
  guarded(() => db.delete(graphLayouts).where(and(eq(graphLayouts.projectId, projectId), eq(graphLayouts.scope, 'dialogue'), ne(graphLayouts.section, ''), notLike(graphLayouts.section, 'view:%'))).run());
  const source = sectionSource(db, projectId);
  const used = new Set(source.nodes.flatMap((node) => (node.section ? [node.section] : [])));
  if (used.size < 2) return;
  try {
    const { sections } = await runWorker<SectionLayouts>({ kind: 'sections', ...source }, (worker) => (state.worker = worker));
    state.worker = null;
    guarded(() => db.transaction(() => {
      for (const section of sections) save(db, projectId, 'dialogue', { status: 'ready', data: section.data, error: null }, section.name);
    }));
  } catch (error) {
    state.worker = null;
    if (error instanceof Cancelled) throw error;
    console.error('section layouts failed', error);
  }
  events.changed(projectId, 'graph');
}
