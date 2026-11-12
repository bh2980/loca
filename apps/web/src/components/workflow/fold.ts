/**
 * 접기: a display-only way to keep workflow graphs short. Nodes that only hang off another node are
 * drawn as one small dashed chip instead (the stored definition and the runner never change).
 *
 *  - A dead-end side branch folds into a chip on its owner's exit.
 *  - A dead end several exits lead to folds into a chip on each of them: one fold, opened and closed together.
 *
 * Tags and statuses are not nodes but exit actions, drawn on the lines by exit-marks.ts.
 *
 * Everything here is pure: `computeFolds` finds the folds, `foldText` words the chip, `foldedDefinition`
 * draws the definition with the closed folds left out, and the `FoldState` helpers keep which folds are
 * open (the editor and the run graph keep that for the tab, per workflow / run).
 */
import { retryLiveText } from '../../lib/retry-info';
import { nodeName, nodePorts, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@tw/shared';

/** A branch of more nodes than this is not a side detail any more. */
export const MAX_FOLDED_NODES = 4;

export interface Fold {
  /** Stable across edits: `owner:port` for a branch, `end:node` for a shared dead end (one entry per exit, all with this id). */
  id: string;
  kind: 'branch';
  /** The node whose exit the chip sits on. */
  owner: string;
  /** The owner's exit. */
  port: string;
  /** The folded nodes in reading order. */
  nodeIds: string[];
}

const isMark = (node: WorkflowNode) => node.type === 'entry';

export function computeFolds(definition: WorkflowDefinition): Fold[] {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const edge of definition.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }
  const outOf = (id: string) => outgoing.get(id) ?? [];
  const inTo = (id: string) => incoming.get(id) ?? [];

  /** The nodes that only exist for `owner`'s exit `portId`, in reading order, or undefined when that exit is not a dead-end side branch. */
  const deadEnd = (ownerId: string, portId: string): string[] | undefined => {
    const first = outOf(ownerId).filter((edge) => edge.sourceHandle === portId).map((edge) => edge.target);
    if (!first.length) return undefined;
    // Everything reachable from the exit without passing the owner again ...
    const set = new Set<string>();
    const stack = [...first];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === ownerId || set.has(id) || byId.get(id)?.type === 'entry') continue;
      set.add(id);
      for (const edge of outOf(id)) stack.push(edge.target);
    }
    // ... minus what is also reached from elsewhere or leads elsewhere; losing one node can disqualify its neighbours.
    const fromHere = (edge: WorkflowEdge) => edge.source === ownerId && edge.sourceHandle === portId;
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of [...set]) {
        const reachedElsewhere = inTo(id).some((edge) => !fromHere(edge) && !set.has(edge.source));
        const leadsElsewhere = outOf(id).some((edge) => edge.target !== ownerId && !set.has(edge.target));
        if (reachedElsewhere || leadsElsewhere) {
          set.delete(id);
          changed = true;
        }
      }
    }
    // The exit's own targets must all stay: part of it joining the rest of the graph means it is not a side branch.
    if (!first.every((id) => set.has(id))) return undefined;
    const order: string[] = [];
    const queue = [...first];
    while (queue.length) {
      const id = queue.shift()!;
      if (!set.has(id) || order.includes(id)) continue;
      order.push(id);
      for (const edge of outOf(id)) queue.push(edge.target);
    }
    return order.length >= 1 && order.length <= MAX_FOLDED_NODES ? order : undefined;
  };

  // Rule 1. The first exit is the node's main way on (완료, 통과, 다음, 참): a tail of the workflow is not a side detail.
  let branches: Fold[] = [];
  for (const owner of definition.nodes) {
    if (isMark(owner)) continue;
    nodePorts(owner).forEach((port, index) => {
      const nodeIds = index > 0 ? deadEnd(owner.id, port.id) : undefined;
      if (nodeIds) branches.push({ id: `${owner.id}:${port.id}`, kind: 'branch', owner: owner.id, port: port.id, nodeIds });
    });
  }
  // A branch inside another branch stays folded in it.
  branches = branches.filter((fold) => !branches.some((other) => other !== fold && other.nodeIds.includes(fold.owner)));
  // Rule 3. A node that leads nowhere and that several side exits lead to: a chip on each of them.
  for (const node of definition.nodes) {
    if (isMark(node) || branches.some((fold) => fold.nodeIds.includes(node.id))) continue;
    const into = inTo(node.id);
    if (into.length < 2 || outOf(node.id).length) continue;
    const sideExit = (edge: WorkflowEdge) => {
      const source = byId.get(edge.source);
      return Boolean(source && !isMark(source) && nodePorts(source).findIndex((port) => port.id === edge.sourceHandle) > 0 && !branches.some((fold) => fold.nodeIds.includes(source.id)));
    };
    if (!into.every(sideExit)) continue;
    for (const edge of into) branches.push({ id: `end:${node.id}`, kind: 'branch', owner: edge.source, port: edge.sourceHandle, nodeIds: [node.id] });
  }
  return branches;
}

/** The chip's text: the folded nodes' names joined ("AI 수정 → 후보 저장"). */
export function foldText(definition: WorkflowDefinition, fold: Fold): string {
  return fold.nodeIds.flatMap((id) => definition.nodes.find((node) => node.id === id) ?? []).map(nodeName).join(' → ');
}

export const foldContaining = (folds: readonly Fold[], nodeId: string) => folds.find((fold) => fold.nodeIds.includes(nodeId));

/** The definition as drawn: the nodes of closed folds are left out together with the lines on them. */
export function foldedDefinition(definition: WorkflowDefinition, folds: readonly Fold[], open: ReadonlySet<string>): { definition: WorkflowDefinition; closed: Fold[]; hidden: Set<string> } {
  const closed = folds.filter((fold) => !open.has(fold.id));
  const hidden = new Set(closed.flatMap((fold) => fold.nodeIds));
  if (!hidden.size) return { definition, closed, hidden };
  const kept = definition.edges.filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target));
  return { definition: { ...definition, nodes: definition.nodes.filter((node) => !hidden.has(node.id)), edges: kept }, closed, hidden };
}

/** Errors and warnings (validation issues) on the folded nodes, for the chip's count. */
export function foldIssues(fold: Fold, issues: readonly { level: 'error' | 'warning'; nodeId?: string }[]) {
  const mine = issues.filter((issue) => issue.nodeId && fold.nodeIds.includes(issue.nodeId));
  return { errors: mine.filter((issue) => issue.level === 'error').length, warnings: mine.filter((issue) => issue.level === 'warning').length };
}

/** A run's live counts on the folded nodes, as a chip adds them: "처리 1 · 대기 2 · 실패 3" (zeros left out). */
export function foldLiveText(fold: Fold, live: ReadonlyMap<string, { queued: number; running: number; failed: number; retrying?: { count: number; kinds: Record<string, number> } }>): string {
  const sum = { running: 0, queued: 0, failed: 0 };
  const retrying = { count: 0, kinds: {} as Record<string, number> };
  for (const id of fold.nodeIds) {
    const counts = live.get(id);
    if (!counts) continue;
    sum.running += counts.running;
    sum.queued += counts.queued;
    sum.failed += counts.failed;
    if (counts.retrying) {
      retrying.count += counts.retrying.count;
      for (const [kind, n] of Object.entries(counts.retrying.kinds)) retrying.kinds[kind] = (retrying.kinds[kind] ?? 0) + n;
    }
  }
  return [retryLiveText(retrying), sum.running && `처리 ${sum.running.toLocaleString()}`, sum.queued && `대기 ${sum.queued.toLocaleString()}`, sum.failed && `실패 ${sum.failed.toLocaleString()}`].filter(Boolean).join(' · ');
}

/* ---- which folds are open ---- */

/** Open folds by id. View state: kept for the tab per workflow (or run) (use-fold-state.ts), never in the URL or the definition. */
export interface FoldState {
  open: string[];
}
export const NO_OPEN_FOLDS: FoldState = { open: [] };

export const isFoldOpen = (state: FoldState, id: string) => state.open.includes(id);
export const toggleFold = (state: FoldState, id: string): FoldState => ({ open: isFoldOpen(state, id) ? state.open.filter((open) => open !== id) : [...state.open, id] });
/** Opens every fold, or closes them all. */
export const setAllFolds = (folds: readonly Fold[], open: boolean): FoldState => ({ open: open ? [...new Set(folds.map((fold) => fold.id))] : [] });
export const allFoldsOpen = (folds: readonly Fold[], state: FoldState) => folds.length > 0 && folds.every((fold) => isFoldOpen(state, fold.id));
/** Opens the fold a node is folded in (selecting a folded node by URL, search or an issue shows it); the same state when it needs nothing. */
export function openFoldContaining(state: FoldState, folds: readonly Fold[], nodeId: string | undefined): FoldState {
  const fold = nodeId ? foldContaining(folds, nodeId) : undefined;
  return fold && !isFoldOpen(state, fold.id) ? { open: [...state.open, fold.id] } : state;
}

/* ---- where an opened fold's nodes sit ---- */

interface Rect { left: number; top: number; right: number; bottom: number }
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Open folds keep the positions stored for their nodes. Folded nodes are not part of a layout made while
 * folded, so their stored places can fall on other nodes: such a fold is set beside its owner instead
 * (display only: nothing is written until the person moves a node). Deterministic, so toggling never jumps.
 */
export function foldPlacements(
  definition: WorkflowDefinition,
  folds: readonly Fold[],
  open: ReadonlySet<string>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  direction: 'vertical' | 'horizontal',
): Map<string, { x: number; y: number }> {
  const vertical = direction === 'vertical';
  const sizeOf = (id: string) => sizes.get(id) ?? { width: vertical ? 224 : 288, height: 96 };
  const nodeOf = (id: string) => definition.nodes.find((node) => node.id === id);
  const rectAt = (id: string, at: { x: number; y: number }): Rect => ({ left: at.x, top: at.y, right: at.x + sizeOf(id).width, bottom: at.y + sizeOf(id).height });
  // A shared dead end is one fold with an entry per exit: placed once, by its first.
  const openFolds = folds.filter((fold, index) => open.has(fold.id) && folds.findIndex((other) => other.id === fold.id) === index);
  const folded = new Set(openFolds.flatMap((fold) => fold.nodeIds));
  const occupied: Rect[] = definition.nodes.filter((node) => !isMark(node) && !folded.has(node.id)).map((node) => rectAt(node.id, node.position));
  const placed = new Map<string, { x: number; y: number }>();
  for (const fold of openFolds) {
    const members = fold.nodeIds.flatMap((id) => nodeOf(id) ?? []).filter((node) => !isMark(node));
    const stored = members.map((node) => rectAt(node.id, node.position));
    if (!stored.some((rect, index) => occupied.some((other) => overlaps(rect, other)) || stored.some((other, next) => next > index && overlaps(rect, other)))) {
      occupied.push(...stored);
      continue;
    }
    const owner = nodeOf(fold.owner);
    if (!owner) continue;
    const ownerSize = sizeOf(owner.id);
    const gap = 48;
    const at = (shift: number) => {
      let along = 0;
      return members.map((node) => {
        const size = sizeOf(node.id);
        const position = vertical
          ? { x: owner.position.x + ownerSize.width + gap + shift * (size.width + gap), y: owner.position.y + along }
          : { x: owner.position.x + ownerSize.width + gap + along, y: owner.position.y + ownerSize.height + gap + shift * (size.height + gap) };
        along += (vertical ? size.height : size.width) + gap;
        return position;
      });
    };
    let shift = 0;
    while (shift < 30 && at(shift).some((position, index) => occupied.some((other) => overlaps(rectAt(members[index]!.id, position), other)))) shift++;
    const positions = at(shift);
    members.forEach((node, index) => {
      placed.set(node.id, positions[index]!);
      occupied.push(rectAt(node.id, positions[index]!));
    });
  }
  return placed;
}
