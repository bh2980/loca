import { useLayoutEffect, useMemo, useRef } from 'react';
import { idClipboard } from '@/lib/graph-clipboard';
import type { GraphSelection } from '@/lib/graph-selection';
import { useGraphShortcuts } from '@/lib/graph-shortcuts';
import { useDialogueGraphEdits, type DrawnGraph } from './graph-edits';
import { graphSearch, isPickingRoute } from './graph-search';
import type { DrawnGraphData } from './use-drawn-graph';
import type { GraphNav } from './use-graph-nav';

/**
 * Editing from the graph page, with the keys every graph shares (lib/graph-shortcuts): the dialogue graph's nodes
 * and lines are copied, pasted and deleted here (a view's lines are derived, so a view is read only, and nothing is
 * edited while a route's ends are picked). The scene graph only shows how scenes connect: its links are read off the
 * dialogue graph; what it still does is link the nodes inside a scene in script order, and undo is shared.
 */
export function useGraphEditing({ nav, drawn, selection, select }: { nav: GraphNav; drawn: DrawnGraphData; selection: GraphSelection; select: (id: string | undefined) => void }) {
  const { projectId, search, set } = nav;
  const dialogue = search.scope === 'dialogue';
  // The edits read what is drawn (folded runs) when they run: kept after each render.
  const drawnNow = useRef<DrawnGraph | null>(null);
  useLayoutEffect(() => {
    drawnNow.current = drawn.layout ?? null;
  });
  const edits = useDialogueGraphEdits(projectId, drawnNow);
  const editing = dialogue && !isPickingRoute(search) && !drawn.viewId;
  const sceneEditing = !dialogue;
  const copied = useMemo(() => idClipboard('dialogue-nodes'), []);

  const openEdge = (edgeId: string | undefined) => set(graphSearch.edge(edgeId));
  const removeEdge = (edgeId: string) => edits.remove({ nodeIds: [], edgeId });
  /** Delete: the open line when it can go, else the picked nodes (the way through them is kept). */
  const removePicked = () => {
    if (search.edge && edits.canDeleteEdge(search.edge)) void removeEdge(search.edge).then(() => openEdge(undefined));
    else if (selection.ids.length) {
      const ids = selection.ids;
      selection.clear();
      void edits.remove({ nodeIds: ids });
      select(undefined);
    }
  };
  /** Copies of nodes with the lines between them, picked once made. */
  const paste = async (ids: string[]) => {
    const made = ids.length ? await edits.duplicate(ids) : undefined;
    if (made) selection.set(Object.values(made));
  };
  useGraphShortcuts(
    {
      undo: () => void edits.undo(),
      redo: () => void edits.redo(),
      // Scenes are not copied or deleted from here: only the dialogue graph has those.
      ...(editing && {
        copy: () => copied.copy(selection.ids),
        cut: () => {
          if (!selection.ids.length) return;
          copied.copy(selection.ids);
          removePicked();
        },
        paste: () => void paste(copied.read()),
        remove: removePicked,
      }),
    },
    editing || sceneEditing,
  );

  return {
    edits,
    editing,
    sceneEditing,
    copied,
    openEdge,
    removeEdge,
    removePicked,
    paste,
    /** The scenes a menu on `id` acts on: the picked ones when it is one of them; hubs are not scenes. */
    scenesOf: (id: string) => selection.targetsOf(id).filter((sceneId) => !drawn.hubs.has(sceneId)),
    /** 대본 순서로 잇기 for scenes. */
    orderScenes: (ids: string[]) => void edits.linkInOrder({ groupIds: ids }),
  };
}

export type GraphEditing = ReturnType<typeof useGraphEditing>;
