import { useState, type ReactNode, type RefObject } from 'react';
import { Background, MiniMap, NodeToolbar, Panel, Position, ReactFlow, SelectionMode, useReactFlow, useViewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Frame, Group, Pencil, Tag, Trash2, Ungroup } from 'lucide-react';
import type { WorkflowDefinition } from '@tw/shared';
import { CanvasDrawLayer, CanvasSurface, CanvasToolbar, EdgeLegend, Icon, Inline, SelectionToolbox, type CanvasDirection, type NodeLibraryGroup } from '@loca/ui';
import { useIsDark } from '@/lib/theme';
import { useStoredViewport, viewportScope } from '@/lib/viewport';
import { EditorContextMenu, type EditorMenuTarget } from './editor-menu';
import { exitKey } from './exit-marks';
import { fitWhole, FLOW_EDGE_TYPES, FLOW_NODE_TYPES } from './flow-canvas';
import { allFoldsOpen, setAllFolds } from './fold';
import { frameAt, frameId, frameTints, groupIdOf, isFrameId } from './frames';
import { exitActionItem } from './node-palette';
import type { FlowNode } from './node-view';
import type { WorkflowCanvas } from './use-workflow-canvas';
import type { WorkflowEditing } from './use-workflow-editing';
import { focusWorkflowNode, type WorkflowLayout } from './use-workflow-layout';
import type { WorkflowSelection } from './use-workflow-selection';
import type { WorkflowView } from './use-workflow-view';

/** A note at the top of the canvas saying what the pointer does now (a mode, a drag). */
function CanvasNote({ icon, children }: { icon: typeof Frame; children: ReactNode }) {
  return (
    <Panel position="top-center">
      <Inline role="status" gap="condensed" background="overlay" border="all" radius="md" shadow="sm" paddingX="comfortable" paddingY="condensed" variant="caption">
        <Icon icon={icon} size="sm" tone="accent" />
        {children}
      </Inline>
    </Panel>
  );
}

interface Props {
  projectId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  direction: CanvasDirection;
  palette: NodeLibraryGroup[];
  surface: RefObject<HTMLDivElement | null>;
  selection: WorkflowSelection;
  view: WorkflowView;
  editing: WorkflowEditing;
  canvas: WorkflowCanvas;
  layout: WorkflowLayout;
}

/**
 * The workflow editor's canvas: React Flow over the draft, with how a click, a drag, a drop from the library and a
 * right-click are read, and the toolboxes over what is selected. Same gestures as the other graphs: left or middle
 * drag pans, Shift+drag draws a selection box, ⌘/Ctrl+click adds a node; a plain click picks one thing (a node, a
 * frame, or a line's exit) and opens its pane.
 */
export function WorkflowCanvasView({ projectId, workflowId, definition, direction, palette, surface, selection, view, editing, canvas, layout }: Props) {
  const dark = useIsDark();
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const [minimap, setMinimap] = useState(false);
  const [menu, setMenu] = useState<EditorMenuTarget | null>(null);
  // The view is remembered per workflow and direction (lib/viewport.ts).
  const viewport = useStoredViewport(projectId, 'workflow', viewportScope(workflowId, direction));
  const { select, selectFrame, selectExit, nodes: picked, edgeId, setEdgeId, setHoveredEdgeId, node: selected, group: pickedGroup } = selection;
  const { shown, folds, foldState, setFoldState, frameBoxes } = view;
  const { frames } = canvas;
  const pickedIds = [...picked.picked];
  const shownOnly = (ids: string[]) => ids.filter((id) => view.shownIds.has(id));
  return (
    <CanvasSurface
      ref={surface}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const id = event.dataTransfer.getData('application/x-loca-workflow-node');
        // An exit action dropped on a line goes on that line's exit; anywhere else it waits for a line to be clicked.
        if (exitActionItem(id)) {
          const line = (document.elementFromPoint(event.clientX, event.clientY) as Element | null)?.closest('.react-flow__edge')?.getAttribute('data-id');
          const edge = line ? definition.edges.find((item) => item.id === line) : undefined;
          return edge ? editing.addExitAction(edge.source, edge.sourceHandle, id) : editing.setPickingExit(id);
        }
        if (palette.some((group) => group.items.some((item) => item.id === id))) editing.addFromLibrary(id, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}
    >
      <ReactFlow
        colorMode={dark ? 'dark' : 'light'}
        nodes={[...frameTints(frames), ...frames, ...canvas.nodes] as FlowNode[]}
        edges={canvas.edges}
        nodeTypes={FLOW_NODE_TYPES}
        edgeTypes={FLOW_EDGE_TYPES}
        onNodesChange={canvas.onNodesChange}
        onEdgesChange={canvas.onEdgesChange}
        onConnect={canvas.onConnect}
        {...canvas.drag}
        onNodeClick={(event, node) => {
          if (isFrameId(node.id)) return (picked.clear(), setEdgeId(undefined), setMenu(null), selectFrame(groupIdOf(node.id)));
          if (event.metaKey || event.ctrlKey) return;
          picked.clear();
          select(node.id);
          setEdgeId(undefined);
          setMenu(null);
        }}
        // A plain click on a line picks only the line and opens its exit (what it does to the lines, where they go): the
        // node's selection (and its pane) goes, as anywhere else a plain click picks one thing. With an exit action
        // picked from '＋ 노드', the click puts it there.
        onEdgeClick={(event, edge) => {
          setMenu(null);
          setEdgeId(edge.id);
          if (event.metaKey || event.ctrlKey) return;
          picked.clear();
          if (editing.pickingExit) return editing.addExitAction(edge.source, edge.sourceHandle ?? 'out', editing.pickingExit);
          selectExit(exitKey(edge.source, edge.sourceHandle ?? 'out'));
        }}
        onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(undefined)}
        // The room inside a frame is the canvas (it pans), but a click there picks the frame.
        onPaneClick={(event) => {
          picked.clear();
          setEdgeId(undefined);
          setMenu(null);
          const under = frameAt(frameBoxes, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          if (under) selectFrame(groupIdOf(under));
          else select(undefined);
        }}
        onNodeContextMenu={(event, flowNode) => {
          event.preventDefault();
          if (isFrameId(flowNode.id)) return;
          setEdgeId(undefined);
          const at = { x: event.clientX, y: event.clientY };
          if (picked.picked.size >= 2 && picked.picked.has(flowNode.id)) return setMenu({ kind: 'nodes', ids: pickedIds, ...at });
          // The menu acts on this node; the selection (and its config pane) stays as it was.
          const node = definition.nodes.find((item) => item.id === flowNode.id);
          if (node) setMenu({ kind: 'node', node, ...at });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          select(undefined);
          setEdgeId(edge.id);
          setMenu({ kind: 'edge', edgeId: edge.id, x: event.clientX, y: event.clientY });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          setMenu({ kind: 'pane', x: event.clientX, y: event.clientY });
        }}
        // A remembered view comes back as it was; the first look is one readable node (the open one, else the first).
        onInit={(instance) => (viewport.initial ? void instance.setViewport(viewport.initial) : focusWorkflowNode(instance, layout.focusId(), direction, surface.current))}
        onMoveEnd={(_event, at) => viewport.save(at)}
        panOnDrag={[0, 1]}
        // Dragging a node moves it; it does not pick it (picking is a click, ⌘/Ctrl+click or Shift+drag).
        selectNodesOnDrag={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionMode={SelectionMode.Partial}
        minZoom={0.05}
        // Delete goes through the shared graph keys (the entry node stays; undo brings anything back).
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background size={1.5} gap={20} color="var(--fill-graph-grid)" />
        <Panel position="top-right"><EdgeLegend /></Panel>
        <Panel position="bottom-left">
          <CanvasToolbar
            zoomPercent={zoom * 100}
            onZoomIn={() => void flow.zoomIn()}
            onZoomOut={() => void flow.zoomOut()}
            onFit={() => fitWhole(flow, 200)}
            onResetZoom={() => void flow.zoomTo(1, { duration: 180 })}
            onLayout={() => void layout.arrange(direction, true)}
            layoutLabel="자동 정렬"
            direction={direction}
            onDirectionChange={layout.changeDirection}
            foldsOpen={folds.length ? allFoldsOpen(folds, foldState) : undefined}
            onToggleFolds={() => setFoldState(setAllFolds(folds, !allFoldsOpen(folds, foldState)))}
            minimapVisible={minimap}
            onToggleMinimap={() => setMinimap((value) => !value)}
          />
        </Panel>
        {minimap && <MiniMap position="bottom-right" pannable zoomable />}
        {selected && shown.some((node) => node.id === selected.id) && (
          <NodeToolbar nodeId={selected.id} isVisible position={Position.Top} offset={16}>
            <SelectionToolbox actions={selected.type !== 'entry' ? [
              { id: 'copy', label: '복제', icon: <Copy />, onSelect: () => editing.duplicateNode(selected) },
              { id: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => editing.deleteNodes([selected.id]) },
            ] : []} />
          </NodeToolbar>
        )}
        {/* A frame sits under the nodes; its toolbar must not (it would take that layer and miss the pointer). */}
        {pickedGroup && frames.some((frame) => frame.id === frameId(pickedGroup.id)) && (
          <NodeToolbar nodeId={frameId(pickedGroup.id)} isVisible position={Position.Top} offset={8} style={{ zIndex: 1000 }}>
            <SelectionToolbox actions={[
              { id: 'rename', label: '이름 바꾸기', icon: <Pencil />, onSelect: () => editing.setRenamingFrame(pickedGroup.id) },
              { id: 'ungroup', label: '프레임만 삭제', icon: <Ungroup />, onSelect: () => editing.ungroupFrame(pickedGroup.id) },
              { id: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => editing.deleteFrame(pickedGroup.id) },
            ]} />
          </NodeToolbar>
        )}
        {editing.pickingExit && <CanvasNote icon={Tag}>{exitActionItem(editing.pickingExit)?.label}: 붙일 선을 누르세요 · Esc 취소</CanvasNote>}
        {editing.drawingFrame && <CanvasNote icon={Frame}>끌어서 프레임을 그리세요. 한 번 누르면 그 자리에 추가합니다 · Esc 취소</CanvasNote>}
        {/* What letting go will do, while nodes are dragged across frames. */}
        {canvas.dropHint && <CanvasNote icon={Frame}>{canvas.dropHint}</CanvasNote>}
        {pickedIds.length > 1 && (
          <NodeToolbar nodeId={pickedIds} isVisible position={Position.Top} offset={16}>
            <SelectionToolbox actions={[
              { id: 'frame', label: '프레임으로 묶기', icon: <Group />, onSelect: () => editing.groupPicked(shownOnly(pickedIds)) },
              { id: 'copy', label: `${pickedIds.length}개 복제`, icon: <Copy />, onSelect: () => editing.duplicateNodes(pickedIds) },
              { id: 'delete', label: `${pickedIds.length}개 삭제`, icon: <Trash2 />, destructive: true, onSelect: () => editing.deleteNodes(pickedIds) },
            ]} />
          </NodeToolbar>
        )}
        {/* A box selection also picks the edges between its nodes; those go with the nodes, not as one edge to delete. */}
        {edgeId && pickedIds.length < 2 && <Panel position="top-center"><SelectionToolbox actions={[{ id: 'delete-edge', label: '연결 삭제', icon: <Trash2 />, destructive: true, onSelect: () => editing.removeEdges([edgeId]) }]} /></Panel>}
      </ReactFlow>
      {editing.drawingFrame && <CanvasDrawLayer label="끌어서 프레임 그리기" onDraw={editing.drawFrame} onCancel={editing.stopDrawingFrame} />}
      <EditorContextMenu menu={menu} onClose={() => setMenu(null)} definition={definition} palette={palette} direction={direction} selection={selection} view={view} editing={editing} layout={layout} />
    </CanvasSurface>
  );
}
