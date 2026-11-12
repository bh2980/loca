import { useState } from 'react';
import { Box, PaneHeader, Stack, Text } from '@loca/ui';
import { useGraphPaneView } from '@/lib/graph-show';
import { EdgePane, InsertLinePane } from './edit-panes';
import { graphSearch, isPickingRoute } from './graph-search';
import { cardText } from './node-cards';
import { FlowPane, SceneNodeDetail } from './node-detail';
import type { DrawnGraphData } from './use-drawn-graph';
import type { GraphEditing } from './use-graph-editing';
import type { GraphNav } from './use-graph-nav';
import type { LineCardState } from './use-line-card';
import { OmittedPane, ViewInspector, ViewReason } from './view-inspector';

interface Props {
  nav: GraphNav;
  drawn: DrawnGraphData;
  editing: GraphEditing;
  card: LineCardState;
  select: (id: string | undefined) => void;
}

/** The derived edge whose left-out stretch the pane lists (`omitted` in the URL), when the layout still has it. */
const omittedEdgeOf = ({ search }: GraphNav, drawn: DrawnGraphData) => (search.omitted ? drawn.edges.find((edge) => edge.id === search.omitted && edge.omitted) : undefined);

/** What the pane is open on, for the split's own state (nothing while a route's ends are picked: a click picks an end). */
export function graphPaneKey(nav: GraphNav, drawn: DrawnGraphData): string | undefined {
  const { search } = nav;
  if (isPickingRoute(search)) return undefined;
  const omitted = omittedEdgeOf(nav, drawn);
  return search.node ?? (search.edge ? `edge:${search.edge}` : search.addAfter ? `add:${search.addAfter}` : omitted ? `omitted:${omitted.id}` : search.viewInfo && drawn.viewId ? 'view-info' : undefined);
}

/** Whether the pane has anything to show. */
export function graphPaneOpen(nav: GraphNav, drawn: DrawnGraphData): boolean {
  const { search } = nav;
  return Boolean(search.node || omittedEdgeOf(nav, drawn) || (search.viewInfo && drawn.viewId) || (search.scope === 'dialogue' && (search.edge || search.addAfter)));
}

/**
 * The graph page's right pane: one thing at a time, by what the URL has open. A line of the dialogue graph, the
 * place a new line goes after, the stretch a derived edge leaves out, the open view's own details, or the selected
 * node: a scene, a scene graph hub, or a dialogue node with the flow through it.
 */
export function GraphSidePane({ nav, drawn, editing, card, select }: Props) {
  const { projectId, search, go, set } = nav;
  const dialogue = search.scope === 'dialogue';
  const { layout, portals, hubs, viewId, sections, derivedEdges, nodeById } = drawn;
  const omittedEdge = omittedEdgeOf(nav, drawn);

  const content = () => {
    if (dialogue && search.edge) {
      const edgeId = search.edge;
      return (
        <EdgePane
          key={edgeId}
          projectId={projectId}
          edgeId={edgeId}
          onOpenNode={(id) => select(id)}
          onRemove={editing.editing && editing.edits.canDeleteEdge(edgeId) ? () => void editing.removeEdge(edgeId).then(() => editing.openEdge(undefined)) : undefined}
          onClose={() => editing.openEdge(undefined)}
        />
      );
    }
    if (dialogue && search.addAfter) {
      const after = search.addAfter;
      // The line it goes after: a folded run's last one.
      const last = nodeById.get(drawn.model.membersOf(after).at(-1) ?? after);
      return (
        <InsertLinePane
          key={after}
          after={{ speaker: last?.speaker ?? null, text: last?.text ?? null }}
          onAdd={async (line) => {
            const nodeId = await editing.edits.insertAfter(after, line);
            if (nodeId) set(graphSearch.addAfter(undefined));
          }}
          onClose={() => set(graphSearch.addAfter(undefined))}
        />
      );
    }
    if (!search.node && omittedEdge)
      return (
        <OmittedPane
          key={omittedEdge.id}
          projectId={projectId}
          edge={omittedEdge}
          sections={sections}
          onClose={() => set(graphSearch.omitted(undefined))}
          // Opening the source is navigation: the section holding the stretch, centred on its first node.
          onOpenSource={(section, nodeId) => go(graphSearch.omittedSource(section, nodeId))}
        />
      );
    if (!search.node && viewId)
      return (
        <ViewInspector
          projectId={projectId}
          viewId={viewId}
          shownNodes={layout ? layout.nodes.length - portals.size : 0}
          derivedEdges={derivedEdges}
          onClose={() => set(graphSearch.viewInfo(false))}
          onDeleted={() => go(graphSearch.viewDeleted())}
        />
      );
    if (!search.node) return null;
    const hub = !dialogue ? hubs.get(search.node) : undefined;
    if (hub)
      return (
        <Stack as="aside" height="full" variant="body">
          <PaneHeader kicker="장면 그래프" title="연결점" onClose={() => select(undefined)} />
          <Text as="p" paddingX="comfortable" paddingY="normal" tone="muted">
            장면에 속하지 않는 노드 {hub.nodes.toLocaleString()}개가 장면 {hub.scenes.toLocaleString()}개를 잇습니다
          </Text>
        </Stack>
      );
    if (!dialogue) return <SceneNodeDetail projectId={projectId} groupId={search.node} onClose={() => select(undefined)} />;
    return <NodeFlowPane key={search.node} nodeId={search.node} nav={nav} drawn={drawn} card={card} select={select} />;
  };
  return <Box height="full" background="page">{content()}</Box>;
}

/**
 * One pane for a node and a folded run alike: their lines, read in order, with the flow before and after them along
 * the way, node by node until it forks, merges or ends (the rule Alt+↓ steps by). Mounted per selection, so how far
 * the flow is shown starts over with each.
 */
function NodeFlowPane({ nodeId, nav, drawn, card, select }: Pick<Props, 'nav' | 'drawn' | 'card' | 'select'> & { nodeId: string }) {
  const { projectId, search } = nav;
  const { model, info, viewId, viewDetail } = drawn;
  const [paneView, setPaneView] = useGraphPaneView();
  const [span, setSpan] = useState({ before: 6, after: 6 });
  const own = model.flowOf(nodeId);
  const around = paneView === 'flow' && drawn.layout ? { before: model.walk(nodeId, -1, span.before), after: model.walk(nodeId, 1, span.after) } : null;
  const paneNodeIds = around ? [...[...around.before.ids].reverse().flatMap(model.membersOf), ...own, ...around.after.ids.flatMap(model.membersOf)] : own;
  // Why the open view holds this node (a run: its nodes' reasons, each once).
  const reasons = viewDetail.data?.reasons;
  const reason = viewId && reasons ? [...new Set(model.membersOf(nodeId).flatMap((id) => (reasons[id] ? [reasons[id]] : [])))].join('\n') : '';
  const shown = model.shown(nodeId);
  return (
    <Stack height="full" minHeight={0}>
      {reason && <ViewReason reason={reason} />}
      <Box minHeight={0} grow>
        <FlowPane
          projectId={projectId}
          nodeIds={paneNodeIds}
          ownIds={own}
          view={paneView}
          onView={setPaneView}
          around={around ? { before: { stop: around.before.stop, more: around.before.more }, after: { stop: around.after.stop, more: around.after.more } } : undefined}
          onMore={(side) => setSpan((current) => ({ ...current, [side]: current[side] + 10 }))}
          // What the selected node joins: the node on the other end of each way in and out, and the choice written on it.
          connections={model.connections(nodeId).map((connection) => ({ ...connection, text: cardText(info, connection.id) }))}
          onSelectNode={select}
          way={model.wayInto(nodeId)}
          marked={around && (around.before.ids.length || around.after.ids.length) ? own : model.chainOf.has(nodeId) ? nodeId : undefined}
          editing={search.edit}
          onEdit={card.edit}
          title={info.get(shown)?.title ?? info.get(shown)?.label ?? ''}
          onClose={() => select(undefined)}
        />
      </Box>
    </Stack>
  );
}
