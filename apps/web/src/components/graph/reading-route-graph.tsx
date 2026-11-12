import { useEffect, useMemo, useRef } from 'react';
import { Button, CanvasOverlay, CanvasSurface, EmptyDescription, EmptyHeader, EmptyTitle, Inline, SegmentedControl, Spinner, Overlay, EmptyState } from '@loca/ui';
import { useSize } from '@/hooks/use-size';
import { q } from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';
import { GRAPH_SHOW_ITEMS, shownText, useGraphShow, type GraphShow } from '@/lib/graph-show';
import { useLines } from '@/lib/units';
import { readingStageLayout } from './reading-stage-layout';
import { GraphCanvas, type GraphCanvasHandle, type NodeInfo } from './graph-canvas';
import { useStoredViewport, viewportScope } from '@/lib/viewport';

type RouteNode = { id: string; firstUnitId: string; unitIds: string[]; info: NodeInfo };
type RouteStage = { id: string; nodeIds: string[]; unitIds: string[]; parallel: boolean };

/** The selected single route, grouped into source nodes and simultaneous stages. */
export function ReadingRouteGraph({ projectId, stages, routeKey, direction, onDirectionChange, edit, onEdit }: {
  projectId: string;
  stages: RouteStage[];
  routeKey: string;
  direction: 'vertical' | 'horizontal';
  onDirectionChange: (direction: 'vertical' | 'horizontal') => void;
  edit?: string;
  onEdit: (unitId?: string) => void;
}) {
  const graph = useQuery(q.graph(projectId, 'dialogue'));
  const [container, size] = useSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);
  // The view is remembered per route and direction (lib/viewport.ts); the canvas is mounted again when either changes.
  const viewportKey = viewportScope(routeKey, direction);
  const { initial: initialViewport, save: saveViewport } = useStoredViewport(projectId, 'route', viewportKey);
  const previousEdit = useRef({ routeKey, edit });
  // What the cards show of each line, the same setting as the main graph's cards.
  const [show, setShow] = useGraphShow();
  const sourceNodes = useMemo(() => new Map((graph.data?.nodes ?? []).map((node) => [node.id, node])), [graph.data]);
  const shownLines = useMemo(
    () => (show === 'source' ? undefined : stages.flatMap((stage) => stage.nodeIds.flatMap((id) => { const unitId = sourceNodes.get(id)?.unitId; return unitId ? [unitId] : []; }))),
    [show, stages, sourceNodes],
  );
  const lines = useLines(projectId, shownLines).byId;

  const routeNodes = useMemo(() => {
    const translationOf = (node: { unitId?: string | null }) => (shownLines && node.unitId ? lines.get(node.unitId)?.translation?.trim().slice(0, 120) || null : null);
    return stages.flatMap((stage): RouteNode[] => {
      const sources = stage.nodeIds.flatMap((id) => {
        const node = sourceNodes.get(id);
        return node ? [node] : [];
      });
      if (!sources.length) return [];
      const source = sources[0]!;
      const id = stage.parallel ? `route-stage:${stage.id}` : source.id;
      const count = stage.unitIds.length;
      const speaker = source.speaker ?? (count > 0 ? '지문·화면 문구' : '');
      const body = stage.parallel
        ? sources.map((node) => node.text ?? node.preview ?? node.label).filter(Boolean).join(' · ')
        : source.text ?? source.preview ?? source.label ?? '';
      const translation = stage.parallel
        ? sources.map(translationOf).filter(Boolean).join(' · ') || null
        : translationOf(source);
      return [{
        id,
        firstUnitId: stage.unitIds[0] ?? '',
        unitIds: stage.unitIds,
        info: {
          id,
          kind: source.kind ?? 'script',
          label: stage.parallel ? `함께 실행${count ? ` · ${count}줄` : ''}` : source.label ?? source.key,
          preview: stage.parallel ? body : source.preview,
          key: stage.parallel ? stage.id : source.key,
          title: stage.parallel ? `함께 실행${count ? ` · ${count}줄` : ''}` : count > 0 ? `${speaker}${count > 1 ? ` · ${count}줄` : ''}` : (source.label ?? source.key),
          // A line card shows what 원문·번역·둘 다 says; a card without lines keeps its label.
          ...(count > 0 ? shownText(show, body, translation) : { body }),
        },
      }];
    });
  }, [sourceNodes, stages, show, shownLines, lines]);

  const { nodes, edges } = useMemo(() => readingStageLayout(routeNodes.map((node) => node.id), direction), [routeNodes, direction]);
  const info = useMemo(() => new Map(routeNodes.map((node) => [node.id, node.info])), [routeNodes]);
  const selectedNodeId = routeNodes.find((node) => node.unitIds.includes(edit ?? ''))?.id;

  useEffect(() => {
    const previous = previousEdit.current;
    if (previous.routeKey !== routeKey) {
      previousEdit.current = { routeKey, edit };
      return;
    }
    if (previous.edit !== edit) {
      if (selectedNodeId) {
        previousEdit.current = { routeKey, edit };
        canvas.current?.focus(selectedNodeId);
      } else if (!edit) previousEdit.current = { routeKey, edit };
    }
  }, [routeKey, edit, selectedNodeId]);

  const retry = () => void graph.refetch();

  return (
    <CanvasSurface ref={container} grow={false} fill>
      {graph.isPending ? (
        <Overlay asChild><Inline justify="center" gap="condensed" variant="body" tone="muted" role="status">
          <Spinner /> 원문 그래프를 불러오는 중…
        </Inline></Overlay>
      ) : graph.isError ? (
        <EmptyState size="pane" overlay>
            <EmptyHeader>
              <EmptyTitle>대사 그래프를 불러오지 못했습니다</EmptyTitle>
              <EmptyDescription>{graph.error.message}</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={retry}>다시 시도</Button>
          </EmptyState>
      ) : !routeNodes.length ? (
        <EmptyState size="pane" overlay>
            <EmptyHeader><EmptyTitle>표시할 대사 노드가 없습니다</EmptyTitle></EmptyHeader>
          </EmptyState>
      ) : !size.width || !size.height ? (
        <Overlay role="status" aria-label="그래프 영역 크기를 계산하는 중" />
      ) : (
        <>
          <GraphCanvas
            key={viewportKey}
            handle={canvas}
            direction={direction}
            onDirectionChange={onDirectionChange}
            nodes={nodes}
            edges={edges}
            info={info}
            width={size.width}
            height={size.height}
            selectedId={selectedNodeId}
            initialViewport={initialViewport}
            initialFocusAlign={selectedNodeId ? 'center' : direction === 'horizontal' ? 'left' : 'top'}
            initialFocus={initialViewport ? undefined : selectedNodeId ?? routeNodes[0]?.id}
            onViewportChange={saveViewport}
            onSelect={(id) => onEdit(routeNodes.find((node) => node.id === id)?.firstUnitId || undefined)}
          />
          <CanvasOverlay tools={<SegmentedControl ariaLabel="카드에 보여 줄 것" value={show} onChange={(next) => setShow(next as GraphShow)} items={GRAPH_SHOW_ITEMS} />} />
        </>
      )}
    </CanvasSurface>
  );
}
