import { workflowInput, type WorkflowDefinition, type WorkflowIssue } from '@tw/shared';
import { Box } from '@loca/ui';
import { tagsIn } from '@/lib/queries';
import { exitKey } from './exit-marks';
import { FramePanel } from './frame-panel';
import { NodeConfig } from './node-config';
import { ExitPanel } from './node-config/exit-actions';
import type { NodeRefs } from './node-config/shared';
import type { WorkflowEditing } from './use-workflow-editing';
import type { WorkflowSelection } from './use-workflow-selection';
import { WorkflowSettings } from './workflow-settings';

interface Props {
  projectId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  issues: WorkflowIssue[];
  selection: WorkflowSelection;
  editing: WorkflowEditing;
  statuses: NodeRefs['statuses'];
  /** Every tag of the project; the pane offers the ones of the workflow's input. */
  tags: (NodeRefs['tags'][number] & { scope: readonly string[] })[] | undefined;
  connections: NodeRefs['connections'];
  workflows: NodeRefs['workflows'];
}

/**
 * The workflow editor's right pane, by what is open: an exit (its actions and where its lines go), a frame, a node's
 * settings, or, with nothing open and nothing picked, the workflow's own settings.
 */
export function EditorPane({ projectId, workflowId, definition, issues, selection, editing, statuses, tags, connections, workflows }: Props) {
  const { node, group, exit, select, selectFrame, selectExit, nodes: picked } = selection;
  const refs = {
    statuses,
    // The tags of the workflow's input: line tags, or term tags.
    tags: tagsIn(tags, workflowInput(definition)),
    projectId,
    workflowId,
    connections,
    nodes: definition.nodes,
    edges: definition.edges,
    workflows,
    onOpenNode: select,
  };
  const content = () => {
    if (exit && !node)
      return (
        <ExitPanel
          key={exitKey(exit.node.id, exit.port)}
          node={exit.node}
          port={exit.port}
          issues={issues.filter((issue) => issue.nodeId === exit.node.id)}
          refs={refs}
          onChange={editing.changeNode}
          onRemoveEdge={(id) => editing.removeEdges([id])}
          onClose={() => selectExit(undefined)}
        />
      );
    if (group && !node)
      return (
        <FramePanel
          group={group}
          nodes={definition.nodes}
          onRename={(label) => editing.renameFrame(group.id, label)}
          onUngroup={() => editing.ungroupFrame(group.id)}
          onDelete={() => editing.deleteFrame(group.id)}
          onOpenNode={select}
          onClose={() => selectFrame(undefined)}
        />
      );
    if (!node) return picked.picked.size ? null : <WorkflowSettings settings={definition.settings} onChange={editing.changeSettings} />;
    return (
      <NodeConfig
        key={`${node.id}:${editing.revision}`}
        node={node}
        issues={issues.filter((issue) => issue.nodeId === node.id)}
        refs={{
          ...refs,
          onOpenExit: (nodeId: string, port: string) => selectExit(exitKey(nodeId, port)),
          retries: definition.settings.retries,
          onOpenWorkflowSettings: () => select(undefined),
        }}
        onChange={editing.changeNode}
        onDelete={() => node.type !== 'entry' && editing.deleteNodes([node.id])}
        onClose={() => select(undefined)}
      />
    );
  };
  const shown = content();
  return shown && <Box height="full" minWidth={0} overflow="hiddenX" background="page">{shown}</Box>;
}
