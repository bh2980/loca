import { parentPort, workerData } from 'node:worker_threads';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { LayoutData } from '../db/schema.ts';
import { deriveSceneGraph, depthBlocks, reduceSceneEdges } from './scene-graph.ts';
import { sectionJobs, type SectionNode } from './section-graph.ts';

export interface LayoutJob {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; from: string; to: string }[];
  /**
   * Nodes joined only by drawn (not laid out) edges, placed in labelled blocks side by side (one
   * per section), each in rows from top to bottom; `{n}` in the label is the block's node count.
   */
  ordered?: { label: string; blocks: { name: string | null; rows: string[][]; heads?: string[] }[] };
}

/**
 * The raw dialogue graph for the scene layout. Deriving scene links (and dropping the ones also
 * reachable through another scene) can take minutes on graphs with hubs, so it happens here, off
 * the server's event loop.
 */
export interface SceneSource {
  scenes: string[];
  /** Section (chapter, act, day…) of each scene, in the order of `scenes`. */
  sections: (string | null)[];
  nodes: { id: string; groupId: string | null }[];
  edges: { fromId: string; toId: string }[];
  size: [number, number];
}

export type WorkerJob =
  | { kind: 'layout'; job: LayoutJob }
  | { kind: 'scenes'; source: SceneSource }
  /** The dialogue graph split by section, each section laid out on its own (see section-graph.ts). */
  | { kind: 'sections'; nodes: SectionNode[]; edges: LayoutJob['edges']; order: string[] }
  /** Only the section named `view` of such a split: chosen scenes, with portals named after the scenes around them. */
  | { kind: 'view'; nodes: SectionNode[]; edges: LayoutJob['edges']; view: string };

/** What the 'sections' job returns: one layout per section. */
export interface SectionLayouts {
  sections: { name: string; data: LayoutData }[];
}

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
  const throughHub = new Set(loose.flatMap((edge) => [edge.from, edge.to]).filter((id) => scenes.has(id)));
  // A hub whose scenes all sit in one section block heads that block: it is drawn on top of the
  // block and its lines into the block are left out (the block says the same thing); its other
  // links stay drawn. A hub spread over several blocks stays in the flow with all its lines.
  const blocks: { name: string | null; rows: string[][]; heads: string[] }[] = depthBlocks(source, throughHub).map((block) => ({ ...block, heads: [] }));
  const blockOf = new Map(blocks.flatMap((block, index) => block.rows.flat().map((id) => [id, index] as const)));
  const headed = new Map<string, number>();
  for (const hub of graph.hubs) {
    const touched = new Set(loose.flatMap((edge) => (edge.from === hub.id ? [edge.to] : edge.to === hub.id ? [edge.from] : [])).filter((id) => blockOf.has(id)).map((id) => blockOf.get(id)!));
    if (touched.size === 1) {
      const index = [...touched][0];
      headed.set(hub.id, index);
      blocks[index].heads.push(hub.id);
    }
  }
  const implied = (edge: { from: string; to: string }) => {
    const [hub, scene] = headed.has(edge.from) ? [edge.from, edge.to] : [edge.to, edge.from];
    return headed.has(hub) && blockOf.get(scene) === headed.get(hub);
  };
  const keptAnchors = anchors.filter((edge) => !headed.has(edge.to));
  const keptLoose = loose.filter((edge) => !implied(edge));
  return {
    nodes: [...source.scenes.map((id) => ({ id, width: source.size[0], height: source.size[1] })), ...graph.hubs.map((hub) => ({ id: hub.id, width: HUB_SIZE[0], height: HUB_SIZE[1] }))],
    edges: [...kept, ...keptAnchors].map((edge, index) => ({ id: `s${index}`, from: edge.from, to: edge.to })),
    hidden: hidden.map(({ from, to }) => ({ from, to })),
    hubs: graph.hubs.map((hub) => ({ id: hub.id, nodes: hub.nodeIds.length, scenes: hub.scenes })),
    loose: keptLoose.map((edge, index) => ({ id: `h${index}`, from: edge.from, to: edge.to })),
    ordered: { label: '연결점으로 이어진 장면 {n}개 (깊이순)', blocks },
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
async function dialogueLayout(work: LayoutJob) {
  const { job, loose } = withoutHubEdges(work);
  const data = await layout(job);
  if (loose.length) data.looseEdges = loose;
  return data;
}

async function run(work: WorkerJob): Promise<LayoutData | SectionLayouts> {
  if (work.kind === 'layout') return dialogueLayout(work.job);
  if (work.kind === 'view') {
    const section = sectionJobs(work.nodes, work.edges, [work.view]).find((job) => job.name === work.view);
    if (!section) return { width: 0, height: 0, nodes: [], edges: [] };
    const data = await dialogueLayout(section.job);
    if (section.portals.length) data.portals = section.portals;
    return data;
  }
  if (work.kind === 'sections') {
    const sections: SectionLayouts['sections'] = [];
    for (const section of sectionJobs(work.nodes, work.edges, work.order)) {
      const data = await dialogueLayout(section.job);
      if (section.portals.length) data.portals = section.portals;
      sections.push({ name: section.name, data });
    }
    return { sections };
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
  const inOrder = new Set(job.ordered?.blocks.flatMap((block) => [...(block.heads ?? []), ...block.rows.flat()]).filter((id) => !linked.has(id)));
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

  // Nodes joined only through drawn edges (scenes reached through a hub): one block per section,
  // side by side below the flow, rows from top to bottom (see depthBlocks).
  const byId = new Map(job.nodes.map((node) => [node.id, node]));
  const blocks = (job.ordered?.blocks ?? [])
    .map((block) => ({ name: block.name, scenes: block.rows.flat().filter((id) => inOrder.has(id)).length, rows: [block.heads ?? [], ...block.rows].map((row) => row.filter((id) => inOrder.has(id)).map((id) => byId.get(id)!)).filter((row) => row.length) }))
    .filter((block) => block.rows.length);
  const gridTop = Math.max(main.height ?? 0, loose?.height ?? 0) + (blocks.length ? GAP : 0);
  const gridNodes: { id: string; x: number; y: number; width: number; height: number }[] = [];
  const gridRegions: { label: string; x: number; y: number; width: number; height: number }[] = [];
  let blockLeft = 0;
  let gridHeight = 0;
  for (const block of blocks) {
    const all = block.rows.flat();
    const cellWidth = Math.max(...all.map((node) => node.width)) + 24;
    const cellHeight = Math.max(...all.map((node) => node.height)) + 40;
    const width = Math.max(...block.rows.map((row) => row.length)) * cellWidth;
    block.rows.forEach((row, rowIndex) => {
      // Rows are centred so a narrow level sits under the middle of a wide one.
      const indent = (width - row.length * cellWidth) / 2;
      row.forEach((node, index) => gridNodes.push({ id: node.id, x: blockLeft + indent + index * cellWidth, y: gridTop + rowIndex * cellHeight, width: node.width, height: node.height }));
    });
    const height = block.rows.length * cellHeight;
    const label = job.ordered!.label.replace('{n}', block.scenes.toLocaleString());
    gridRegions.push({ label: block.name ? `${block.name} · ${label}` : label, x: blockLeft, y: gridTop, width, height });
    blockLeft += width + GAP / 2;
    gridHeight = Math.max(gridHeight, height);
  }
  const gridWidth = blocks.length ? blockLeft - GAP / 2 : 0;

  const ends = new Map(job.edges.map((edge) => [edge.id, edge]));
  const place = (node: ElkNode, dx = 0) => ({ id: node.id, x: (node.x ?? 0) + dx, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 });
  return {
    width: Math.max(offsetX + (loose?.width ?? 0), gridWidth),
    height: blocks.length ? gridTop + gridHeight : Math.max(main.height ?? 0, loose?.height ?? 0),
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
      ...gridRegions,
    ],
  };
}

run(workerData as WorkerJob).then(
  (data) => parentPort!.postMessage({ ok: true, data }),
  (error: unknown) => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
);
