import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GraphSelection } from '@/lib/graph-selection';
import { q } from '@/lib/queries';
import { realNodes } from './flow-model';
import { graphSearch } from './graph-search';
import type { DrawnGraphData } from './use-drawn-graph';
import type { GraphNav } from './use-graph-nav';
import { useViewActions } from './view-inspector';
import { useShortcuts } from '@/lib/shortcuts';

/**
 * What is done with a set of picked nodes that is not an edit of the graph: a workflow run over their lines, and
 * stored views (make one from them, add them to one, take them out of the open one). Also 보기 만들기 › 노드 골라서,
 * the mode in which a plain click picks a node (or takes it back) instead of opening it, until the view is named or
 * the mode is left.
 */
export function useNodeSets({ nav, drawn, selection, select }: { nav: GraphNav; drawn: DrawnGraphData; selection: GraphSelection; select: (id: string | undefined) => void }) {
  const { projectId, search, go } = nav;
  const { model, portals, viewId, savedViews } = drawn;
  const viewActions = useViewActions(projectId);
  const queryClient = useQueryClient();
  /** The real node ids behind picked ids: a folded run's nodes; portals stand for none. */
  const real = (ids: Iterable<string>) => realNodes(model, ids, (id) => portals.has(id));

  const [collecting, setCollecting] = useState(false);
  const stopCollecting = () => {
    setCollecting(false);
    selection.clear();
  };
  // Esc leaves it (a menu or the naming box open on top closes first, on its own Esc).
  useShortcuts({ collectStop: stopCollecting }, { enabled: collecting });

  /** The lines of the picked nodes, for a workflow run (its dialog opens on them). */
  const [runUnits, setRunUnits] = useState<string[]>();
  const run = async (ids: Iterable<string>) => {
    const details = await Promise.all(real(ids).map((id) => queryClient.fetchQuery(q.graphNode(projectId, id))));
    const unitIds = [...new Set(details.flatMap((detail) => detail.lines.map((line) => line.id)))];
    if (unitIds.length) setRunUnits(unitIds);
    else toast('고른 노드에 대사가 없습니다.');
  };

  /** Naming a view made from picked nodes: the small popover stands at `at` (where the menu was, or over the canvas). */
  const [naming, setNaming] = useState<{ nodeIds: string[]; at: { x: number; y: number } } | null>(null);
  const make = (label: string) => {
    if (!naming || !label.trim()) return;
    viewActions.create.mutate({ label: label.trim(), nodeIds: naming.nodeIds }, {
      onSuccess: ({ id }) => {
        setNaming(null);
        selection.clear();
        setCollecting(false);
        go(graphSearch.viewMade(id));
      },
    });
  };

  return {
    real,
    collecting,
    startCollecting: () => setCollecting(true),
    stopCollecting,
    runUnits,
    closeRun: () => setRunUnits(undefined),
    run,
    naming,
    /** Asks for the name of a view of these nodes; without a place, over the top of the canvas. */
    name: (ids: Iterable<string>, at: { x: number; y: number } = { x: window.innerWidth / 2, y: 140 }) => setNaming({ nodeIds: real(ids), at }),
    cancelNaming: () => setNaming(null),
    make,
    making: viewActions.create.isPending,
    /** The views a node set can be added to (the open one already holds its nodes; a route view holds its route's). */
    otherViews: savedViews.filter((saved) => saved.id !== viewId && !saved.route),
    addTo: (id: string, label: string, ids: Iterable<string>) => {
      const nodeIds = real(ids);
      viewActions.change.mutate({ id, add: nodeIds }, { onSuccess: () => toast.success(`보기 "${label}"에 노드 ${nodeIds.length.toLocaleString()}개를 더했습니다.`) });
    },
    /** Takes nodes out of the open view. */
    leave: (ids: Iterable<string>) => {
      if (!viewId) return;
      viewActions.change.mutate({ id: viewId, remove: real(ids) }, {
        onSuccess: () => {
          selection.clear();
          if (search.node) select(undefined);
        },
      });
    },
    rename: (view: { id: string; label: string }) => viewActions.change.mutate(view),
  };
}

export type NodeSets = ReturnType<typeof useNodeSets>;
