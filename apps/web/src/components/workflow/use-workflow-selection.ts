import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { nodePorts, type WorkflowDefinition } from '@loca/shared';
import { useGraphSelection } from '@/lib/graph-selection';
import { parseExitKey } from './exit-marks';

const route = getRouteApi('/p/$projectId/workflows/$workflowId');

/**
 * What is selected in the workflow editor. One thing is open at a time, in the URL, with its pane: a node (`node`),
 * a frame (`frame`) or an exit (`exit`, "node id:exit"). A box or ⌘/Ctrl+click picks nodes instead (ringed, even a
 * single one; lib/graph-selection): a picked set has no pane. The selected line is kept here too: edges are rebuilt
 * from the definition, so React Flow cannot hold their selection.
 */
export function useWorkflowSelection(definition: WorkflowDefinition | undefined) {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const select = (id: string | undefined) => void navigate({ search: (previous) => ({ ...previous, node: id, frame: undefined, exit: undefined }) });
  const selectFrame = (groupId: string | undefined) => void navigate({ search: (previous) => ({ ...previous, node: undefined, exit: undefined, frame: groupId }) });
  /** Opens an exit's pane: its actions and where its lines go. */
  const selectExit = (key: string | undefined) => void navigate({ search: (previous) => ({ ...previous, node: undefined, frame: undefined, exit: key }) });
  const nodes = useGraphSelection(search.node);
  const [edgeId, setEdgeId] = useState<string>();
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>();

  const node = definition?.nodes.find((item) => item.id === search.node);
  const group = definition?.groups?.find((item) => item.id === search.frame);
  const exit = (() => {
    const at = parseExitKey(search.exit);
    const owner = at && definition?.nodes.find((item) => item.id === at.nodeId);
    return owner && at && nodePorts(owner).some((port) => port.id === at.port) ? { node: owner, port: at.port } : undefined;
  })();

  return {
    search,
    navigate,
    select,
    selectFrame,
    selectExit,
    /** The picked nodes (a box, ⌘/Ctrl+click); `nodes.ids` is what the keys act on: the picked set, else the open node. */
    nodes,
    edgeId,
    setEdgeId,
    hoveredEdgeId,
    setHoveredEdgeId,
    /** The open node, frame and exit, when the definition still has them. */
    node,
    group,
    exit,
    /** Drops what a restored or changed definition no longer has from the selection. */
    keepOnly: (kept: WorkflowDefinition) => {
      const ids = new Set(kept.nodes.map((item) => item.id));
      if (nodes.picked.size) nodes.set([...nodes.picked].filter((id) => ids.has(id)));
      setEdgeId((id) => (id && kept.edges.some((edge) => edge.id === id) ? id : undefined));
      if (search.node && !ids.has(search.node)) select(undefined);
    },
  };
}

export type WorkflowSelection = ReturnType<typeof useWorkflowSelection>;
