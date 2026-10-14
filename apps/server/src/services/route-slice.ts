import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/**
 * A slice of the dialogue graph for one set of choices (길 따라 보기): everything a player can see
 * having made them, as a small graph to read and translate along. The graph is followed only along
 * its edges; nothing is guessed.
 *
 * - Choice forks (a condition, or a line or option whose ways out are options or carry their own
 *   names; numbering labels like "Sibling 0" do not count) are
 *   exclusive: the slice takes one arm — the one a person picked (routePicks), else the first in the
 *   script — and every other arm becomes a stub: its name, how many lines it holds before it comes
 *   back, and where it comes back (a join, the place to check that the lines after it fit every way in).
 * - Every other fork (a state, an event, a wait opening several chats or documents at once, a hub)
 *   is parallel: all its ways are in the slice, side by side.
 * - Straight runs fold into one block, so the slice stays small enough to draw whole.
 */
export interface SliceFork {
  nodeId: string;
  mode: 'choice' | 'parallel';
  arms: { nodeId: string; label: string; chosen: boolean; picked: boolean }[];
}
export interface SliceStub {
  /** `stub:<fork>:<arm>`. */
  id: string;
  fork: string;
  arm: string;
  label: string;
  /** Lines in this arm before it reaches the slice again (counted up to STUB_SCAN nodes). */
  lines: number;
  /** Slice nodes it comes back to (joins). Empty: it never comes back (a separate ending). */
  rejoins: string[];
}
export interface SliceBlock {
  /** A graph node id, or `block:<first node id>` for a folded straight run. */
  id: string;
  /** The graph nodes it stands for, in order. */
  nodeIds: string[];
  /** Their lines, in order. */
  unitIds: string[];
  kind: string;
}
export interface RouteSlice {
  blocks: SliceBlock[];
  /** Between blocks of the slice, and from a fork to its stubs and from a stub back to its joins. */
  edges: { from: string; to: string; label: string | null; kind: 'path' | 'stub' | 'rejoin' }[];
  forks: SliceFork[];
  stubs: SliceStub[];
  /** Blocks that more than one way leads into: where a stub comes back or parallel lanes meet. */
  joins: string[];
  /** Lines in the slice / in the graph. */
  lines: number;
  totalLines: number;
  /** The slice at a glance: sections between choices, with the stubs (edges as above, between overview nodes and stubs). */
  overview: { nodes: SliceSection[]; edges: RouteSlice['edges'] };
}
/**
 * One node of the overview: an anchor (a block where a choice is made, where a stub comes back, or
 * where the slice starts) or a section (every block between anchors, parallel lanes included).
 */
export interface SliceSection {
  /** The anchor's block id, or `section:<first block id>`. */
  id: string;
  kind: 'anchor' | 'section';
  blockIds: string[];
  nodeIds: string[];
  unitIds: string[];
  /** Ways a parallel fork inside opens at once (0: none, the section reads straight). */
  lanes: number;
  /** A choice is made here (its stubs leave from it). */
  choice: boolean;
  /** A stub comes back here: the lines after it must fit every way in. */
  join: boolean;
}

type GraphNode = { id: string; key: string; kind: string; unitIds: string[] };
type GraphEdge = { from: string; to: string; label: string | null };

/** Nodes a stub's scan may visit before it gives up counting (a huge side arm is still one stub). */
const STUB_SCAN = 5_000;

const cache = new Map<string, { key: string; slice: RouteSlice }>();

/** The project's slice with its stored picks; kept until the graph, the lines or the picks change. */
export function projectSlice(db: Db, projectId: string): RouteSlice {
  const picks = db.select({ picks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.picks ?? {};
  const counts = db.get<{ nodes: number; edges: number; units: number; changed: number | null }>(
    sql`select (select count(*) from ${s.graphNodes} where ${s.graphNodes.projectId} = ${projectId}) as nodes, (select count(*) from ${s.graphEdges} where ${s.graphEdges.projectId} = ${projectId}) as edges, (select count(*) from ${s.units} where ${s.units.projectId} = ${projectId}) as units, (select max(${s.graphLayouts.updatedAt}) from ${s.graphLayouts} where ${s.graphLayouts.projectId} = ${projectId}) as changed`,
  );
  const key = JSON.stringify([picks, counts]);
  const hit = cache.get(projectId);
  if (hit?.key === key) return hit.slice;
  const slice = buildSlice(db, projectId, picks);
  cache.set(projectId, { key, slice });
  return slice;
}

function buildSlice(db: Db, projectId: string, picks: Record<string, string>): RouteSlice {
  const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key, kind: s.graphNodes.kind, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const edges = db.select({ from: s.graphEdges.fromId, to: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const units = new Map(db.select({ id: s.units.id, seq: s.units.seq, source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit]));
  return sliceRoute(nodes, edges, units, picks);
}

export function sliceRoute(nodes: GraphNode[], edges: GraphEdge[], units: Map<string, { seq: number; source: string }>, picks: Record<string, string>): RouteSlice {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const out = new Map<string, GraphEdge[]>(nodes.map((node) => [node.id, []]));
  const indeg = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue;
    const ways = out.get(edge.from)!;
    const same = ways.find((way) => way.to === edge.to);
    if (same) same.label ??= edge.label;
    else {
      ways.push({ ...edge });
      indeg.set(edge.to, indeg.get(edge.to)! + 1);
    }
  }

  // A node's place in the script: its first line, else the first line after it.
  const own = new Map(nodes.map((node) => [node.id, Math.min(Infinity, ...node.unitIds.map((id) => units.get(id)?.seq ?? Infinity))]));
  const lead = new Map(own);
  for (const node of nodes) {
    if (lead.get(node.id) !== Infinity) continue;
    const seen = new Set([node.id]);
    let frontier = [node.id];
    let found = Infinity;
    for (let depth = 0; depth < 8 && frontier.length && found === Infinity; depth++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const way of out.get(id)!) {
          if (seen.has(way.to)) continue;
          seen.add(way.to);
          if (own.get(way.to)! !== Infinity) found = Math.min(found, own.get(way.to)!);
          else next.push(way.to);
        }
      frontier = next;
    }
    lead.set(node.id, found);
  }
  const bySeq = (a: string, b: string) => lead.get(a)! - lead.get(b)! || (a < b ? -1 : a > b ? 1 : 0);

  // Labels that only number the ways ("Sibling 0", "Sibling 1") say nothing about them.
  const numbering = (ways: GraphEdge[]) => ways.every((way) => /^\S+ \d+$/.test(way.label?.trim() ?? '')) && new Set(ways.map((way) => way.label!.trim().split(' ')[0])).size === 1;
  const named = (id: string) => {
    const ways = out.get(id)!;
    return ways.every((way) => way.label?.trim()) && !numbering(ways);
  };
  // Exclusive: a condition, or a line or option whose ways are options or named ways. Anything else
  // that fans out (a state opening chats and documents at once, an event, a hub) runs in parallel.
  const exclusive = (id: string) => {
    const ways = out.get(id)!;
    if (ways.length < 2) return false;
    const kind = byId.get(id)!.kind;
    if (kind === 'condition') return true;
    return (kind === 'script' || kind === 'choice') && (ways.every((way) => byId.get(way.to)!.kind === 'choice') || named(id));
  };
  const armLabel = (from: string, way: GraphEdge) => {
    if (way.label?.trim() && !numbering(out.get(from)!)) return way.label.trim();
    const target = byId.get(way.to)!;
    const first = target.unitIds.map((id) => units.get(id)?.source.trim()).find(Boolean);
    return first ? (first.length > 60 ? `${first.slice(0, 59)}…` : first) : target.key;
  };

  // The slice: from every starting point, all ways at a parallel fork, the chosen one at a choice.
  const chosenAt = new Map<string, string>();
  const inSlice = new Set<string>();
  const starts = nodes.filter((node) => indeg.get(node.id) === 0).map((node) => node.id).sort(bySeq);
  if (!starts.length && nodes.length) starts.push([...byId.keys()].sort(bySeq)[0]!);
  const queue = [...starts];
  for (const id of queue) inSlice.add(id);
  while (queue.length) {
    const id = queue.shift()!;
    let ways = out.get(id)!;
    if (exclusive(id)) {
      const picked = picks[id];
      const chosen = ways.find((way) => way.to === picked) ?? [...ways].sort((a, b) => bySeq(a.to, b.to))[0]!;
      chosenAt.set(id, chosen.to);
      ways = [chosen];
    }
    for (const way of ways)
      if (!inSlice.has(way.to)) {
        inSlice.add(way.to);
        queue.push(way.to);
      }
  }

  // Stubs: each arm a choice did not take, scanned until it reaches the slice again.
  const stubs: SliceStub[] = [];
  const forks: SliceFork[] = [];
  for (const id of [...inSlice].sort(bySeq)) {
    const ways = [...out.get(id)!].sort((a, b) => bySeq(a.to, b.to));
    if (ways.length < 2) continue;
    const chosen = chosenAt.get(id);
    forks.push({ nodeId: id, mode: chosen ? 'choice' : 'parallel', arms: ways.map((way) => ({ nodeId: way.to, label: armLabel(id, way), chosen: !chosen || way.to === chosen, picked: picks[id] === way.to })) });
    if (!chosen) continue;
    for (const way of ways) {
      if (way.to === chosen) continue;
      const rejoins = new Set<string>();
      const seen = new Set<string>();
      let lines = 0;
      const scan = [way.to];
      while (scan.length && seen.size < STUB_SCAN) {
        const n = scan.pop()!;
        if (inSlice.has(n)) {
          rejoins.add(n);
          continue;
        }
        if (seen.has(n)) continue;
        seen.add(n);
        lines += byId.get(n)!.unitIds.length;
        for (const next of out.get(n)!) scan.push(next.to);
      }
      stubs.push({ id: `stub:${id}:${way.to}`, fork: id, arm: way.to, label: armLabel(id, way), lines, rejoins: [...rejoins].sort(bySeq) });
    }
  }

  // Ways in the slice (a choice keeps only its chosen way).
  const sliceOut = new Map<string, GraphEdge[]>();
  for (const id of inSlice) sliceOut.set(id, out.get(id)!.filter((way) => inSlice.has(way.to) && (!chosenAt.has(id) || chosenAt.get(id) === way.to)));
  const rejoined = new Set(stubs.flatMap((stub) => stub.rejoins));
  const forkAt = new Set(forks.map((fork) => fork.nodeId));
  // Nodes without lines that neither part nor join ways (empty states, waits, connectors in a row)
  // are drawn as the line between their neighbours, not as boxes.
  const inCount = new Map<string, number>([...inSlice].map((id) => [id, 0]));
  for (const ways of sliceOut.values()) for (const way of ways) inCount.set(way.to, inCount.get(way.to)! + 1);
  // Through nodes `show` hides to the next ones it shows, keeping the first label met.
  const nextBy = (show: (id: string) => boolean, id: string) => {
    const found = new Map<string, string | null>();
    const seen = new Set<string>();
    const walk = (from: string, label: string | null) => {
      for (const way of sliceOut.get(from)!) {
        const kept = label ?? way.label;
        if (show(way.to)) {
          if (!found.has(way.to)) found.set(way.to, kept);
        } else if (!seen.has(way.to)) {
          seen.add(way.to);
          walk(way.to, kept);
        }
      }
    };
    walk(id, null);
    return found;
  };
  // Lines, options, choices, where a stub comes back and where ways meet are always drawn; a node
  // without lines that fans out is drawn only when at least two drawn ways leave it.
  const base = (id: string) => byId.get(id)!.unitIds.length > 0 || chosenAt.has(id) || rejoined.has(id) || inCount.get(id)! > 1 || byId.get(id)!.kind === 'choice';
  const fansOut = new Set([...forkAt].filter((id) => !base(id) && nextBy(base, id).size > 1));
  const shown = (id: string) => base(id) || fansOut.has(id);
  const nextShown = (id: string) => nextBy(shown, id);
  const visible = [...inSlice].filter(shown).sort(bySeq);
  const links = new Map(visible.map((id) => [id, nextShown(id)]));
  const linksIn = new Map<string, number>(visible.map((id) => [id, 0]));
  for (const next of links.values()) for (const to of next.keys()) linksIn.set(to, linksIn.get(to)! + 1);

  // Straight runs of shown nodes fold into one block; a run breaks where ways part or meet, at an
  // option (read on its own) and where a stub comes back.
  const single = (id: string) => links.get(id)!.size === 1 && !chosenAt.has(id) && byId.get(id)!.kind !== 'choice';
  // A fork without lines of its own (a condition, a state opening several ways) is drawn on its own: where the ways part shows.
  const joinable = (id: string) => linksIn.get(id) === 1 && !rejoined.has(id) && byId.get(id)!.kind !== 'choice' && (byId.get(id)!.unitIds.length > 0 || (!chosenAt.has(id) && !fansOut.has(id)));
  const blockOf = new Map<string, string>();
  const blocks: SliceBlock[] = [];
  for (const id of visible) {
    if (blockOf.has(id)) continue;
    const run = [id];
    blockOf.set(id, id);
    let at = id;
    while (single(at)) {
      const next = [...links.get(at)!.keys()][0]!;
      if (blockOf.has(next) || !joinable(next)) break;
      run.push(next);
      blockOf.set(next, id);
      at = next;
    }
    const blockId = run.length > 1 ? `block:${id}` : id;
    for (const member of run) blockOf.set(member, blockId);
    blocks.push({ id: blockId, nodeIds: run, unitIds: run.flatMap((member) => byId.get(member)!.unitIds), kind: run.length > 1 ? 'block' : byId.get(id)!.kind });
  }

  const pathEdges = new Map<string, RouteSlice['edges'][number]>();
  for (const [id, next] of links)
    for (const [to, label] of next) {
      const from = blockOf.get(id)!, toBlock = blockOf.get(to)!;
      if (from === toBlock) continue;
      const key = `${from}|${toBlock}`;
      if (!pathEdges.has(key)) pathEdges.set(key, { from, to: toBlock, label, kind: 'path' });
    }
  const edgesOut: RouteSlice['edges'] = [...pathEdges.values()];
  for (const stub of stubs) {
    edgesOut.push({ from: blockOf.get(stub.fork)!, to: stub.id, label: stub.label, kind: 'stub' });
    for (const join of stub.rejoins) if (blockOf.has(join)) edgesOut.push({ from: stub.id, to: blockOf.get(join)!, label: null, kind: 'rejoin' });
  }
  const into = new Map<string, number>();
  for (const edge of edgesOut) into.set(edge.to, (into.get(edge.to) ?? 0) + 1);
  const joins = blocks.filter((block) => (into.get(block.id) ?? 0) > 1).map((block) => block.id);
  const lines = blocks.reduce((sum, block) => sum + block.unitIds.length, 0);

  // The overview: what lies between two choices (or a choice and the place a stub comes back) is one
  // section, parallel lanes and their meetings included; choices, those places and starts stay.
  const chosenBlocks = new Set([...chosenAt.keys()].map((id) => blockOf.get(id)).filter((id): id is string => Boolean(id)));
  const rejoinBlocks = new Set([...rejoined].map((id) => blockOf.get(id)).filter((id): id is string => Boolean(id)));
  const pathInto = new Map<string, number>();
  for (const edge of pathEdges.values()) pathInto.set(edge.to, (pathInto.get(edge.to) ?? 0) + 1);
  const anchor = (id: string) => chosenBlocks.has(id) || rejoinBlocks.has(id) || !pathInto.get(id);
  const parent = new Map(blocks.map((block) => [block.id, block.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const edge of pathEdges.values()) if (!anchor(edge.from) && !anchor(edge.to)) parent.set(find(edge.from), find(edge.to));
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const members = Map.groupBy(blocks.filter((block) => !anchor(block.id)), (block) => find(block.id));
  const sectionOf = new Map<string, string>();
  const overviewNodes: SliceSection[] = [];
  for (const block of blocks) {
    if (!anchor(block.id)) continue;
    sectionOf.set(block.id, block.id);
    overviewNodes.push({ id: block.id, kind: 'anchor', blockIds: [block.id], nodeIds: block.nodeIds, unitIds: block.unitIds, lanes: 0, choice: chosenBlocks.has(block.id), join: rejoinBlocks.has(block.id) });
  }
  for (const group of members.values()) {
    const ordered = [...group].sort((a, b) => bySeq(a.nodeIds[0]!, b.nodeIds[0]!));
    const id = `section:${ordered[0]!.id}`;
    for (const block of ordered) sectionOf.set(block.id, id);
    const nodeIds = ordered.flatMap((block) => block.nodeIds);
    // Lanes: the most ways a parallel fork inside opens at once.
    const lanes = Math.max(0, ...nodeIds.filter((n) => forkAt.has(n) && !chosenAt.has(n)).map((n) => (links.get(n)?.size ?? 0)));
    overviewNodes.push({ id, kind: 'section', blockIds: ordered.map((block) => block.id), nodeIds, unitIds: ordered.flatMap((block) => block.unitIds), lanes: lanes > 1 ? lanes : 0, choice: false, join: false });
  }
  overviewNodes.sort((a, b) => bySeq(a.nodeIds[0]!, b.nodeIds[0]!));
  // A way into a section through an option carries the option's text, as the choice reads in the game.
  const optionText = (blockId: string) => {
    const block = blockById.get(blockId)!;
    if (block.kind !== 'choice') return null;
    const first = block.unitIds.map((id) => units.get(id)?.source.trim()).find(Boolean);
    return first ? (first.length > 60 ? `${first.slice(0, 59)}…` : first) : null;
  };
  const overviewEdges = new Map<string, RouteSlice['edges'][number]>();
  for (const edge of edgesOut) {
    const from = sectionOf.get(edge.from) ?? edge.from, to = sectionOf.get(edge.to) ?? edge.to;
    if (from === to) continue;
    const key = `${from}|${to}|${edge.kind}`;
    if (!overviewEdges.has(key)) overviewEdges.set(key, { ...edge, from, to, label: edge.label ?? (edge.kind === 'path' ? optionText(edge.to) : null) });
  }
  return { blocks, edges: edgesOut, forks, stubs, joins, lines, totalLines: units.size, overview: { nodes: overviewNodes, edges: [...overviewEdges.values()] } };
}
