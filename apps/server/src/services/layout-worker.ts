import { parentPort, workerData } from 'node:worker_threads';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { LayoutData } from '../db/schema.ts';
import { deriveSceneGraph, reduceSceneEdges } from './scene-graph.ts';

export interface LayoutJob {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; from: string; to: string }[];
  /** Nodes joined only by drawn (not laid out) edges, placed in this order in a labelled grid. */
  ordered?: { label: string; ids: string[] };
}

/**
 * The raw dialogue graph for the scene layout. Deriving scene links (and dropping the ones also
 * reachable through another scene) can take minutes on graphs with hubs, so it happens here, off
 * the server's event loop.
 */
export interface SceneSource {
  scenes: string[];
  nodes: { id: string; groupId: string | null }[];
  edges: { fromId: string; toId: string }[];
  size: [number, number];
}

export type WorkerJob = { kind: 'layout'; job: LayoutJob } | { kind: 'scenes'; source: SceneSource };

const HUB_SIZE: [number, number] = [160, 48];

function sceneLayoutJob(source: SceneSource): LayoutJob & { hidden: { from: string; to: string }[]; hubs: { id: string; nodes: number; scenes: number }[]; loose: LayoutJob['edges'] } {
  const scenes = new Set(source.scenes);
  // Document / UI nodes are passed through like control nodes, never treated as an endpoint.
  const graph = deriveSceneGraph(source.nodes, source.edges);
  const hubIds = new Set(graph.hubs.map((hub) => hub.id));
  // Scene-to-scene links are simplified as before; links to and from hubs are drawn, not laid out
  // (one way into each hub stays, so the hub sits in the flow), like hub edges in the dialogue graph.
  const { kept, hidden } = reduceSceneEdges(graph.edges.filter((edge) => scenes.has(edge.from) && scenes.has(edge.to)));
  const anchored = new Set<string>();
  const anchors: typeof graph.edges = [];
  const loose: typeof graph.edges = [];
  for (const edge of graph.edges) {
    if (!hubIds.has(edge.from) && !hubIds.has(edge.to)) continue;
    if (!(scenes.has(edge.from) || hubIds.has(edge.from)) || !(scenes.has(edge.to) || hubIds.has(edge.to))) continue;
    if (hubIds.has(edge.to) && scenes.has(edge.from) && !anchored.has(edge.to)) {
      anchored.add(edge.to);
      anchors.push(edge);
    } else loose.push(edge);
  }
  const throughHub = new Set(loose.flatMap((edge) => [edge.from, edge.to]));
  return {
    nodes: [...source.scenes.map((id) => ({ id, width: source.size[0], height: source.size[1] })), ...graph.hubs.map((hub) => ({ id: hub.id, width: HUB_SIZE[0], height: HUB_SIZE[1] }))],
    edges: [...kept, ...anchors].map((edge, index) => ({ id: `s${index}`, from: edge.from, to: edge.to })),
    hidden: hidden.map(({ from, to }) => ({ from, to })),
    hubs: graph.hubs.map((hub) => ({ id: hub.id, nodes: hub.nodeIds.length, scenes: hub.scenes })),
    loose: loose.map((edge, index) => ({ id: `h${index}`, from: edge.from, to: edge.to })),
    ordered: { label: '연결점으로 이어진 장면 {n}개 (대본 순서)', ids: source.scenes.filter((id) => throughHub.has(id)) },
  };
}

/** A dialogue node with more connections than this is a hub; its edges are drawn, not laid out. */
const HUB_DEGREE = 20;

/**
 * ELK runs out of memory on hubs: one node joined to hundreds of others far apart in the flow.
 * Their edges are laid out without, except one way in per hub so it sits in the flow; the rest
 * come back as loose edges (real edges, drawn straight by the page).
 */
function withoutHubEdges(job: LayoutJob): { job: LayoutJob; loose: LayoutJob['edges'] } {
  const degree = new Map<string, number>();
  for (const edge of job.edges) for (const id of [edge.from, edge.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const hubs = new Set([...degree].filter(([, count]) => count > HUB_DEGREE).map(([id]) => id));
  if (!hubs.size) return { job, loose: [] };
  const anchored = new Set<string>();
  const kept: LayoutJob['edges'] = [];
  const loose: LayoutJob['edges'] = [];
  for (const edge of job.edges) {
    const touchesHub = hubs.has(edge.from) || hubs.has(edge.to);
    // Keep the first edge into each hub (from a non-hub) so the hub is placed after it.
    if (touchesHub && hubs.has(edge.to) && !hubs.has(edge.from) && !anchored.has(edge.to)) {
      anchored.add(edge.to);
      kept.push(edge);
    } else if (touchesHub) loose.push(edge);
    else kept.push(edge);
  }
  return { job: { ...job, edges: kept }, loose };
}
async function run(work: WorkerJob): Promise<LayoutData> {
  if (work.kind === 'layout') {
    const { job, loose } = withoutHubEdges(work.job);
    const data = await layout(job);
    if (loose.length) data.looseEdges = loose;
    return data;
  }
  const { hidden, hubs, loose, ...job } = sceneLayoutJob(work.source);
  const data = await layout(job);
  if (hidden.length) data.hiddenEdges = hidden;
  if (hubs.length) data.hubs = hubs;
  if (loose.length) data.looseEdges = loose;
  return data;
}

/**
 * Plain ELK layered, top to bottom. No layer-width bound and no hand-made component stacking:
 * ELK packs disconnected components itself and Brandes–Köpf keeps chains on one vertical line.
 * Runs in a worker with a large stack because ELK's cycle breaking recurses along long chains.
 */
const OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.separateConnectedComponents': 'true',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.spacing.nodeNode': '48',
  'elk.spacing.componentComponent': '120',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
  'elk.layered.thoroughness': '3',
  'elk.randomSeed': '1',
};

const GAP = 400;

async function layout(job: LayoutJob): Promise<LayoutData> {
  const elk = new ELK();
  const linked = new Set(job.edges.flatMap((edge) => [edge.from, edge.to]));
  const inOrder = new Set(job.ordered?.ids.filter((id) => !linked.has(id)));
  const connected = job.nodes.filter((node) => linked.has(node.id));
  const isolated = job.nodes.filter((node) => !linked.has(node.id) && !inOrder.has(node.id));

  const main: ElkNode = connected.length
    ? await elk.layout({
        id: 'root',
        layoutOptions: OPTIONS,
        children: connected.map((node) => ({ id: node.id, width: node.width, height: node.height })),
        edges: job.edges.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
      })
    : { id: 'root', width: 0, height: 0, children: [], edges: [] };

  // Lines with no connection at all are packed into their own block beside the flow, so they stay
  // visible without stretching the flow layout into one enormous row.
  const loose: ElkNode | undefined = isolated.length
    ? await elk.layout({
        id: 'loose',
        layoutOptions: { 'elk.algorithm': 'rectpacking', 'elk.aspectRatio': '1.0', 'elk.spacing.nodeNode': '24' },
        children: isolated.map((node) => ({ id: node.id, width: node.width, height: node.height })),
      })
    : undefined;
  const offsetX = connected.length ? (main.width ?? 0) + GAP : 0;

  // Nodes joined only through drawn edges (scenes reached through a hub), in the given order, in
  // rows below the flow: their position says "script order", not "unconnected".
  const byId = new Map(job.nodes.map((node) => [node.id, node]));
  const grid = (job.ordered?.ids ?? []).filter((id) => inOrder.has(id)).map((id) => byId.get(id)!);
  const gridTop = Math.max(main.height ?? 0, loose?.height ?? 0) + (grid.length ? GAP : 0);
  const columns = Math.max(1, Math.ceil(Math.sqrt(grid.length * 2)));
  const cellWidth = Math.max(0, ...grid.map((node) => node.width)) + 24;
  const cellHeight = Math.max(0, ...grid.map((node) => node.height)) + 24;
  const gridNodes = grid.map((node, index) => ({ id: node.id, x: (index % columns) * cellWidth, y: gridTop + Math.floor(index / columns) * cellHeight, width: node.width, height: node.height }));
  const gridWidth = grid.length ? Math.min(grid.length, columns) * cellWidth : 0;
  const gridHeight = grid.length ? Math.ceil(grid.length / columns) * cellHeight : 0;

  const ends = new Map(job.edges.map((edge) => [edge.id, edge]));
  const place = (node: ElkNode, dx = 0) => ({ id: node.id, x: (node.x ?? 0) + dx, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 });
  return {
    width: Math.max(offsetX + (loose?.width ?? 0), gridWidth),
    height: grid.length ? gridTop + gridHeight : Math.max(main.height ?? 0, loose?.height ?? 0),
    nodes: [...(main.children ?? []).map((node) => place(node)), ...(loose?.children ?? []).map((node) => place(node, offsetX)), ...gridNodes],
    edges: (main.edges ?? []).map((edge) => {
      const points: number[] = [];
      for (const section of edge.sections ?? []) {
        points.push(section.startPoint.x, section.startPoint.y);
        for (const bend of section.bendPoints ?? []) points.push(bend.x, bend.y);
        points.push(section.endPoint.x, section.endPoint.y);
      }
      const original = ends.get(edge.id)!;
      return { id: edge.id, from: original.from, to: original.to, points: points.map((value) => Math.round(value)) };
    }),
    regions: [
      ...(loose ? [{ label: `연결 없는 노드 ${isolated.length.toLocaleString()}개`, x: offsetX, y: 0, width: loose.width ?? 0, height: loose.height ?? 0 }] : []),
      ...(grid.length ? [{ label: `${job.ordered!.label.replace('{n}', grid.length.toLocaleString())}`, x: 0, y: gridTop, width: gridWidth, height: gridHeight }] : []),
    ],
  };
}

run(workerData as WorkerJob).then(
  (data) => parentPort!.postMessage({ ok: true, data }),
  (error: unknown) => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
);
