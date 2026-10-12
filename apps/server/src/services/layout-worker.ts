import { parentPort, workerData } from 'node:worker_threads';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { LayoutData } from '../db/schema.ts';
import { deriveSceneGraph, reduceSceneEdges } from './scene-graph.ts';

export interface LayoutJob {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; from: string; to: string }[];
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

function sceneLayoutJob(source: SceneSource): LayoutJob & { hidden: { from: string; to: string }[]; hubs: { id: string; nodes: number; scenes: number }[] } {
  const scenes = new Set(source.scenes);
  // Document / UI nodes are passed through like control nodes, never treated as an endpoint.
  const graph = deriveSceneGraph(source.nodes, source.edges);
  const hubIds = new Set(graph.hubs.map((hub) => hub.id));
  const inGraph = (id: string) => scenes.has(id) || hubIds.has(id);
  const { kept, hidden } = reduceSceneEdges(graph.edges.filter((edge) => inGraph(edge.from) && inGraph(edge.to)));
  return {
    nodes: [...source.scenes.map((id) => ({ id, width: source.size[0], height: source.size[1] })), ...graph.hubs.map((hub) => ({ id: hub.id, width: HUB_SIZE[0], height: HUB_SIZE[1] }))],
    edges: kept.map((edge, index) => ({ id: `s${index}`, from: edge.from, to: edge.to })),
    hidden: hidden.map(({ from, to }) => ({ from, to })),
    hubs: graph.hubs.map((hub) => ({ id: hub.id, nodes: hub.nodeIds.length, scenes: hub.scenes })),
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
  const { hidden, hubs, ...job } = sceneLayoutJob(work.source);
  const data = await layout(job);
  if (hidden.length) data.hiddenEdges = hidden;
  if (hubs.length) data.hubs = hubs;
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
  const connected = job.nodes.filter((node) => linked.has(node.id));
  const isolated = job.nodes.filter((node) => !linked.has(node.id));

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

  const ends = new Map(job.edges.map((edge) => [edge.id, edge]));
  const place = (node: ElkNode, dx = 0) => ({ id: node.id, x: (node.x ?? 0) + dx, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 });
  return {
    width: offsetX + (loose?.width ?? 0),
    height: Math.max(main.height ?? 0, loose?.height ?? 0),
    nodes: [...(main.children ?? []).map((node) => place(node)), ...(loose?.children ?? []).map((node) => place(node, offsetX))],
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
    regions: loose
      ? [{ label: `연결 없는 노드 ${isolated.length.toLocaleString()}개`, x: offsetX, y: 0, width: loose.width ?? 0, height: loose.height ?? 0 }]
      : [],
  };
}

run(workerData as WorkerJob).then(
  (data) => parentPort!.postMessage({ ok: true, data }),
  (error: unknown) => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
);
