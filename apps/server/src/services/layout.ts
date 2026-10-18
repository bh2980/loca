import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { and, asc, eq, inArray, ne, notLike, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { graphEdges, graphLayouts, graphNodes, groups, projects, units, type LayoutData, type OmittedFacts } from '../db/schema.ts';
import { contractEdges, isControlNode } from '@tw/shared';
import { events } from '../events.ts';
import { foldChoices } from './choices.ts';
import type { LayoutDirection, LayoutJob, SceneSource, SectionLayouts, WorkerJob } from './layout-worker.ts';

const NODE_SIZE: Record<string, [number, number]> = {
  script: [260, 76],
  choice: [260, 56],
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
const active = new Map<string, { worker: Worker | null; rerun: Set<LayoutDirection>; cancelled: boolean }>();

const workerResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

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
    worker.on('message', (message: unknown) => {
      // Node's --watch also sends watch:import/watch:require messages through this port.
      // They are dependency notifications, not the layout's result; keep waiting for that.
      const result = workerResultSchema.safeParse(message);
      if (!result.success) return;
      finish(() => (result.data.ok ? resolve(result.data.data as T) : reject(new Error(result.data.error))));
    });
    worker.once('error', (error) => finish(() => reject(new Error(`레이아웃 작업이 오류로 멈췄습니다: ${error.message}`))));
    worker.once('exit', (code) => finish(() => reject(new Error(`레이아웃 작업이 결과 없이 종료했습니다 (코드 ${code}). 메모리가 부족했을 수 있습니다.`))));
  });
}

/** Bumped when layouts are made differently (8: direction variants and roomier ELK spacing); older cached layouts are recomputed at startup. */
export const LAYOUT_VERSION = 8;

/** Stored direction variants with a stored layout made by an older LAYOUT_VERSION. */
export function projectsWithOldLayouts(db: Db) {
  return db
    .selectDistinct({ projectId: graphLayouts.projectId, direction: graphLayouts.direction })
    .from(graphLayouts)
    .where(and(eq(graphLayouts.status, 'ready'), sql`coalesce(json_extract(${graphLayouts.data}, '$.version'), 0) < ${LAYOUT_VERSION}`, sql`${graphLayouts.section} not like 'view:%'`))
    .all();
}

function save(db: Db, projectId: string, scope: 'dialogue' | 'scene', given: Partial<typeof graphLayouts.$inferInsert>, section = '', direction: LayoutDirection = 'vertical') {
  const value = given.data ? { ...given, data: { ...given.data, version: LAYOUT_VERSION } } : given;
  db.insert(graphLayouts)
    .values({ projectId, scope, section, direction, status: 'pending', ...value })
    .onConflictDoUpdate({ target: [graphLayouts.projectId, graphLayouts.scope, graphLayouts.section, graphLayouts.direction], set: { ...value, updatedAt: new Date() } })
    .run();
}

/** The dialogue graph's nodes with their scene's section, in script order of sections. */
export function sectionSource(db: Db, projectId: string, direction: LayoutDirection = 'vertical') {
  const groupRows = db.select({ id: groups.id, section: groups.section }).from(groups).where(eq(groups.projectId, projectId)).orderBy(asc(groups.sort), asc(groups.key)).all();
  const sectionOf = new Map(groupRows.map((group) => [group.id, group.section || null]));
  const { nodes, edges } = dialogueSource(db, projectId);
  return {
    direction,
    nodes: nodes.map((node) => {
      const [width, height] = NODE_SIZE[node.kind] ?? NODE_SIZE.unknown;
      return { id: node.id, width, height, group: node.groupId, section: node.groupId ? (sectionOf.get(node.groupId) ?? null) : null, ...(node.kind === 'choice' && { keep: true }) };
    }),
    edges,
    order: [...new Set(groupRows.flatMap((group) => (group.section ? [group.section] : [])))],
  };
}

/** The dialogue graph to lay out: choices with one way in and out folded into their edge's label. */
function dialogueSource(db: Db, projectId: string) {
  const nodes = db.select({ id: graphNodes.id, kind: graphNodes.kind, groupId: graphNodes.groupId }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
  const edges = db.select({ id: graphEdges.id, from: graphEdges.fromId, to: graphEdges.toId, label: graphEdges.label }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all();
  const choices = db
    .select({ id: graphNodes.id, text: sql<string | null>`(select u.source from units u where u.id = json_extract(${graphNodes.unitIds}, '$[0]'))` })
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), eq(graphNodes.kind, 'choice')))
    .all();
  return foldChoices(nodes, edges, new Map(choices.flatMap((choice) => (choice.text ? [[choice.id, choice.text] as const] : []))));
}

/** What the worker needs to derive and lay out the scene graph (see SceneSource). */
export function sceneSource(db: Db, projectId: string, direction: LayoutDirection = 'vertical'): SceneSource {
  const rows = db.select({ id: groups.id, section: groups.section }).from(groups).where(and(eq(groups.projectId, projectId), eq(groups.kind, 'scene'))).orderBy(asc(groups.sort), asc(groups.key)).all();
  const sceneIds = rows.map((group) => group.id);
  const scenes = new Set(sceneIds);
  return {
    direction,
    scenes: sceneIds,
    sections: rows.map((group) => group.section),
    nodes: db.select({ id: graphNodes.id, groupId: graphNodes.groupId }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all().map((node) => ({ id: node.id, groupId: node.groupId && scenes.has(node.groupId) ? node.groupId : null })),
    edges: db.select({ fromId: graphEdges.fromId, toId: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all(),
    size: SCENE_SIZE,
  };
}

export function dialogueJob(db: Db, projectId: string, direction: LayoutDirection = 'vertical'): LayoutJob {
  const { nodes, edges } = dialogueSource(db, projectId);
  return {
    direction,
    nodes: nodes.map((node) => {
      const [width, height] = NODE_SIZE[node.kind] ?? NODE_SIZE.unknown;
      // A player's choice stays its own box, never folded into a run of lines.
      return { id: node.id, width, height, group: node.groupId, ...(node.kind === 'choice' && { keep: true }) };
    }),
    edges,
  };
}

const projectExists = (db: Db, projectId: string) => !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();

const VIEW = '보기';
const viewJobs = new Map<string, Promise<void>>();

/**
 * A chosen set of dialogue-graph nodes laid out on its own, once (a few hundred nodes take a
 * second or two), stored under section `key` so the graph route serves it like a section. Lines
 * that continue outside the set end in portals named after the scene they continue in.
 */
export function nodeSetLayout(db: Db, projectId: string, key: string, nodeIds: string[], label = '', direction: LayoutDirection = 'vertical'): Promise<void> {
  const jobKey = `${projectId}:${key}:${direction}`;
  const running = viewJobs.get(jobKey);
  if (running) return running;
  const job = computeNodeSetLayout(db, projectId, key, nodeIds, label, direction).finally(() => viewJobs.delete(jobKey));
  viewJobs.set(jobKey, job);
  return job;
}

async function computeNodeSetLayout(db: Db, projectId: string, key: string, nodeIds: string[], label: string, direction: LayoutDirection) {
  const existing = db.select({ status: graphLayouts.status, version: sql<number>`coalesce(json_extract(${graphLayouts.data}, '$.version'), 0)` }).from(graphLayouts).where(and(eq(graphLayouts.projectId, projectId), eq(graphLayouts.scope, 'dialogue'), eq(graphLayouts.section, key), eq(graphLayouts.direction, direction))).get();
  if (existing?.status === 'ready' && existing.version >= LAYOUT_VERSION) return;
  save(db, projectId, 'dialogue', { status: 'pending', data: null, error: null }, key, direction);
  events.changed(projectId, 'graph');
  const chosen = new Set(nodeIds);
  const titleOf = new Map(db.select({ id: groups.id, title: groups.title }).from(groups).where(eq(groups.projectId, projectId)).all().map((group) => [group.id, group.title]));
  const nodes = db.select({ id: graphNodes.id, kind: graphNodes.kind, groupId: graphNodes.groupId, unitIds: graphNodes.unitIds }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
  const { edges: viewed, via } = viewEdges(chosen, db.select({ id: graphEdges.id, from: graphEdges.fromId, to: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all());
  const omitted = omittedFacts(db, nodes, via);
  // A derived edge says what it leaves out on its label, so the layout keeps room for it.
  const edges = viewed.map((edge) => (omitted.has(edge.id) ? { ...edge, label: omittedLabel(omitted.get(edge.id)!) } : edge));
  let data: LayoutData;
  try {
    data = await runWorker(
      {
        kind: 'view',
        view: VIEW,
        direction,
        edges,
        nodes: nodes.map((node) => {
          const [width, height] = NODE_SIZE[node.kind] ?? NODE_SIZE.unknown;
          return { id: node.id, width, height, group: node.groupId, section: chosen.has(node.id) ? VIEW : node.groupId ? `scene:${node.groupId}` : null };
        }),
      },
      () => {},
    );
  } catch (error) {
    save(db, projectId, 'dialogue', { status: 'failed', error: error instanceof Error ? error.message : String(error) }, key, direction);
    events.changed(projectId, 'graph');
    return;
  }
  data.edges = data.edges.map((edge) => (via.has(edge.id) ? { ...edge, derived: true as const, omitted: omitted.get(edge.id) } : edge));
  // Portals name the scene the lines continue in, and keep its id to open it.
  data.portals = data.portals?.map((portal) => {
    const groupId = portal.section.startsWith('scene:') ? portal.section.slice('scene:'.length) : undefined;
    return groupId ? { ...portal, section: titleOf.get(groupId) ?? groupId, groupId } : portal;
  });
  save(db, projectId, 'dialogue', { status: 'ready', data: { ...data, view: { label, nodes: chosen.size } }, error: null }, key, direction);
  events.changed(projectId, 'graph');
}

const BYPASS = 'bypass:';

/**
 * A view's edges (a stored view: chosen nodes only). Edges between chosen nodes stay; every other
 * node is left out, and two chosen nodes joined through left-out nodes only get a derived edge
 * (drawn dashed, never stored) however far apart they are. `via`: derived edge id → the left-out
 * nodes on its paths.
 */
export function viewEdges(chosen: Set<string>, edges: { id: string; from: string; to: string }[]) {
  const left = new Set<string>();
  for (const edge of edges) for (const end of [edge.from, edge.to]) if (!chosen.has(end)) left.add(end);
  const via = new Map<string, string[]>();
  const derived = contractEdges(edges, left)
    .filter((edge) => chosen.has(edge.from) && chosen.has(edge.to))
    .map((edge) => {
      const id = `${BYPASS}${edge.from}:${edge.to}`;
      via.set(id, edge.via);
      return { id, from: edge.from, to: edge.to };
    });
  return { edges: [...edges.filter((edge) => chosen.has(edge.from) && chosen.has(edge.to)), ...derived], via };
}

/** "생략 · 대사 12줄 · 조건·제어 3 · MIRA, JONAS 외 2": counted facts only, never a summary of what happens. */
export function omittedLabel(facts: OmittedFacts) {
  const speakers = facts.speakers.length ? `${facts.speakers.join(', ')}${facts.moreSpeakers ? ` 외 ${facts.moreSpeakers}` : ''}` : '';
  return ['생략', facts.lines ? `대사 ${facts.lines}줄` : '', facts.controls ? `조건·제어 ${facts.controls}` : '', speakers].filter(Boolean).join(' · ');
}

/** What each derived edge leaves out, counted from the source graph: lines, line-less nodes and who speaks there. */
function omittedFacts(db: Db, nodes: { id: string; kind: string; unitIds: string[] }[], via: Map<string, string[]>): Map<string, OmittedFacts> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const unitIds = [...new Set([...via.values()].flatMap((ids) => ids.flatMap((id) => byId.get(id)?.unitIds ?? [])))];
  const speakerOf = new Map<string, string | null>();
  for (let at = 0; at < unitIds.length; at += 500)
    for (const row of db.select({ id: units.id, speaker: units.speaker }).from(units).where(inArray(units.id, unitIds.slice(at, at + 500))).all()) speakerOf.set(row.id, row.speaker);
  return new Map(
    [...via].map(([edgeId, ids]) => {
      const left = ids.map((id) => byId.get(id)).filter((node) => node !== undefined);
      const lineIds = left.flatMap((node) => node.unitIds);
      const speakers = [...new Set(lineIds.map((id) => speakerOf.get(id)).filter((speaker): speaker is string => Boolean(speaker?.trim())))];
      return [edgeId, { nodeIds: ids, lines: lineIds.length, controls: left.filter(isControlNode).length, speakers: speakers.slice(0, 8), moreSpeakers: Math.max(0, speakers.length - 8) }] as const;
    }),
  );
}

/** Projects laid out before section layouts existed: their scenes span several sections but no section layout is stored. */
export function projectsMissingSections(db: Db) {
  const rows = db.all<{ projectId: string }>(sql`
    select g.project_id as projectId from ${groups} g
    where g.section is not null and g.section != ''
      and exists (select 1 from ${graphNodes} n where n.group_id = g.id)
    group by g.project_id having count(distinct g.section) > 1
      and not exists (select 1 from ${graphLayouts} l where l.project_id = g.project_id and l.scope = 'dialogue' and l.direction = 'vertical' and l.section != '' and l.section not like 'view:%')`);
  return rows.map((row) => row.projectId);
}

/**
 * Projects with a source graph but no stored layout at all: imported without the import route
 * (scripts/seed-samples.ts writes straight to the database). Their graph pages would stay
 * "그래프가 없습니다" forever, so the server lays them out at start.
 */
export function projectsWithoutLayouts(db: Db) {
  const rows = db.all<{ projectId: string }>(sql`
    select distinct n.project_id as projectId from ${graphNodes} n
    where not exists (select 1 from ${graphLayouts} l where l.project_id = n.project_id and l.direction = 'vertical' and l.section = '')`);
  return rows.map((row) => row.projectId);
}

/** Stops the layout of a project that is being deleted; its result would have nowhere to go. */
export function cancelLayout(projectId: string) {
  const state = active.get(projectId);
  if (!state) return;
  state.cancelled = true;
  state.rerun.clear();
  void state.worker?.terminate().catch(() => {});
}

/**
 * Layout is computed once per import (the source graph never changes) and stored. Never rejects:
 * a failure ends up as a failed layout, and a project deleted meanwhile is dropped quietly. One
 * computation per project at a time; a request that arrives meanwhile reruns once afterwards.
 */
export async function computeLayouts(db: Db, projectId: string, options: { sectionsOnly?: boolean; direction?: LayoutDirection } = {}): Promise<void> {
  const direction = options.direction ?? 'vertical';
  const running = active.get(projectId);
  if (running) {
    // A second orientation may be requested while the first is laying out. Publish pending rows
    // now so the route can render a loading state and repeated section reads won't queue reruns.
    if (!options.sectionsOnly && !running.rerun.has(direction)) {
      save(db, projectId, 'scene', { status: 'pending', data: null, error: null }, '', direction);
      save(db, projectId, 'dialogue', { status: 'pending', data: null, error: null }, '', direction);
      events.changed(projectId, 'graph');
    }
    running.rerun.add(direction);
    return;
  }
  const state = { worker: null as Worker | null, rerun: new Set<LayoutDirection>(), cancelled: false };
  active.set(projectId, state);
  try {
    let next: LayoutDirection | undefined = direction;
    while (next && !state.cancelled) {
      state.rerun.delete(next);
      await computeOnce(db, projectId, state, options.sectionsOnly, next);
      next = state.rerun.values().next().value;
    }
  } catch (error) {
    if (!(error instanceof Cancelled)) console.error('layout failed', error);
  } finally {
    active.delete(projectId);
  }
}

async function computeOnce(db: Db, projectId: string, state: { worker: Worker | null; cancelled: boolean }, sectionsOnly = false, direction: LayoutDirection = 'vertical') {
  const guarded = (write: () => void) => {
    if (state.cancelled || !projectExists(db, projectId)) throw new Cancelled();
    write();
  };
  const jobs = [
    ['scene', (): WorkerJob => ({ kind: 'scenes', source: sceneSource(db, projectId, direction) })],
    ['dialogue', (): WorkerJob => ({ kind: 'layout', job: dialogueJob(db, projectId, direction) })],
  ] as const;
  for (const [scope, build] of sectionsOnly ? [] : jobs) {
    guarded(() => save(db, projectId, scope, { status: 'pending', data: null, error: null }, '', direction));
    events.changed(projectId, 'graph');
    try {
      const work = build();
      const empty = work.kind === 'scenes' ? !work.source.scenes.length : work.kind === 'layout' ? !work.job.nodes.length : !work.nodes.length;
      const data: LayoutData = empty ? { width: 0, height: 0, nodes: [], edges: [] } : await runWorker(work, (worker) => (state.worker = worker));
      state.worker = null;
      guarded(() => save(db, projectId, scope, { status: 'ready', data, error: null }, '', direction));
    } catch (error) {
      state.worker = null;
      if (error instanceof Cancelled) throw error;
      guarded(() => save(db, projectId, scope, { status: 'failed', error: error instanceof Error ? error.message : String(error) }, '', direction));
    }
    events.changed(projectId, 'graph');
  }

  // Each section's own dialogue layout, when the script has more than one section with lines in the graph.
  guarded(() => db.delete(graphLayouts).where(and(eq(graphLayouts.projectId, projectId), eq(graphLayouts.scope, 'dialogue'), eq(graphLayouts.direction, direction), ne(graphLayouts.section, ''), notLike(graphLayouts.section, 'view:%'))).run());
  const source = sectionSource(db, projectId, direction);
  const used = new Set(source.nodes.flatMap((node) => (node.section ? [node.section] : [])));
  if (used.size < 2) return;
  try {
    const { sections } = await runWorker<SectionLayouts>({ kind: 'sections', ...source }, (worker) => (state.worker = worker));
    state.worker = null;
    guarded(() => db.transaction(() => {
      for (const section of sections) save(db, projectId, 'dialogue', { status: 'ready', data: section.data, error: null }, section.name, direction);
    }));
  } catch (error) {
    state.worker = null;
    if (error instanceof Cancelled) throw error;
    console.error('section layouts failed', error);
  }
  events.changed(projectId, 'graph');
}
