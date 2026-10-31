import { parentPort, workerData } from 'node:worker_threads';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { LayoutData } from '../db/schema.ts';
import type { LayoutDirection, LayoutJob } from './layout-types.ts';
import { deriveSceneGraph, depthBlocks, reduceSceneEdges } from './scene-graph.ts';
import { foldChains } from './chains.ts';
import { sectionJobs, type SectionNode } from './section-graph.ts';
import { byRank } from './script-rank.ts';

export type { LayoutDirection, LayoutJob } from './layout-types.ts';

/**
 * The raw dialogue graph for the scene layout. Deriving scene links (and dropping the ones also
 * reachable through another scene) can take minutes on graphs with hubs, so it happens here, off
 * the server's event loop.
 */
export interface SceneSource {
  direction?: LayoutDirection;
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
  | { kind: 'sections'; nodes: SectionNode[]; edges: LayoutJob['edges']; order: string[]; direction?: LayoutDirection }
  /** Only the section named `view` of such a split: chosen scenes, with portals named after the scenes around them. */
  | { kind: 'view'; nodes: SectionNode[]; edges: LayoutJob['edges']; view: string; direction?: LayoutDirection };

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
    direction: source.direction,
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
  const groupOf = new Map(work.nodes.map((node) => [node.id, node.group]));
  const kept = new Set(work.nodes.filter((node) => node.keep).map((node) => node.id));
  const folded = foldChains(work, (id) => groupOf.get(id), (id) => kept.has(id));
  const { job, loose } = withoutHubEdges(folded.job);
  const data = await layout(job);
  // Labels and folded choices ride along with the laid-out edges.
  const said = new Map(job.edges.flatMap((edge) => (edge.label || edge.via ? [[edge.id, { label: edge.label, via: edge.via }] as const] : [])));
  data.edges = data.edges.map((edge) => (said.has(edge.id) ? { ...edge, ...said.get(edge.id) } : edge));
  if (loose.length) data.looseEdges = loose;
  if (folded.chains.length) data.chains = folded.chains;
  return data;
}

async function run(work: WorkerJob): Promise<LayoutData | SectionLayouts> {
  if (work.kind === 'layout') return dialogueLayout(work.job);
  if (work.kind === 'view') {
    const section = sectionJobs(work.nodes, work.edges, [work.view]).find((job) => job.name === work.view);
    if (!section) return { width: 0, height: 0, nodes: [], edges: [] };
    section.job.direction = work.direction;
    const data = await dialogueLayout(section.job);
    if (section.portals.length) data.portals = section.portals;
    return data;
  }
  if (work.kind === 'sections') {
    const sections: SectionLayouts['sections'] = [];
    for (const section of sectionJobs(work.nodes, work.edges, work.order)) {
      section.job.direction = work.direction;
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
 * Plain ELK layered, down for source graphs and right for their horizontal view. No layer-width
 * bound or hand-made component stacking: ELK places disconnected components and routes edges
 * around upright nodes in either direction.
 * Runs in a worker with a large stack because ELK's cycle breaking recurses along long chains.
 */
/** Size given to an edge label (a choice's text): about 8px a character (capitals are wide) plus the play mark, one line. */
const LABEL_HEIGHT = 22;
const labelWidth = (text: string) => Math.min(240, 30 + Math.ceil(text.length * 8));

const OPTIONS = {
  'elk.algorithm': 'layered',
  // Straight segments with slanted bends: right-angled edges share their horizontal runs like bus
  // lines where branches part and meet, and splines wobble (long S-curves between layers); a
  // polyline keeps each edge its own line and straight where it can be.
  'elk.edgeRouting': 'POLYLINE',
  'elk.edgeLabels.placement': 'CENTER',
  // The edge runs through its label (a choice), and the label has its own room, so it neither
  // floats beside the line nor lies under a node.
  'elk.edgeLabels.inline': 'true',
  'elk.spacing.edgeLabel': '20',
  'elk.separateConnectedComponents': 'true',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.spacing.nodeNode': '64',
  'elk.spacing.componentComponent': '120',
  'elk.layered.spacing.nodeNodeBetweenLayers': '112',
  'elk.layered.spacing.edgeNodeBetweenLayers': '32',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
  'elk.spacing.edgeNode': '32',
  'elk.layered.thoroughness': '3',
  'elk.randomSeed': '1',
};

const GAP = 400;

async function layout(job: LayoutJob): Promise<LayoutData> {
  const elk = new ELK();
  const horizontal = job.direction === 'horizontal';
  const linked = new Set(job.edges.flatMap((edge) => [edge.from, edge.to]));
  const inOrder = new Set(job.ordered?.blocks.flatMap((block) => [...(block.heads ?? []), ...block.rows.flat()]).filter((id) => !linked.has(id)));
  // In script order: ELK enters a loop at the first node it is given.
  const connected = byRank(job.nodes.filter((node) => linked.has(node.id)));
  const isolated = job.nodes.filter((node) => !linked.has(node.id) && !inOrder.has(node.id));

  const main: ElkNode = connected.length
    ? await elk.layout({
        id: 'root',
        layoutOptions: { ...OPTIONS, 'elk.direction': horizontal ? 'RIGHT' : 'DOWN' },
        children: connected.map((node) => ({ id: node.id, width: node.width, height: node.height })),
        // A labelled edge gets room for its label (ELK places it and routes around it).
        edges: job.edges.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to], ...(edge.label && { labels: [{ id: `${edge.id}:label`, text: edge.label, width: labelWidth(edge.label), height: LABEL_HEIGHT }] }) })),
      })
    : { id: 'root', width: 0, height: 0, children: [], edges: [] };

  // Lines with no connection at all are packed into their own block beside the flow, so they stay
  // visible without stretching the flow layout into one enormous row.
  const loose: ElkNode | undefined = isolated.length
    ? await elk.layout({
        id: 'loose',
        layoutOptions: { 'elk.algorithm': 'rectpacking', 'elk.aspectRatio': horizontal ? '2.0' : '1.0', 'elk.spacing.nodeNode': '24' },
        children: isolated.map((node) => ({ id: node.id, width: node.width, height: node.height })),
      })
    : undefined;
  const offsetX = horizontal ? 0 : connected.length ? (main.width ?? 0) + GAP : 0;
  const offsetY = horizontal ? (main.height ?? 0) + (isolated.length ? GAP : 0) : 0;

  // Nodes joined only through drawn edges (scenes reached through a hub): one block per section,
  // side by side below the flow, rows from top to bottom (see depthBlocks).
  const byId = new Map(job.nodes.map((node) => [node.id, node]));
  const blocks = (job.ordered?.blocks ?? [])
    .map((block) => ({ name: block.name, scenes: block.rows.flat().filter((id) => inOrder.has(id)).length, rows: [block.heads ?? [], ...block.rows].map((row) => row.filter((id) => inOrder.has(id)).map((id) => byId.get(id)!)).filter((row) => row.length) }))
    .filter((block) => block.rows.length);
  const gridTop = horizontal ? 0 : Math.max(main.height ?? 0, loose?.height ?? 0) + (blocks.length ? GAP : 0);
  const gridLeft = horizontal ? Math.max(main.width ?? 0, loose?.width ?? 0) + (blocks.length ? GAP : 0) : 0;
  const gridNodes: { id: string; x: number; y: number; width: number; height: number }[] = [];
  const gridRegions: { label: string; x: number; y: number; width: number; height: number }[] = [];
  let blockLeft = 0;
  let blockTop = 0;
  let gridHeight = 0;
  let gridWidth = 0;
  for (const block of blocks) {
    const all = block.rows.flat();
    const cellWidth = Math.max(...all.map((node) => node.width)) + 24;
    const cellHeight = Math.max(...all.map((node) => node.height)) + 40;
    if (horizontal) {
      const width = block.rows.length * cellWidth;
      const height = Math.max(...block.rows.map((row) => row.length)) * cellHeight;
      block.rows.forEach((row, depthIndex) => {
        const indent = (height - row.length * cellHeight) / 2;
        row.forEach((node, index) => gridNodes.push({ id: node.id, x: gridLeft + depthIndex * cellWidth, y: blockTop + indent + index * cellHeight, width: node.width, height: node.height }));
      });
      const label = job.ordered!.label.replace('{n}', block.scenes.toLocaleString());
      gridRegions.push({ label: block.name ? `${block.name} · ${label}` : label, x: gridLeft, y: blockTop, width, height });
      blockTop += height + GAP / 2;
      gridWidth = Math.max(gridWidth, width);
      gridHeight = Math.max(gridHeight, blockTop - GAP / 2);
      continue;
    }
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
    gridWidth = Math.max(gridWidth, blockLeft - GAP / 2);
  }
  if (!horizontal) gridWidth = blocks.length ? blockLeft - GAP / 2 : 0;

  const ends = new Map(job.edges.map((edge) => [edge.id, edge]));
  const place = (node: ElkNode, dx = 0, dy = 0) => ({ id: node.id, x: (node.x ?? 0) + dx, y: (node.y ?? 0) + dy, width: node.width ?? 0, height: node.height ?? 0 });
  return {
    width: Math.max(horizontal ? gridLeft + gridWidth : offsetX + (loose?.width ?? 0), main.width ?? 0),
    height: Math.max(gridTop + gridHeight, offsetY + (loose?.height ?? 0), main.height ?? 0),
    nodes: [...(main.children ?? []).map((node) => place(node)), ...(loose?.children ?? []).map((node) => place(node, offsetX, offsetY)), ...gridNodes],
    edges: (main.edges ?? []).map((edge) => {
      const points: number[] = [];
      for (const section of edge.sections ?? []) {
        points.push(section.startPoint.x, section.startPoint.y);
        for (const bend of section.bendPoints ?? []) points.push(bend.x, bend.y);
        points.push(section.endPoint.x, section.endPoint.y);
      }
      const original = ends.get(edge.id)!;
      const label = edge.labels?.[0];
      // Spline routing gives start, then (control, control, end) triples per piece: drawn as Béziers.
      const curved = (edge.sections ?? []).length === 1 && points.length >= 8 && (points.length / 2 - 1) % 3 === 0;
      return { id: edge.id, from: original.from, to: original.to, points: points.map((value) => Math.round(value)), ...(curved && { curved: true as const }), ...(label?.x !== undefined && { labelAt: [Math.round(label.x), Math.round(label.y ?? 0), Math.round(label.width ?? 0), Math.round(label.height ?? 0)] as [number, number, number, number] }) };
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
