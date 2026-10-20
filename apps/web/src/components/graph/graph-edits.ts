import { useRef } from 'react';
import { toast } from 'sonner';
import { client, unwrap } from '@/lib/api';

interface Step {
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}
/** The layout's ids for what is drawn: a folded run is "chain:<first node>" with its nodes in order. */
export interface DrawnGraph {
  chains?: { id: string; nodeIds: string[] }[];
}

/**
 * Editing the dialogue graph from the page (services/graph-edit.ts on the server): draw and delete
 * lines, add a line after a node, delete nodes (keeping the way through them), copy nodes. Each
 * edit is a step ⌘/Ctrl+Z undoes with the server's token and ⌘/Ctrl+Shift+Z does again. Ids are
 * the drawn ones: a folded run stands for its nodes (lines go from its last node, into its first).
 */
export function useDialogueGraphEdits(projectId: string, drawn: { current: DrawnGraph | null | undefined }) {
  const graph = client.projects[':projectId'].graph;
  const param = { projectId };
  const history = useRef<{ past: Step[]; future: Step[] }>({ past: [], future: [] });
  const chain = (id: string) => drawn.current?.chains?.find((item) => item.id === id)?.nodeIds;
  const nodesOf = (id: string) => (id.startsWith('chain:') ? (chain(id) ?? []) : [id]);
  const lastOf = (id: string) => nodesOf(id).at(-1);
  const firstOf = (id: string) => nodesOf(id)[0];
  /** A drawn line's stored id (a section's split edge is "<id>:out" / "<id>:in"); a choice folded into a line is its node. */
  const edgeOf = (id: string) => (id.startsWith('via:') ? { choice: id.slice('via:'.length) } : id.startsWith('bypass:') || id.startsWith('portal:') ? null : { edge: id.replace(/:(out|in)$/, '') });
  const undoToken = (token: string) => unwrap(graph.undo.$post({ param, json: { token } }));
  const run = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  };
  /** Does an edit and records it: undo with its token, redo by doing it again (a new token). */
  const step = async <T extends { token: string }>(call: () => Promise<T>) => {
    const first = await call();
    let token = first.token;
    history.current.past.push({ undo: () => undoToken(token), redo: async () => (token = (await call()).token) });
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
    return first;
  };

  return {
    /** Whether a drawn line can be deleted (lines a view derives are not stored). */
    canDeleteEdge: (id: string) => edgeOf(id) !== null,
    connect: (fromId: string, toId: string) =>
      run(async () => {
        const from = lastOf(fromId), to = firstOf(toId);
        if (!from || !to || from === to) return;
        await step(() => unwrap(graph.edges.$post({ param, json: { fromId: from, toId: to } })));
      }),
    /** Deletes nodes (drawn ids) and a line at once: a choice's line takes the choice away, nodes keep the way through them. */
    remove: (target: { nodeIds: string[]; edgeId?: string }) =>
      run(async () => {
        const line = target.edgeId ? edgeOf(target.edgeId) : null;
        const nodeIds = target.nodeIds.flatMap(nodesOf);
        if (line?.edge) await step(() => unwrap(graph.edges.delete.$post({ param, json: { ids: [line.edge] } })));
        if (line?.choice) await step(() => unwrap(graph.nodes.delete.$post({ param, json: { ids: [line.choice], bridge: false } })));
        if (nodeIds.length) await step(() => unwrap(graph.nodes.delete.$post({ param, json: { ids: nodeIds, bridge: true } })));
      }),
    /** A new line after a node (drawn id); returns the new node's id. */
    insertAfter: (nodeId: string, line: { source: string; speaker?: string | null; listener?: string | null }) =>
      run(async () => {
        const after = lastOf(nodeId);
        if (!after) return undefined;
        return (await step(() => unwrap(graph.nodes[':nodeId'].after.$post({ param: { projectId, nodeId: after }, json: line })))).nodeId;
      }),
    /** Copies of nodes (drawn ids) with the lines between them; returns old node id → new. */
    duplicate: (ids: string[]) =>
      run(async () => (await step(() => unwrap(graph.nodes.duplicate.$post({ param, json: { ids: ids.flatMap(nodesOf) } })))).made),
    undo: () =>
      run(async () => {
        const last = history.current.past.pop();
        if (!last) return;
        await last.undo();
        history.current.future.push(last);
      }),
    redo: () =>
      run(async () => {
        const next = history.current.future.pop();
        if (!next) return;
        await next.redo();
        history.current.past.push(next);
      }),
  };
}

export type DialogueGraphEdits = ReturnType<typeof useDialogueGraphEdits>;
