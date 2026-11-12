import { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { graphEdits } from '@/lib/graph';
import { serverUndoHistory, undoChange } from '@/lib/undo';
import { tokenStep } from '@/lib/undo-history';

/** The layout's ids for what is drawn: a folded run is "chain:<first node>" with its nodes in order. */
export interface DrawnGraph {
  chains?: { id: string; nodeIds: string[] }[];
}

/**
 * Editing the dialogue graph from the page (services/graph-edit.ts on the server): draw and delete
 * lines, add a line after a node, delete nodes (keeping the way through them), copy nodes. Each
 * edit is a step ⌘/Ctrl+Z undoes with the server's token (the edit's undo record) and ⌘/Ctrl+Shift+Z does again. Ids are
 * the drawn ones: a folded run stands for its nodes (lines go from its last node, into its first).
 */
export function useDialogueGraphEdits(projectId: string, drawn: { current: DrawnGraph | null | undefined }) {
  const edits = useMemo(() => graphEdits(projectId), [projectId]);
  const history = useRef(serverUndoHistory()).current;
  const chain = (id: string) => drawn.current?.chains?.find((item) => item.id === id)?.nodeIds;
  const nodesOf = (id: string) => (id.startsWith('chain:') ? (chain(id) ?? []) : [id]);
  const lastOf = (id: string) => nodesOf(id).at(-1);
  const firstOf = (id: string) => nodesOf(id)[0];
  /** A drawn line's stored id (a section's split edge is "<id>:out" / "<id>:in"); a choice folded into a line is its node. */
  const edgeOf = (id: string) => (id.startsWith('via:') ? { choice: id.slice('via:'.length) } : id.startsWith('bypass:') || id.startsWith('portal:') ? null : { edge: id.replace(/:(out|in)$/, '') });
  const run = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  };
  /** Does an edit and records it: undo with its token, redo by doing it again (a new token). An edit that changed nothing has no token and is not recorded. */
  const step = async <T extends { token: string | null }>(call: () => Promise<T>) => {
    const first = await call();
    const recorded = tokenStep(first, call, (token) => undoChange(projectId, token));
    if (recorded) history.record(recorded);
    return first;
  };

  return {
    /** Whether a drawn line can be deleted (lines a view derives are not stored). */
    canDeleteEdge: (id: string) => edgeOf(id) !== null,
    connect: (fromId: string, toId: string) =>
      run(async () => {
        const from = lastOf(fromId), to = firstOf(toId);
        if (!from || !to || from === to) return;
        await step(() => edits.connect(from, to));
      }),
    /** Deletes nodes (drawn ids) and a line at once: a choice's line takes the choice away, nodes keep the way through them. */
    remove: (target: { nodeIds: string[]; edgeId?: string }) =>
      run(async () => {
        const line = target.edgeId ? edgeOf(target.edgeId) : null;
        const nodeIds = target.nodeIds.flatMap(nodesOf);
        if (line?.edge) await step(() => edits.deleteEdges([line.edge]));
        if (line?.choice) await step(() => edits.deleteNodes([line.choice], false));
        if (nodeIds.length) await step(() => edits.deleteNodes(nodeIds, true));
      }),
    /** "대본 순서로 잇기" for scenes (ids) and/or dialogue nodes (drawn ids); says how many were linked. */
    linkInOrder: (target: { groupIds?: string[]; nodeIds?: string[] }) =>
      run(async () => {
        const nodeIds = target.nodeIds?.flatMap(nodesOf);
        const result = await step(() => edits.linkInOrder({ ...(target.groupIds?.length && { groupIds: target.groupIds }), ...(nodeIds?.length && { nodeIds }) }));
        const kept = result.skipped ? ` (이미 이어진 ${result.skipped.toLocaleString()}곳은 그대로)` : '';
        if (result.linked) toast.success(`${result.linked.toLocaleString()}곳을 이었습니다${kept}`);
        else toast.info(`새로 이을 곳이 없습니다${kept}`);
      }),
    /** A new line after a node (drawn id); returns the new node's id. */
    insertAfter: (nodeId: string, line: { source: string; speaker?: string | null; listener?: string | null }) =>
      run(async () => {
        const after = lastOf(nodeId);
        if (!after) return undefined;
        return (await step(() => edits.insertAfter(after, line))).nodeId;
      }),
    /** Copies of nodes (drawn ids) with the lines between them; returns old node id → new. */
    duplicate: (ids: string[]) =>
      run(async () => (await step(() => edits.duplicate(ids.flatMap(nodesOf)))).made),
    undo: () => run(() => history.undo()),
    redo: () => run(() => history.redo()),
  };
}

export type DialogueGraphEdits = ReturnType<typeof useDialogueGraphEdits>;
