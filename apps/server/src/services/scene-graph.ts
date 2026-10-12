/**
 * Scene-level connections are derived, never extracted: scene A → scene B exists when some
 * dialogue node of A reaches a node of B through nodes that belong to no scene (conditions,
 * waits, documents, UI…). Edges inside one scene are not scene connections. Callers pass
 * groupId only for scene groups.
 */
export interface DerivedSceneEdge {
  from: string;
  to: string;
  /** Number of dialogue-graph paths that produced this scene connection. */
  weight: number;
}

/** A component of nodes outside every scene (menus, return points) that joins many scenes. */
export interface SceneHub {
  /** "hub:" + the component's first node id; a node of the scene graph, not a group. */
  id: string;
  nodeIds: string[];
  /** Distinct scenes it connects (in and out). */
  scenes: number;
}

/** A component of non-scene nodes linking this many scenes or more becomes a hub ("연결점"). */
export const HUB_MIN_SCENES = 6;

/**
 * Scene connections, with hubs kept as nodes. Nodes outside every scene form components (joined
 * by edges between such nodes). A small component (a choice, a condition) links scenes directly,
 * following edge direction, as before. A component that links HUB_MIN_SCENES scenes or more is a
 * hub: scenes link to it and it links to scenes, instead of every scene linking to every other
 * through it. Nothing is invented: hub edges stand for real dialogue-graph edges.
 */
export function deriveSceneGraph(
  nodes: { id: string; groupId: string | null }[],
  edges: { fromId: string; toId: string }[],
  hubMinScenes = HUB_MIN_SCENES,
): { edges: DerivedSceneEdge[]; hubs: SceneHub[] } {
  const groupOf = new Map(nodes.map((node) => [node.id, node.groupId]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.fromId);
    if (list) list.push(edge.toId);
    else outgoing.set(edge.fromId, [edge.toId]);
  }
  // Components of non-scene nodes (union-find over edges between two such nodes).
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression: point every node on the way straight at the root.
    for (let node = id; node !== root; ) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  for (const node of nodes) if (!node.groupId) parent.set(node.id, node.id);
  for (const edge of edges)
    if (parent.has(edge.fromId) && parent.has(edge.toId)) {
      const [a, b] = [find(edge.fromId), find(edge.toId)];
      if (a !== b) parent.set(a, b);
    }
  const touching = new Map<string, Set<string>>();
  const touch = (root: string, scene: string) => (touching.get(root) ?? touching.set(root, new Set()).get(root)!).add(scene);
  for (const edge of edges) {
    const from = groupOf.get(edge.fromId);
    const to = groupOf.get(edge.toId);
    if (from && parent.has(edge.toId)) touch(find(edge.toId), from);
    if (to && parent.has(edge.fromId)) touch(find(edge.fromId), to);
  }
  const hubOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const id of parent.keys()) (members.get(find(id)) ?? members.set(find(id), []).get(find(id))!).push(id);
  const hubs: SceneHub[] = [];
  for (const [root, scenes] of touching)
    if (scenes.size >= hubMinScenes) {
      const nodeIds = members.get(root)!;
      const hub = { id: `hub:${nodeIds[0]}`, nodeIds, scenes: scenes.size };
      hubs.push(hub);
      hubOf.set(root, hub.id);
    }

  const result = new Map<string, DerivedSceneEdge>();
  const link = (from: string, to: string) => {
    if (from === to) return;
    const key = `${from}\u0000${to}`;
    const existing = result.get(key);
    if (existing) existing.weight++;
    else result.set(key, { from, to, weight: 1 });
  };
  // Where each non-scene node leads, following edges: scenes, or hubs (where the walk stops).
  const reach = new Map<string, Set<string>>();
  const reachFrom = (start: string) => {
    const known = reach.get(start);
    if (known) return known;
    const found = new Set<string>();
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      for (const next of outgoing.get(queue.shift()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const group = groupOf.get(next);
        if (group) found.add(group);
        else if (hubOf.has(find(next))) found.add(hubOf.get(find(next))!);
        else queue.push(next);
      }
    }
    reach.set(start, found);
    return found;
  };
  for (const edge of edges) {
    const from = groupOf.get(edge.fromId);
    const to = groupOf.get(edge.toId);
    const fromHub = parent.has(edge.fromId) ? hubOf.get(find(edge.fromId)) : undefined;
    if (from && to) link(from, to);
    else if (from && parent.has(edge.toId)) {
      const hub = hubOf.get(find(edge.toId));
      if (hub) link(from, hub);
      else for (const target of reachFrom(edge.toId)) link(from, target);
    } else if (fromHub && to) link(fromHub, to);
  }
  return { edges: [...result.values()], hubs };
}

/** Scene-to-scene connections only (hub-mediated ones left out), e.g. for "previous scene" context. */
export function deriveSceneEdges(nodes: { id: string; groupId: string | null }[], edges: { fromId: string; toId: string }[]): DerivedSceneEdge[] {
  return deriveSceneGraph(nodes, edges).edges.filter((edge) => !edge.from.startsWith('hub:') && !edge.to.startsWith('hub:'));
}

/**
 * Display simplification for dense scene graphs: drop a link A → C when C is still reachable
 * from A through other kept links (A → B → C). Reachability between scenes is unchanged; the
 * dropped links are returned so the page can show them on request and say how many are hidden.
 */
export function reduceSceneEdges<T extends { from: string; to: string }>(edges: T[]): { kept: T[]; hidden: T[] } {
  const ordered = [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const next = new Map<string, Set<string>>();
  for (const edge of ordered) {
    const set = next.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    next.set(edge.from, set);
  }
  const reachableWithout = (from: string, to: string) => {
    const seen = new Set<string>([from]);
    const stack = [...(next.get(from) ?? [])].filter((node) => node !== to);
    while (stack.length) {
      const node = stack.pop()!;
      if (node === to) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...(next.get(node) ?? []));
    }
    return false;
  };
  const kept: T[] = [];
  const hidden: T[] = [];
  for (const edge of ordered) {
    if (reachableWithout(edge.from, edge.to)) {
      next.get(edge.from)!.delete(edge.to);
      hidden.push(edge);
    } else kept.push(edge);
  }
  return { kept, hidden };
}
