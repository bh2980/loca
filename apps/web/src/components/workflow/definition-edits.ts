/**
 * The edits the workflow editor makes to a definition, each a function from the definition as it is to the one
 * after: deleting nodes, lines and frames, drawing a line, moving nodes, copying and pasting. The editor applies them
 * to its unsaved draft (use-workflow-draft); nothing here knows about React or the canvas. The hidden entry node is
 * never deleted or copied, and its lines to the starting nodes are kept in step after every edit (syncEntryEdges).
 */
import { addEdge } from '@xyflow/react';
import { syncEntryEdges, workflowNodeSchema, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import { pruneGroups } from './frames';
import { shiftRoute } from './route-shift';

type Point = { x: number; y: number };
type Delta = { dx: number; dy: number };
const STILL: Delta = { dx: 0, dy: 0 };

/** The nodes of `ids` that can be deleted or copied: not the entry. */
export const editableIds = (definition: WorkflowDefinition, ids: Iterable<string>): Set<string> => {
  const entry = new Set(definition.nodes.filter((node) => node.type === 'entry').map((node) => node.id));
  return new Set([...ids].filter((id) => !entry.has(id)));
};

/** Without these nodes, their lines, and their places in frames (the frames stay). */
export function withoutNodes(definition: WorkflowDefinition, ids: Iterable<string>): WorkflowDefinition {
  const doomed = editableIds(definition, ids);
  if (!doomed.size) return definition;
  const nodes = definition.nodes.filter((node) => !doomed.has(node.id));
  return syncEntryEdges({ ...definition, nodes, edges: definition.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)), groups: pruneGroups(definition.groups, nodes) });
}

/** Without a frame and the nodes in it (and their lines), as Figma deletes a section with its contents. */
export function withoutFrame(definition: WorkflowDefinition, groupId: string): { definition: WorkflowDefinition; removed: Set<string> } {
  const group = definition.groups?.find((item) => item.id === groupId);
  if (!group) return { definition, removed: new Set() };
  const removed = editableIds(definition, group.nodeIds);
  return {
    removed,
    definition: syncEntryEdges({
      ...definition,
      nodes: definition.nodes.filter((node) => !removed.has(node.id)),
      edges: definition.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
      groups: (definition.groups ?? []).filter((item) => item.id !== groupId).map((item) => ({ ...item, nodeIds: item.nodeIds.filter((id) => !removed.has(id)) })),
    }),
  };
}

export function withoutEdges(definition: WorkflowDefinition, ids: Iterable<string>): WorkflowDefinition {
  const gone = new Set(ids);
  return syncEntryEdges({ ...definition, edges: definition.edges.filter((edge) => !gone.has(edge.id)) });
}

/**
 * With a line drawn from an exit to a node. An exit may have several lines (every line goes down all of them); only
 * an exact duplicate is refused (the definition comes back as it was).
 */
export function withConnection(definition: WorkflowDefinition, connection: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }, id: string): WorkflowDefinition {
  if (!connection.sourceHandle) return definition;
  if (definition.edges.some((edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle && edge.target === connection.target)) return definition;
  const added = addEdge({ ...connection, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle ?? null, id }, definition.edges.map((edge) => ({ ...edge }))) as WorkflowDefinition['edges'];
  return syncEntryEdges({ ...definition, edges: added.map(({ id: edgeId, source, sourceHandle, target }) => ({ id: edgeId, source, sourceHandle: sourceHandle!, target })) });
}

/**
 * With nodes where they were dragged to (`positions`) and without the ones removed. A moved node's lines keep their
 * shape: their end at it follows it by `deltas` (shiftRoute); every other line stays as it was.
 */
export function withNodesMoved(definition: WorkflowDefinition, positions: ReadonlyMap<string, Point>, deltas: ReadonlyMap<string, Delta>, removed: readonly string[] = []): WorkflowDefinition {
  const kept = definition.nodes.filter((node) => !removed.includes(node.id));
  return syncEntryEdges({
    ...definition,
    nodes: kept.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    groups: pruneGroups(definition.groups, kept),
    edges: definition.edges
      .filter((edge) => !removed.includes(edge.source) && !removed.includes(edge.target))
      .map((edge) => (deltas.has(edge.source) || deltas.has(edge.target) ? { ...edge, layout: shiftRoute(edge.layout, deltas.get(edge.source) ?? STILL, deltas.get(edge.target) ?? STILL) } : edge)),
  });
}

/** An id nothing in the definition has: `prefix`, then `prefix2`, `prefix3`… */
export function freeNodeId(taken: ReadonlySet<string>, prefix: string): string {
  let id = prefix;
  for (let n = 2; taken.has(id); n++) id = `${prefix}${n}`;
  return id;
}

/** Nodes copied (⌘/Ctrl+C or X) with the lines among them: pasted into this or another workflow. */
export interface CopiedNodes {
  nodes: WorkflowNode[];
  edges: WorkflowDefinition['edges'];
}

/** What copying `ids` holds: the nodes themselves (not the entry) and the lines that run between them. */
export function copyNodes(definition: WorkflowDefinition, ids: Iterable<string>): CopiedNodes {
  const wanted = editableIds(definition, ids);
  const nodes = definition.nodes.filter((node) => wanted.has(node.id));
  const held = new Set(nodes.map((node) => node.id));
  return { nodes: structuredClone(nodes), edges: definition.edges.filter((edge) => held.has(edge.source) && held.has(edge.target)) };
}

/** How far to the side of its original a copy is put. */
export const COPY_OFFSET = 240;

/**
 * With copies of the copied nodes beside their originals (new ids: "<id>-copy", "<id>-copy2"…) and the lines among
 * them; `copies` are the new nodes' ids, in order.
 */
export function withCopies(definition: WorkflowDefinition, copied: CopiedNodes, newEdgeId: () => string): { definition: WorkflowDefinition; copies: string[] } {
  if (!copied.nodes.length) return { definition, copies: [] };
  const taken = new Set(definition.nodes.map((node) => node.id));
  const renamed = new Map<string, string>();
  for (const node of copied.nodes) {
    const id = freeNodeId(taken, `${node.id}-copy`);
    taken.add(id);
    renamed.set(node.id, id);
  }
  const copies = copied.nodes.map((node) => workflowNodeSchema.parse({ ...structuredClone(node), id: renamed.get(node.id), position: { x: node.position.x + COPY_OFFSET, y: node.position.y } }));
  const lines = copied.edges
    .filter((edge) => renamed.has(edge.source) && renamed.has(edge.target))
    .map((edge) => ({ id: newEdgeId(), source: renamed.get(edge.source)!, sourceHandle: edge.sourceHandle, target: renamed.get(edge.target)! }));
  return { definition: syncEntryEdges({ ...definition, nodes: [...definition.nodes, ...copies], edges: [...definition.edges, ...lines] }), copies: copies.map((node) => node.id) };
}
