/**
 * 접기: a display-only way to keep workflow graphs short. Nodes that only hang off another node are
 * drawn as one small dashed chip instead (the stored definition and the runner never change).
 *
 *  - A dead-end side branch (a 재요청 and its failure marker) folds into a chip on its owner's exit.
 *  - A 태그 붙이기 that only passes lines on folds into a chip on the line it sits on.
 *
 * Everything here is pure: `computeFolds` finds the folds, `foldText` words the chip, `foldedDefinition`
 * draws the definition with the closed folds left out, and the `FoldState` helpers keep which folds are
 * open (the editor and the run graph keep that in sessionStorage, per workflow / run).
 */
import { retryLiveText } from '../../lib/retry-info';
import { ITEM_ERROR_KINDS, TAG_ACTIONS, nodeName, retryScaleText, retryWaitText, nodePorts, tagLinesParams, type RetryConfig, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@tw/shared';

/** A branch of more nodes than this is not a side detail any more. */
export const MAX_FOLDED_NODES = 4;

export interface Fold {
  /** Stable across edits: `owner:port` for a branch, `pass:node` for a pass-through tag node. */
  id: string;
  kind: 'branch' | 'edge';
  /** branch: the node whose exit the chip sits on. edge: the node the line leaves. */
  owner: string;
  /** branch: the owner's exit. edge: the exit of the node the line leaves. */
  port: string;
  /** The folded nodes in reading order (an edge fold's first is the tag node). May include the hidden 끝 node. */
  nodeIds: string[];
  /** edge: where the line goes on to once the tag node is folded away. */
  target?: string;
  /** edge: the line into the tag node; the drawn line keeps its id. */
  edgeId?: string;
}

const isMark = (node: WorkflowNode) => node.type === 'entry' || node.type === 'end';

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
    const shown = order.filter((id) => byId.get(id)?.type !== 'end').length;
    return shown >= 1 && shown <= MAX_FOLDED_NODES ? order : undefined;
  };

  // Rule 1. The first exit is the node's main way on (완료, 통과, 다음, 참, 다시 보냄): a tail of the workflow is not a side detail.
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
  const insideBranch = (id: string) => branches.some((fold) => fold.nodeIds.includes(id));

  // Rule 2. Only 태그 붙이기 / 떼기 pass through: one line in, one 완료 line out, 오류 unconnected or a branch of its own.
  const passes = new Map<string, { into: WorkflowEdge; onward: WorkflowEdge }>();
  for (const node of definition.nodes) {
    if (node.type !== 'function' || node.config.fn !== 'tagLines' || insideBranch(node.id)) continue;
    const into = inTo(node.id);
    const outs = outOf(node.id).filter((edge) => edge.sourceHandle === 'out');
    const errors = outOf(node.id).filter((edge) => edge.sourceHandle === 'error');
    if (into.length !== 1 || outs.length !== 1 || outs.length + errors.length !== outOf(node.id).length) continue;
    if (errors.length && !branches.some((fold) => fold.owner === node.id && fold.port === 'error')) continue;
    passes.set(node.id, { into: into[0]!, onward: outs[0]! });
  }
  const edges: Fold[] = [];
  for (const [id, { into, onward }] of passes) {
    const source = byId.get(into.source);
    const target = byId.get(onward.target);
    // The line must be drawn between two shown nodes, and a neighbouring pass-through would hide one end.
    if (!source || !target || isMark(source) || isMark(target) || source.id === id || target.id === id) continue;
    if (passes.has(source.id) || passes.has(target.id) || insideBranch(source.id) || insideBranch(target.id)) continue;
    const errorBranch = branches.find((fold) => fold.owner === id && fold.port === 'error');
    edges.push({ id: `pass:${id}`, kind: 'edge', owner: source.id, port: into.sourceHandle, nodeIds: [id, ...(errorBranch?.nodeIds ?? [])], target: target.id, edgeId: into.id });
    if (errorBranch) branches = branches.filter((fold) => fold !== errorBranch);
  }
  return [...branches, ...edges];
}

export interface FoldNames {
  /** Status id → name, for a status-change node folded into a chip. */
  status?: ReadonlyMap<string, string>;
}

/** A node as a chip names it: a status change by its status, the hidden end as 끝, else its name. */
function brief(node: WorkflowNode, names: FoldNames): string {
  if (node.type === 'end') return '끝';
  if (node.type === 'function' && node.config.fn === 'setStatus') {
    const statusId = (node.config.params as { statusId?: string }).statusId;
    return (statusId && names.status?.get(statusId)) || nodeName(node);
  }
  return nodeName(node);
}

/** At most this many error kinds are named in a 재요청 chip; the rest are counted ("외 3"). */
const CHIP_KINDS = 2;

/**
 * What a 재요청 node does, in the chip's few words: "출력 잘림·시간 초과 시 절반으로 2번",
 * "사용량 한도·연결 끊김 시 60초 뒤 그대로 3번", "사용량 한도 시 gpt-5로 3번" (the kinds come first, since a chain has several nodes).
 */
export function retryChipText(config: RetryConfig) {
  const kinds = config.kinds.map((kind) => ITEM_ERROR_KINDS[kind]);
  const named = kinds.length ? `${kinds.slice(0, CHIP_KINDS).join('·')}${kinds.length > CHIP_KINDS ? ` 외 ${kinds.length - CHIP_KINDS}` : ''}` : '고른 오류 없음';
  const size = config.scale >= 1 ? (config.model?.model ? '' : '그대로') : `${retryScaleText(config.scale)}${config.scale === 0.5 ? '으로' : '로'}`.replace('%으로', '%로');
  return [`${named} 시`, config.wait > 0 ? `${retryWaitText(config.wait)} 뒤` : '', config.model?.model ? `${config.model.model}로` : '', size, `${config.maxTimes}번`].filter(Boolean).join(' ');
}

/** "태그 붙이기 · 검수 지적", "태그 떼기 · 고른 태그 7개": what a tag node does, in the chip's few words. */
export function tagChipText(node: WorkflowNode): string {
  if (node.type !== 'function' || node.config.fn !== 'tagLines') return nodeName(node);
  const tags = tagLinesParams.parse(node.config.params);
  const picked = tags.tagIds.length ? [`고른 태그 ${tags.tagIds.length}개`] : [];
  const from = tags.map.tag && (tags.map.tag === 'categories' ? '검수 지적' : tags.map.tag === 'kind' ? '검사 종류' : `결과의 ${tags.map.tag}`);
  return [`태그 ${TAG_ACTIONS[tags.action]}`, ...picked, from].filter(Boolean).join(' · ');
}

/** The chip's text: 재요청 first ("출력 잘림 시 절반으로 2번 → 사용량 한도 시 60초 뒤 그대로 3번 → 검토 필요"), a lone tag node by what it does, else the names joined. */
export function foldText(definition: WorkflowDefinition, fold: Fold, names: FoldNames = {}): string {
  const nodes = fold.nodeIds.flatMap((id) => definition.nodes.find((node) => node.id === id) ?? []);
  const first = nodes[0];
  if (!first) return '';
  // A chain of 재요청 nodes reads one after the other, then whatever they end in ("… 2번 → … 3번 → 검토 필요").
  if (first.type === 'retry') return nodes.map((node) => (node.type === 'retry' ? retryChipText(node.config) : brief(node, names))).join(' → ');
  if (fold.kind === 'edge' || (nodes.length === 1 && first.type === 'function' && first.config.fn === 'tagLines')) return tagChipText(first);
  return nodes.map((node) => brief(node, names)).join(' → ');
}

export const foldContaining = (folds: readonly Fold[], nodeId: string) => folds.find((fold) => fold.nodeIds.includes(nodeId));

/**
 * The definition as drawn: the nodes of closed folds are left out together with the lines on them, and a
 * closed edge fold leaves one line (it keeps the id of the line into the tag node) from its source to its target.
 */
export function foldedDefinition(definition: WorkflowDefinition, folds: readonly Fold[], open: ReadonlySet<string>): { definition: WorkflowDefinition; closed: Fold[]; hidden: Set<string> } {
  const closed = folds.filter((fold) => !open.has(fold.id));
  const hidden = new Set(closed.flatMap((fold) => fold.nodeIds));
  if (!hidden.size) return { definition, closed, hidden };
  const merged = closed.filter((fold) => fold.kind === 'edge').flatMap((fold) => {
    const edge = definition.edges.find((item) => item.id === fold.edgeId);
    return edge && fold.target ? [{ ...edge, target: fold.target, layout: undefined }] : [];
  });
  const kept = definition.edges.filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target));
  return { definition: { ...definition, nodes: definition.nodes.filter((node) => !hidden.has(node.id)), edges: [...kept, ...merged] }, closed, hidden };
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

/** Open folds by id. View state: kept in sessionStorage per workflow (or run), never in the URL or the definition. */
export interface FoldState {
  open: string[];
}
export const NO_OPEN_FOLDS: FoldState = { open: [] };

export const isFoldOpen = (state: FoldState, id: string) => state.open.includes(id);
export const toggleFold = (state: FoldState, id: string): FoldState => ({ open: isFoldOpen(state, id) ? state.open.filter((open) => open !== id) : [...state.open, id] });
/** Opens every fold, or closes them all. */
export const setAllFolds = (folds: readonly Fold[], open: boolean): FoldState => ({ open: open ? folds.map((fold) => fold.id) : [] });
export const allFoldsOpen = (folds: readonly Fold[], state: FoldState) => folds.length > 0 && folds.every((fold) => isFoldOpen(state, fold.id));
/** Opens the fold a node is folded in (selecting a folded node by URL, search or an issue shows it); the same state when it needs nothing. */
export function openFoldContaining(state: FoldState, folds: readonly Fold[], nodeId: string | undefined): FoldState {
  const fold = nodeId ? foldContaining(folds, nodeId) : undefined;
  return fold && !isFoldOpen(state, fold.id) ? { open: [...state.open, fold.id] } : state;
}

export function readFoldState(key: string): FoldState {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return value && Array.isArray(value.open) ? { open: value.open.filter((id: unknown): id is string => typeof id === 'string') } : NO_OPEN_FOLDS;
  } catch {
    return NO_OPEN_FOLDS;
  }
}
export function writeFoldState(key: string, state: FoldState) {
  try {
    if (state.open.length) sessionStorage.setItem(key, JSON.stringify(state));
    else sessionStorage.removeItem(key);
  } catch {
    // Folds that are not remembered just start closed again.
  }
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
  const openFolds = folds.filter((fold) => open.has(fold.id));
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
