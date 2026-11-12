import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CopyPlus, ListOrdered, Trash2 } from 'lucide-react';
import { RunDialog } from '@/components/workflow/run-dialog';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/graph-canvas';
import { resolveChainEndpoint, endpointMarkers } from '@/components/graph/flow-model';
import { GraphContextMenu, type GraphMenuTarget } from '@/components/graph/graph-menu';
import { GraphBars, GraphStatus, GraphTools, NameViewPopover } from '@/components/graph/graph-overlays';
import { GraphSidePane, graphPaneKey, graphPaneOpen } from '@/components/graph/graph-pane';
import { graphSearch, isPickingRoute, isUnsavedRoute, pickingEnd, routeEnds, validateGraphSearch, viewIdOf, type GraphScope } from '@/components/graph/graph-search';
import { LineCard } from '@/components/graph/line-card';
import { PathMode } from '@/components/graph/path-mode';
import { nodeAfterToggle, pickedAfterToggle } from '@/components/graph/unfold-chains';
import { useDrawnGraph } from '@/components/graph/use-drawn-graph';
import { useGraphEditing } from '@/components/graph/use-graph-editing';
import { useGraphNav } from '@/components/graph/use-graph-nav';
import { useLineCard } from '@/components/graph/use-line-card';
import { useNodeSets } from '@/components/graph/use-node-sets';
import { useRouteEndpoints } from '@/components/graph/use-route-endpoints';
import { DeleteViewDialog, useViewActions } from '@/components/graph/view-inspector';
import { GraphViewMenu, ScriptToggle, ViewMenu } from '@/components/graph/view-menu';
import { HeaderActions, HeaderViews, Page } from '@/components/page';
import { Box, CanvasOverlay, CanvasSurface, FloatingZoomBar, GraphEndpointBar, Inline, SelectionToolbox, Spinner, SplitPane, Stack, ViewSwitch, useRevealDock } from '@loca/ui';
import { useSize } from '@/hooks/use-size';
import { afterBoxPick, useGraphSelection } from '@/lib/graph-selection';
import { useGraphPaneView } from '@/lib/graph-show';
import { q } from '@/lib/queries';
import { useStoredViewport, viewportScope } from '@/lib/viewport';

export const Route = createFileRoute('/p/$projectId/graph')({
  validateSearch: validateGraphSearch,
  component: GraphRoute,
});

/** The graph's modes in one segment control: the dialogue graph (the default, where links are made) and the scene graph read off it. */
function ModeToggle({ value, onChange }: { value: GraphScope; onChange: (value: GraphScope) => void }) {
  return <ViewSwitch label="그래프 보기" value={value} onChange={(next) => onChange(next as GraphScope)} items={[
    { value: 'dialogue', label: '대사' }, { value: 'scene', label: '장면' },
  ]} />;
}

/**
 * Which screen the URL asks for: a reading route (picked but not saved yet, or a saved route view laid out with its
 * script) is PathMode; everything else is the graph itself.
 */
function GraphRoute() {
  const { projectId, search, go, set } = useGraphNav();
  const direction = search.direction ?? 'vertical';
  const picking = isPickingRoute(search);
  const unsavedRoute = isUnsavedRoute(search);
  const viewId = search.scope === 'dialogue' ? viewIdOf(search.section) : undefined;
  const scriptView = useQuery({ ...q.graphView(projectId, viewId ?? ''), enabled: Boolean(viewId && search.script && !unsavedRoute && !picking) });
  const viewActions = useViewActions(projectId);
  const shared = {
    projectId,
    direction,
    onDirectionChange: (next: typeof direction) => go(graphSearch.direction(next)),
    toggle: <ModeToggle value="dialogue" onChange={(mode) => go(graphSearch.mode(mode))} />,
    edit: search.edit,
    onEdit: (edit: string | undefined) => set(graphSearch.edit(edit)),
  };

  if (unsavedRoute)
    return (
      <PathMode
        {...shared}
        start={search.routeStart}
        end={search.routeEnd}
        onBeginPicking={(step) => go(graphSearch.repick(step))}
        onClear={() => go(graphSearch.clearRoute())}
        onSaved={(id) => set(graphSearch.routeSaved(id))}
      />
    );

  if (viewId && search.script && !picking) {
    const saved = scriptView.data;
    if (saved?.route)
      return (
        <PathMode
          key={viewId}
          {...shared}
          view={{ id: viewId, label: saved.label }}
          viewMenu={
            <GraphViewMenu
              projectId={projectId}
              direction={direction}
              chosen={search.section}
              openedLabel={saved.label}
              onPick={(value) => go(graphSearch.sectionFromScript(value))}
              onDeleted={(id) => id === viewId && go(graphSearch.viewDeleted())}
              onNewRoute={() => go(graphSearch.newRoute())}
            />
          }
          layoutToggle={<ScriptToggle value onChange={(script) => go(graphSearch.script(script))} />}
          start={saved.route.start}
          end={saved.route.end}
          via={saved.route.via ?? ''}
          onViaChange={(via) => viewActions.change.mutateAsync({ id: viewId, via })}
        />
      );
    if (scriptView.isPending)
      return (
        <Page title="그래프" flush>
          <Inline height="full" justify="center" gap="condensed" variant="body" tone="muted" role="status">
            <Spinner /> 보기를 불러오는 중…
          </Inline>
        </Page>
      );
    // Not a route view (or gone): the graph alone.
  }

  return <GraphPage />;
}

/**
 * The dialogue and scene graphs. The page puts its parts together and says how a click on the canvas is read:
 * what is drawn (use-drawn-graph), the picked set (lib/graph-selection), editing and its keys (use-graph-editing),
 * views and runs over picked nodes (use-node-sets), translating beside a node (use-line-card), the right-click menu
 * (graph-menu), the overlays (graph-overlays) and the right pane (graph-pane). Its state is the URL (graph-search).
 */
function GraphPage() {
  const nav = useGraphNav();
  const { projectId, search, go, set } = nav;
  const dialogue = search.scope === 'dialogue';
  const picking = isPickingRoute(search);
  const drawn = useDrawnGraph(projectId, search);
  const { layout, model, portals, hubs, direction, chosen, viewId } = drawn;
  const [container, size] = useSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);
  const revealDock = useRevealDock();
  const [, setPaneView] = useGraphPaneView();
  const [menu, setMenu] = useState<GraphMenuTarget | null>(null);
  const [deletingView, setDeletingView] = useState<{ id: string; label: string } | null>(null);
  /** Box or modifier-click selection; a single selection stays in the URL (`node`). */
  const selection = useGraphSelection(search.node);
  const { picked } = selection;
  const card = useLineCard({ nav, drawn, canvas });

  const select = (id: string | undefined) => {
    const portal = id ? portals.get(id) : undefined;
    // A portal is navigation to the section it stands for (or, in a view of chosen scenes, to the scene the lines
    // continue in, shown in its own section), not a node to inspect.
    if (portal?.groupId) return go(graphSearch.sceneAlone(portal.groupId));
    if (portal) return go(graphSearch.portalSection(portal.section));
    // While the translation card is open, picking another node keeps translating there (its first line without a
    // translation); clicking empty canvas or Esc ends it. The node the card already stands by stays as it is.
    if (id && search.edit && search.node && model.shown(id) === model.anchorOf(search.node)) return;
    if (id && search.edit && dialogue) card.followTo(id);
    set(graphSearch.node(id));
  };
  const openDetail = (id: string) => {
    select(id);
    revealDock?.();
  };
  const sets = useNodeSets({ nav, drawn, selection, select });
  const editing = useGraphEditing({ nav, drawn, selection, select });

  const toggleFold = (runId: string) => {
    const run = drawn.foldedRuns?.find((item) => item.id === runId);
    const opening = !drawn.openRuns.has(runId);
    // The selection follows the run's new form: the block and its lines are different nodes on the canvas.
    if (run && picked.size) selection.set(pickedAfterToggle(run, opening, picked));
    const next = new Set(drawn.openRuns);
    if (!next.delete(runId)) next.add(runId);
    const holder = card.lines.find((line) => line.unitId === search.edit)?.nodeId;
    set(graphSearch.open([...next], run && ((node) => nodeAfterToggle(run, opening, node, holder))));
  };

  // Arriving from a line: the canvas opens centred on its node (inside a folded run, the run; a choice, what it
  // leads to), then `jump` is forgotten. The line's scene only picks the section; it is not highlighted (the rest of
  // the graph would dim while one only wants to read around the line).
  const canvasShown = (drawn.data?.status === 'ready' || drawn.relayout) && !!layout && size.width > 0 && !drawn.marking;
  useEffect(() => {
    if (!search.jump || !search.node || !layout) return;
    if (search.scene) return set(graphSearch.jumpSection(chosen));
    if (canvasShown) set(graphSearch.jumpDone());
  }, [search.jump, search.node, search.scene, layout, canvasShown]); // eslint-disable-line react-hooks/exhaustive-deps

  // A reading route's ends, while they are picked on this graph.
  const ends = routeEnds(search);
  const endpoints = useRouteEndpoints(projectId, ends);
  const end = pickingEnd(search);
  const markers = useMemo(() => (dialogue ? endpointMarkers(model, { start: ends.start, end: ends.end }) : undefined), [dialogue, model, ends.start, ends.end]);
  /** A node picked as the end being picked: a folded run is its first or last node with lines. */
  const pickEnd = (id: string) => set(graphSearch.pick(end, resolveChainEndpoint(id, end, layout?.chains, drawn.data?.nodes)));

  // The view is remembered per graph, direction, section and what it was opened on (lib/viewport.ts).
  const viewport = useStoredViewport(projectId, 'source', viewportScope(search.scope, direction, dialogue ? (chosen ?? 'all') : undefined, search.scene ?? (dialogue && search.mark ? `mark:${search.mark}` : undefined)));
  const shownNode = search.node ? model.shown(search.node) : undefined;
  const pickable = (id: string) => !portals.has(id) && !id.startsWith('omitted:');
  // One picked card has the toolbox the other graphs show over a picked item.
  const toolbar = (() => {
    if (!search.node || picked.size || !layout) return undefined;
    if (editing.editing && layout.nodes.some((node) => node.id === shownNode))
      return {
        id: shownNode!,
        content: <SelectionToolbox actions={[
          { id: 'copy', label: '복제', icon: <CopyPlus />, onSelect: () => void editing.paste([search.node!]) },
          { id: 'delete', label: '삭제', icon: <Trash2 />, onSelect: editing.removePicked },
        ]} />,
      };
    if (editing.sceneEditing && !hubs.has(search.node) && layout.nodes.some((node) => node.id === search.node))
      return { id: search.node, content: <SelectionToolbox actions={[{ id: 'order', label: '대본 순서로 잇기', icon: <ListOrdered />, onSelect: () => editing.orderScenes([search.node!]) }]} /> };
    return undefined;
  })();

  return (
    <Page title="그래프" flush>
      <HeaderViews>
        <ModeToggle value={search.scope} onChange={(mode) => go(graphSearch.mode(mode))} />
      </HeaderViews>
      <HeaderActions>
        {/* What part of the graph is shown, and where a view is made: from a route, or from nodes picked on the canvas. */}
        {dialogue && (
          <ViewMenu
            sections={drawn.sections}
            views={drawn.savedViews}
            chosen={chosen}
            openedLabel={drawn.view?.label}
            // Opening another view or section is navigation (a history entry); the pane's selection does not carry over.
            onPick={(value) => go(graphSearch.section(value))}
            onRename={sets.rename}
            onDelete={setDeletingView}
            picked={picked.size}
            onNewRoute={() => {
              sets.stopCollecting();
              go(graphSearch.newRoute());
            }}
            onNewNodes={() => {
              sets.startCollecting();
              setMenu(null);
              if (search.node) select(undefined);
            }}
          />
        )}
        {/* A route view opens as the graph alone or with its script beside it. */}
        {dialogue && drawn.viewDetail.data?.route && !picking && <ScriptToggle value={false} onChange={(script) => go(graphSearch.script(script))} />}
        <DeleteViewDialog
          projectId={projectId}
          view={deletingView}
          onClose={() => setDeletingView(null)}
          onDeleted={(id) => {
            setDeletingView(null);
            // The view that was open falls back to the whole graph.
            if (viewId === id) go(graphSearch.viewDeleted());
          }}
        />
      </HeaderActions>
      <Stack height="full" minHeight={0} grow overflow="hidden">
        {picking && (
          <GraphEndpointBar
            start={endpoints.start}
            end={endpoints.end}
            step={end}
            picking
            canFind={Boolean(endpoints.start && endpoints.end)}
            onStepChange={(step) => go(graphSearch.pickStep(step))}
            onFind={() => go(graphSearch.applyRoute())}
            onClear={() => go(graphSearch.clearRoute())}
          />
        )}
        <Box position="relative" minHeight={0} grow overflow="hidden">
          <SplitPane id="graph" selectionKey={graphPaneKey(nav, drawn)} defaultWidth="380px" fill pane={graphPaneOpen(nav, drawn) && <GraphSidePane nav={nav} drawn={drawn} editing={editing} card={card} select={select} />}>
            <CanvasSurface ref={container}>
              {canvasShown && layout && (
                <GraphCanvas
                  key={`${search.scope}:${direction}:${chosen ?? 'all'}:${search.scene ?? ''}:${search.mark ?? ''}`}
                  handle={canvas}
                  nodes={layout.nodes}
                  regions={layout.regions}
                  edges={drawn.edges}
                  looseEdges={layout.looseEdges}
                  direction={direction}
                  onDirectionChange={(next) => go(graphSearch.direction(next))}
                  hubs={hubs}
                  info={drawn.info}
                  width={size.width}
                  height={size.height}
                  selectedId={picking ? undefined : shownNode}
                  // The node a menu is open on is marked like a selected one while the menu is up.
                  selectedIds={!picked.size && menu?.nodeId ? new Set([menu.nodeId]) : (picked as Set<string>)}
                  onSelectMany={picking ? undefined : (ids, additive) => {
                    setMenu(null);
                    // A box or ⌘/Ctrl+click picks (ringed), even a single node; only a plain click opens its pane.
                    // While collecting for a view a box adds to what is picked, as ⌘/Ctrl does.
                    selection.set(afterBoxPick({ picked, single: shownNode, ids, additive, keep: additive || sets.collecting, pickable }));
                    if (search.node) select(undefined);
                  }}
                  highlight={drawn.highlight}
                  endpointMarkers={markers}
                  initialViewport={search.jump ? undefined : viewport.initial}
                  initialFocus={search.jump && search.node ? model.anchorOf(search.node) : undefined}
                  onViewportChange={viewport.save}
                  onSelect={(id) => {
                    setMenu(null);
                    if (sets.collecting) return void (id && pickable(id) && selection.toggle(id));
                    selection.clear();
                    if (!id) return select(undefined);
                    // A derived edge's label: the stretch it leaves out opens in the pane.
                    if (id.startsWith('omitted:')) return void (!picking && set(graphSearch.omitted(id.slice('omitted:'.length))));
                    if (dialogue && picking) return pickEnd(id);
                    select(id);
                  }}
                  // The menu acts on the node under the pointer; the selection (and the detail pane) stays as it was.
                  onContextMenu={(rawId, at) => {
                    const nodeId = rawId?.startsWith('omitted:') ? undefined : rawId;
                    if (nodeId && !picked.has(nodeId)) selection.clear();
                    setMenu({ nodeId, x: at.clientX, y: at.clientY });
                  }}
                  toolbar={toolbar}
                  editable={editing.editing}
                  onConnect={(fromId, toId) => void editing.edits.connect(fromId, toId)}
                  selectedEdgeId={search.edge}
                  onToggleFold={toggleFold}
                  onSelectEdge={dialogue ? (edgeId) => (edgeId.startsWith('via:') ? select(edgeId.slice('via:'.length)) : edgeId.startsWith('link:') ? undefined : editing.openEdge(edgeId)) : undefined}
                  onEdgeContextMenu={editing.editing ? (edgeId, at) => setMenu({ edgeId, x: at.clientX, y: at.clientY }) : undefined}
                  onOpen={dialogue ? card.start : undefined}
                  anchor={
                    card.anchorId && search.edit
                      ? {
                          id: card.anchorId,
                          content: <LineCard projectId={projectId} unitId={search.edit} choice={card.lines[card.at]!.choice} position={`${card.at + 1} / ${card.lines.length}`} maxHeight={Math.max(240, size.height - 24)} onShowNode={() => { setPaneView('node'); revealDock?.(); }} onStep={card.step} onClose={() => card.edit(undefined)} />,
                        }
                      : undefined
                  }
                />
              )}
              <GraphContextMenu menu={menu} onClose={() => setMenu(null)} nav={nav} drawn={drawn} selection={selection} editing={editing} sets={sets} card={card} canvas={canvas} select={select} onOpenDetail={openDetail} onToggleFold={toggleFold} />
              <NameViewPopover sets={sets} />
              {sets.runUnits && <RunDialog projectId={projectId} unitIds={sets.runUnits} unitsLabel="고른 노드" open onOpenChange={(open) => !open && sets.closeRun()} hideTrigger />}
              <GraphStatus drawn={drawn} />
              {layout && (
                <>
                  <CanvasOverlay
                    tools={
                      <GraphTools
                        nav={nav}
                        drawn={drawn}
                        onFound={(id) => {
                          // While a route's ends are picked, a found node is picked as the end.
                          if (dialogue && picking) pickEnd(id);
                          else select(id);
                          canvas.current?.focus(model.shown(id));
                          set(graphSearch.find(undefined));
                        }}
                      />
                    }
                    // A picking's actions on the canvas, not only in the right-click menu (the same ones).
                    details={<GraphBars nav={nav} drawn={drawn} selection={selection} editing={editing} sets={sets} />}
                  />
                  <FloatingZoomBar onZoomOut={() => canvas.current?.zoomBy(0.7)} onZoomIn={() => canvas.current?.zoomBy(1.4)} onFit={() => canvas.current?.fit()} />
                </>
              )}
            </CanvasSurface>
          </SplitPane>
        </Box>
      </Stack>
    </Page>
  );
}
