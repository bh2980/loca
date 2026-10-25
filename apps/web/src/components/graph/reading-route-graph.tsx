import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, CanvasSurface, EmptyDescription, EmptyHeader, EmptyTitle, Inline, Spinner, Overlay, EmptyState } from '@loca/ui';
import { useSize } from '@/hooks/use-size';
import { q } from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';
import { readingStageLayout } from './reading-stage-layout';
import { GraphCanvas, type GraphCanvasHandle, type NodeInfo, type Viewport } from './graph-canvas';

type RouteNode = { id: string; firstUnitId: string; unitIds: string[]; info: NodeInfo };
type RouteStage = { id: string; nodeIds: string[]; unitIds: string[]; parallel: boolean };

function readViewport(key: string): Viewport | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object') return undefined;
    const viewport = value as Partial<Viewport>;
    return Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.k) && viewport.k! > 0
      ? { x: viewport.x!, y: viewport.y!, k: viewport.k! }
      : undefined;
  } catch {
    return undefined;
  }
}

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
  const viewportKey = `tw.graph.reading-route.v6.${projectId}.${routeKey}.${direction}`;
  const initialViewport = readViewport(viewportKey);
  const previousEdit = useRef({ routeKey, edit });

  const routeNodes = useMemo(() => {
    const sourceNodes = new Map((graph.data?.nodes ?? []).map((node) => [node.id, node]));
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
          body,
        },
      }];
    });
  }, [graph.data, stages]);

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
            onViewportChange={(viewport) => {
              try { sessionStorage.setItem(viewportKey, JSON.stringify(viewport)); } catch { /* ignore unavailable storage */ }
            }}
            onSelect={(id) => onEdit(routeNodes.find((node) => node.id === id)?.firstUnitId || undefined)}
          />
        </>
      )}
    </CanvasSurface>
  );
}
