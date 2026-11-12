import { useEffect, useRef, type RefObject } from 'react';
import { useReactFlow, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import { toast } from 'sonner';
import type { CanvasDirection } from '@loca/ui';
import type { MarkNames } from './exit-marks';
import { arrangeFlow, fitWhole, NODE_SIZE, type Size } from './flow-canvas';
import type { WorkflowDraftState } from './use-workflow-draft';
import type { WorkflowSelection } from './use-workflow-selection';
import type { WorkflowView } from './use-workflow-view';

/** Show one readable starting/editing node at 100% until the person asks to fit everything. */
export function focusWorkflowNode<N extends Node, E extends Edge>(flow: ReactFlowInstance<N, E>, preferredId: string | undefined, direction: CanvasDirection, canvas: HTMLElement | null, positionOverride?: { x: number; y: number }, sizeOverride?: Size) {
  const nodes = flow.getNodes();
  const node = (preferredId && nodes.find((item) => item.id === preferredId)) ?? nodes[0];
  if (!node) return;
  const position = positionOverride ?? node.position;
  const nodeWidth = sizeOverride?.width ?? node.measured?.width ?? NODE_SIZE.width;
  const nodeHeight = sizeOverride?.height ?? node.measured?.height ?? NODE_SIZE.height;
  const { width, height } = canvas?.getBoundingClientRect() ?? { width: 0, height: 0 };
  if (!width || !height) return void flow.setCenter(position.x + nodeWidth / 2, position.y + nodeHeight / 2, { zoom: 1, duration: 180 });
  const x = direction === 'vertical' ? width / 2 - position.x - nodeWidth / 2 : 32 - position.x;
  const y = direction === 'vertical' ? 32 - position.y : height / 2 - position.y - nodeHeight / 2;
  void flow.setViewport({ x, y, zoom: 1 }, { duration: 180 });
}

/**
 * How the workflow is laid out: 자동 정렬 (ELK over what is drawn, written to the draft: positions, the lines' routes
 * and the frames' boxes) and the direction it reads in (the URL's, kept with the definition when it is arranged).
 * Changing the direction arranges again; a clean tab that sees another tab save the other direction adopts it and
 * its positions together rather than writing a competing layout back.
 */
export function useWorkflowLayout({ workflowId, draft, selection, view, direction, marks, canvas }: {
  workflowId: string;
  draft: WorkflowDraftState;
  selection: WorkflowSelection;
  view: WorkflowView;
  direction: CanvasDirection;
  marks: MarkNames;
  canvas: RefObject<HTMLDivElement | null>;
}) {
  const flow = useReactFlow();
  const { workflow, current, setDraft } = draft;
  const { search, navigate } = selection;
  /** The node the view is put on: the open one, else the first. */
  const focusId = () => search.node ?? view.definitions[0]?.id;

  const arrange = async (layoutDirection: CanvasDirection = direction, keepReadable = true) => {
    if (!current || !view.drawn) return;
    try {
      const { next, sizes } = await arrangeFlow(flow, view.drawn.definition, layoutDirection, marks);
      const positions = new Map(next.nodes.map((node) => [node.id, node.position]));
      const routes = new Map(next.edges.map((edge) => [edge.id, edge.layout]));
      const boxes = new Map((next.groups ?? []).map((group) => [group.id, group.box]));
      setDraft((value) => ({ ...value, definition: { ...value.definition, direction: layoutDirection, nodes: value.definition.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })), edges: value.definition.edges.map((edge) => ({ ...edge, layout: routes.get(edge.id) })), groups: value.definition.groups?.map((group) => ({ ...group, box: boxes.get(group.id) ?? group.box })) } }));
      const id = focusId();
      const focusNode = next.nodes.find((node) => node.id === id);
      const focusSize = id ? sizes.get(id) : undefined;
      requestAnimationFrame(() => (keepReadable ? focusWorkflowNode(flow, id, layoutDirection, canvas.current, focusNode?.position, focusSize) : fitWhole(flow, 300)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '자동 정렬하지 못했습니다.');
    }
  };

  const changeDirection = (next: CanvasDirection) => {
    if (next === direction) return;
    void navigate({ search: (previous) => ({ ...previous, direction: next }) });
  };

  const previousDirection = useRef<CanvasDirection | undefined>(undefined);
  const previousWorkflowId = useRef<string | undefined>(undefined);
  const previousSavedVersion = useRef<number | undefined>(undefined);
  const adoptedDirection = useRef<CanvasDirection | undefined>(undefined);
  const arrangeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!current || !workflow.data) return;
    if (!search.direction) void navigate({ search: (previous) => ({ ...previous, direction }), replace: true });
    const initialWorkflowLoad = previousWorkflowId.current !== workflowId;
    const savedVersionChanged = !initialWorkflowLoad && previousSavedVersion.current !== workflow.data.version;
    const urlDirectionChanged = !initialWorkflowLoad && previousDirection.current !== direction;
    const serverDirection = workflow.data.definition.direction;
    const localEditInProgress = draft.editingLocally();
    if (initialWorkflowLoad) adoptedDirection.current = undefined;
    previousWorkflowId.current = workflowId;
    previousDirection.current = direction;
    previousSavedVersion.current = workflow.data.version;

    let shouldArrange = urlDirectionChanged || (initialWorkflowLoad && search.direction !== undefined && serverDirection !== direction);
    if (savedVersionChanged && !localEditInProgress && serverDirection) {
      // A clean tab adopts another tab's saved orientation and positions together; never repair
      // an SSE update by writing a competing layout back to the server.
      if (serverDirection !== direction) {
        adoptedDirection.current = serverDirection;
        shouldArrange = false;
        void navigate({ search: (value) => ({ ...value, direction: serverDirection }), replace: true });
      } else if (!urlDirectionChanged) {
        shouldArrange = false;
      }
    }
    if (adoptedDirection.current === direction) {
      adoptedDirection.current = undefined;
      shouldArrange = false;
      const id = focusId();
      const focusNode = current.definition.nodes.find((node) => node.id === id);
      const focusSize = id ? view.measured[id] : undefined;
      requestAnimationFrame(() => focusWorkflowNode(flow, id, direction, canvas.current, focusNode?.position, focusSize));
    }
    if (shouldArrange) {
      // Let React Flow measure the newly oriented cards before asking ELK to place them.
      if (arrangeTimer.current !== undefined) window.clearTimeout(arrangeTimer.current);
      arrangeTimer.current = window.setTimeout(() => {
        arrangeTimer.current = undefined;
        void arrange(direction, true);
      }, 100);
    }
    return () => {
      if (arrangeTimer.current !== undefined) window.clearTimeout(arrangeTimer.current);
      arrangeTimer.current = undefined;
    };
  }, [direction, current?.definition.direction, draft.draft, draft.save.isPending, search.direction, workflow.data?.version, workflow.data?.definition.direction, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { arrange, changeDirection, focusId };
}

export type WorkflowLayout = ReturnType<typeof useWorkflowLayout>;
