import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/**
 * Where a point X stands relative to a line L in the dialogue graph (DESIGN 3.2):
 * - "definite": every path from a start to L passes X (X's node dominates L's, or X is earlier in L's node)
 * - "maybe": X can lead to L but some paths skip it (it depends on the route, or L can loop back)
 * - "none": X never comes before L (it is after L, or on a branch that never leads to L)
 * - "unknown": X or L is not in the graph, or they are in parts of the graph no edge joins (games
 *   often ship one graph per chapter); callers fall back to script order
 * Branch conditions are ignored: they only remove paths, so "definite" stays true.
 */
export type Passage = 'definite' | 'maybe' | 'none' | 'unknown';

/**
 * Dominator tree of the dialogue graph (Cooper–Harvey–Kennedy, "A Simple, Fast Dominance
 * Algorithm"), rooted at a virtual start joined to every node nothing leads to (and to one node of
 * any cycle nothing leads into). Built once per project; the source graph never changes after import.
 *
 * No dominator library is used: the one npm package ("dominators", last released 2022) is
 * unmaintained, and the algorithm is these few loops.
 */
export class GraphOrder {
  private nodeOf = new Map<string, { node: number; position: number }>();
  private next: number[][] = [];
  /** Dominator-tree preorder interval per node: a dominates b iff in[a] <= in[b] && out[b] <= out[a]. */
  private enter: Int32Array;
  private leave: Int32Array;
  private depth: Int32Array;
  private reach = new Map<number, Uint8Array>();
  /** Weakly connected part of the graph per node. */
  private part: Int32Array;

  constructor(nodes: { unitKeys: string[] }[], edges: [number, number][]) {
    const n = nodes.length;
    nodes.forEach((node, index) => node.unitKeys.forEach((key, position) => this.nodeOf.has(key) || this.nodeOf.set(key, { node: index, position })));
    this.next = Array.from({ length: n + 1 }, () => []);
    const prev: number[][] = Array.from({ length: n + 1 }, () => []);
    for (const [from, to] of edges) {
      this.next[from].push(to);
      prev[to].push(from);
    }
    // Parts no edge joins, ignoring direction (union–find).
    const parent = Int32Array.from({ length: n }, (_, index) => index);
    const find = (node: number): number => {
      while (parent[node] !== node) node = parent[node] = parent[parent[node]];
      return node;
    };
    for (const [from, to] of edges) parent[find(from)] = find(to);
    this.part = Int32Array.from({ length: n }, (_, index) => find(index));
    // Node n is the virtual start.
    const root = n;
    const order: number[] = [];
    const rpo = new Int32Array(n + 1).fill(-1);
    const seen = new Uint8Array(n + 1);
    const visit = (start: number) => {
      // Iterative DFS postorder (a script can be a chain of tens of thousands of nodes).
      const stack: [number, number][] = [[start, 0]];
      seen[start] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const children = this.next[top[0]];
        if (top[1] < children.length) {
          const child = children[top[1]++];
          if (!seen[child]) {
            seen[child] = 1;
            stack.push([child, 0]);
          }
        } else {
          order.push(top[0]);
          stack.pop();
        }
      }
    };
    const attach = (node: number) => {
      this.next[root].push(node);
      prev[node].push(root);
    };
    for (let node = 0; node < n; node++) if (!prev[node].length) attach(node);
    seen[root] = 1;
    for (const node of this.next[root]) if (!seen[node]) visit(node);
    // Cycles nothing leads into: start them at their first node.
    for (let node = 0; node < n; node++) {
      if (seen[node]) continue;
      attach(node);
      visit(node);
    }
    order.push(root);
    order.reverse();
    order.forEach((node, index) => (rpo[node] = index));

    const idom = new Int32Array(n + 1).fill(-1);
    idom[root] = root;
    const intersect = (a: number, b: number) => {
      while (a !== b) {
        while (rpo[a] > rpo[b]) a = idom[a];
        while (rpo[b] > rpo[a]) b = idom[b];
      }
      return a;
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const node of order) {
        if (node === root) continue;
        let dom = -1;
        for (const p of prev[node]) if (idom[p] !== -1) dom = dom === -1 ? p : intersect(p, dom);
        if (dom !== -1 && idom[node] !== dom) {
          idom[node] = dom;
          changed = true;
        }
      }
    }

    // Preorder numbering of the dominator tree for O(1) dominance checks.
    const children: number[][] = Array.from({ length: n + 1 }, () => []);
    for (let node = 0; node < n; node++) if (idom[node] !== -1) children[idom[node]].push(node);
    this.enter = new Int32Array(n + 1);
    this.leave = new Int32Array(n + 1);
    this.depth = new Int32Array(n + 1);
    let clock = 0;
    const stack: [number, number][] = [[root, 0]];
    this.enter[root] = clock++;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[1] < children[top[0]].length) {
        const child = children[top[0]][top[1]++];
        this.depth[child] = this.depth[top[0]] + 1;
        this.enter[child] = clock++;
        stack.push([child, 0]);
      } else {
        this.leave[top[0]] = clock++;
        stack.pop();
      }
    }
  }

  private dominates(a: number, b: number) {
    return this.enter[a] <= this.enter[b] && this.leave[b] <= this.leave[a];
  }

  /** Nodes reachable from `from` by at least one edge (cached: asked once per rule start). */
  private reachable(from: number) {
    let set = this.reach.get(from);
    if (set) return set;
    set = new Uint8Array(this.next.length);
    const stack = [...this.next[from]];
    while (stack.length) {
      const node = stack.pop()!;
      if (set[node]) continue;
      set[node] = 1;
      stack.push(...this.next[node]);
    }
    this.reach.set(from, set);
    return set;
  }

  has(key: string) {
    return this.nodeOf.has(key);
  }

  /** Has the player certainly passed line `point` when they reach line `line`? */
  passage(point: string, line: string): Passage {
    const x = this.nodeOf.get(point);
    const l = this.nodeOf.get(line);
    if (!x || !l || this.part[x.node] !== this.part[l.node]) return 'unknown';
    if (x.node === l.node) {
      if (x.position <= l.position) return 'definite';
      // Later in the same node: passed before only if the node can come round again (rare; cached per node).
      return this.reachable(l.node)[l.node] ? 'maybe' : 'none';
    }
    if (!this.reachable(x.node)[l.node]) return 'none';
    return this.dominates(x.node, l.node) ? 'definite' : 'maybe';
  }

  /** Of two points both certainly passed before a line, is `a` passed after `b`? (deeper in the dominator tree, or later in one node) */
  later(a: string, b: string) {
    const x = this.nodeOf.get(a)!;
    const y = this.nodeOf.get(b)!;
    return x.node === y.node ? x.position > y.position : this.depth[x.node] > this.depth[y.node];
  }

  /** Can the player go from `a` to `b` (one way at least)? */
  leadsTo(a: string, b: string) {
    const x = this.nodeOf.get(a);
    const y = this.nodeOf.get(b);
    if (!x || !y) return false;
    return (x.node === y.node && x.position < y.position) || this.reachable(x.node)[y.node] === 1;
  }
}

/** The project's graph order, from its graph nodes and edges keyed by unit key. */
export function buildGraphOrder(db: Db, projectId: string) {
  const keyOf = new Map(db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit.key]));
  const rows = db.select({ id: s.graphNodes.id, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const indexOf = new Map(rows.map((row, index) => [row.id, index]));
  const edges = db
    .select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId })
    .from(s.graphEdges)
    .where(eq(s.graphEdges.projectId, projectId))
    .all()
    .flatMap((edge): [number, number][] => (indexOf.has(edge.fromId) && indexOf.has(edge.toId) ? [[indexOf.get(edge.fromId)!, indexOf.get(edge.toId)!]] : []));
  return new GraphOrder(
    rows.map((row) => ({ unitKeys: row.unitIds.flatMap((id) => (keyOf.has(id) ? [keyOf.get(id)!] : [])) })),
    edges,
  );
}
