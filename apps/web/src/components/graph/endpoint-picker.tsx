import { useEffect, useMemo, useRef } from 'react';
import { Button, CanvasDirectionControl, CanvasSurface, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner } from '@loca/ui';
import { GraphCanvas, type GraphCanvasHandle, type NodeInfo, type Viewport } from '@/components/graph/graph-canvas';
import { useSize } from '@/hooks/use-size';
import { q } from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';

type Step = 'start' | 'end';

/** A graph-first endpoint picker; search only locates a node and never assigns it. */
export function EndpointPicker({ projectId, direction, step, start, end, section, initialSection, query, graphChain, graphFocus, onDirectionChange, onPick, onSectionChange, onQueryChange, onGraphNavigation }: {
  projectId: string;
  direction: 'vertical' | 'horizontal';
  step: Step;
  start?: string;
  end?: string;
  section?: string;
  initialSection?: string;
  query: string;
  graphChain?: string;
  graphFocus?: string;
  onDirectionChange: (direction: 'vertical' | 'horizontal') => void;
  onPick: (id: string, section?: string) => void;
  onSectionChange: (section: string | undefined) => void;
  onQueryChange: (query: string) => void;
  onGraphNavigation: (values: { chain?: string; focus?: string }) => void;
}) {
  const sections = useQuery(q.graphSections(projectId, direction));
  const sectionName = section ?? initialSection ?? sections.data?.[0]?.name;
  const graph = useQuery({ ...q.graph(projectId, 'dialogue', sectionName, direction), enabled: sections.isSuccess });
  const [sizeRef, size] = useSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);
  const focusId = graphFocus;
  const nodesById = useMemo(() => new Map((graph.data?.nodes ?? []).map((node) => [node.id, node])), [graph.data]);
  const chainByMember = useMemo(() => new Map((graph.data?.layout?.chains ?? []).flatMap((chain) => chain.nodeIds.map((id) => [id, chain.id] as const))), [graph.data]);
  const expandedChain = graphChain && (graph.data?.layout?.chains ?? []).some((chain) => chain.id === graphChain)
    ? graphChain
    : focusId ? chainByMember.get(focusId) : undefined;
  useEffect(() => {
    if (focusId) canvas.current?.focus(focusId);
  }, [focusId, expandedChain]);
  const endpointable = (id: string) => (nodesById.get(id)?.total ?? 0) > 0;
  const visibleId = (id: string) => chainByMember.get(id) ?? id;
  const initialContentId = useMemo(() => {
    const chosen = start ?? end;
    if (chosen && nodesById.has(chosen)) return visibleId(chosen);
    const layout = graph.data?.layout;
    if (!layout) return undefined;
    const candidates = new Set<string>();
    for (const node of graph.data?.nodes ?? []) if (node.total > 0) candidates.add(visibleId(node.id));
    const position = new Map(layout.nodes.map((node) => [node.id, node]));
    return [...candidates]
      .filter((id) => position.has(id))
      .sort((a, b) => {
        const left = position.get(a)!;
        const right = position.get(b)!;
        return direction === 'vertical' ? left.y - right.y || left.x - right.x : left.x - right.x || left.y - right.y;
      })[0];
  }, [graph.data, start, end, nodesById, chainByMember, direction]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = useMemo(() => {
    const map = new Map<string, NodeInfo>();
    for (const node of graph.data?.nodes ?? []) {
      map.set(node.id, {
        id: node.id,
        kind: node.kind,
        type: node.type,
        label: node.label,
        preview: node.preview,
        key: node.key,
        title: node.text ? `${node.speaker?.trim() ? `${node.speaker.trim()}: ` : ''}${node.total > 1 ? `${node.total}줄 · ` : ''}${node.key}` : node.label ?? node.key,
        body: node.text ?? node.preview,
      });
    }
    for (const portal of graph.data?.layout?.portals ?? []) map.set(portal.id, { id: portal.id, kind: 'portal', label: `${portal.direction === 'out' ? '→' : '←'} ${portal.section}`, preview: null, key: portal.id });
    for (const chain of graph.data?.layout?.chains ?? []) {
      const first = nodesById.get(chain.nodeIds[0]);
      const count = chain.nodeIds.reduce((sum, id) => sum + (nodesById.get(id)?.total ?? 0), 0);
      const spoken = chain.nodeIds.map((id) => nodesById.get(id)).find((node) => node?.total);
      map.set(chain.id, {
        id: chain.id,
        kind: 'chain',
        label: `이어진 대사 ${count}줄`,
        title: `이어진 대사 ${count}줄`,
        body: spoken ? `${spoken.speaker ? `${spoken.speaker}: ` : ''}${spoken.text ?? spoken.preview ?? ''}` : first?.label,
        preview: spoken?.preview ?? first?.preview ?? null,
        key: `${first?.key ?? ''} 외 ${chain.nodeIds.length - 1}개`,
      });
    }
    return map;
  }, [graph.data, nodesById]);

  const endpointMarkers = useMemo(() => {
    const markers = new Map<string, Array<Step>>();
    for (const [id, stepName] of [[start, 'start'], [end, 'end']] as const) {
      if (!id) continue;
      const shown = visibleId(id);
      markers.set(shown, [...(markers.get(shown) ?? []), stepName]);
    }
    return markers;
  }, [start, end, chainByMember]);

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return [];
    return (graph.data?.nodes ?? []).filter((node) => node.total > 0 && [node.key, node.label, node.text, node.preview, node.speaker].some((value) => value?.toLocaleLowerCase().includes(term))).slice(0, 8);
  }, [graph.data, query]);

  const locate = (id: string) => {
    const chain = (graph.data?.layout?.chains ?? []).find((item) => item.nodeIds.includes(id));
    if (chain) {
      onGraphNavigation({ chain: chain.id, focus: id });
    } else {
      onGraphNavigation({ chain: undefined, focus: id });
      requestAnimationFrame(() => canvas.current?.focus(id));
    }
  };

  const choose = (id: string | undefined) => {
    if (!id) return;
    const portal = graph.data?.layout?.portals?.find((item) => item.id === id);
    if (portal) {
      onSectionChange(portal.section);
      return;
    }
    if (id.startsWith('chain:')) {
      onGraphNavigation({ chain: id, focus: undefined });
      return;
    }
    if (endpointable(id)) onPick(id, sectionName);
  };

  const chain = graph.data?.layout?.chains?.find((item) => item.id === expandedChain);
  const expanded = useMemo(() => {
    if (!chain) return undefined;
    const firstLayout = graph.data?.layout?.nodes.find((node) => node.id === chain.id);
    const nodeWidth = Math.max(240, firstLayout?.width ?? 260);
    const nodeHeight = Math.max(72, firstLayout?.height ?? 76);
    const along = 148;
    const localNodes = chain.nodeIds.map((id, index) => ({
      id,
      x: direction === 'vertical' ? 0 : index * (nodeWidth + along),
      y: direction === 'vertical' ? index * (nodeHeight + along) : 0,
      width: nodeWidth,
      height: nodeHeight,
    }));
    const localEdges = chain.nodeIds.slice(0, -1).map((id, index) => {
      const from = localNodes[index];
      const to = localNodes[index + 1];
      const points = direction === 'vertical'
        ? [from.x + nodeWidth / 2, from.y + nodeHeight, from.x + nodeWidth / 2, from.y + nodeHeight + along / 2, to.x + nodeWidth / 2, to.y - along / 2, to.x + nodeWidth / 2, to.y]
        : [from.x + nodeWidth, from.y + nodeHeight / 2, from.x + nodeWidth + along / 2, from.y + nodeHeight / 2, to.x - along / 2, to.y + nodeHeight / 2, to.x, to.y + nodeHeight / 2];
      return { id: `ordered:${id}:${chain.nodeIds[index + 1]}`, from: id, to: chain.nodeIds[index + 1], points };
    });
    return { nodes: localNodes, edges: localEdges };
  }, [chain, graph.data, direction]);

  const currentLayout = graph.data?.layout;
  const viewportKey = `tw.graph.endpoint.${projectId}.${direction}.${sectionName ?? 'all'}.${expandedChain ?? 'source'}`;
  const initialViewport = useMemo(() => {
    if (focusId) return undefined;
    try {
      return JSON.parse(sessionStorage.getItem(viewportKey) ?? 'null') as Viewport | null ?? undefined;
    } catch {
      return undefined;
    }
  }, [viewportKey, focusId]);
  const saveViewport = (viewport: Viewport) => {
    try {
      sessionStorage.setItem(viewportKey, JSON.stringify(viewport));
    } catch {
      // Session storage may be unavailable in private browsing contexts.
    }
  };
  const displayedNodes = expanded ? expanded.nodes : currentLayout?.nodes ?? [];
  const displayedEdges = expanded ? expanded.edges : currentLayout?.edges ?? [];
  const firstEndpoint = expanded ? chain?.nodeIds.find(endpointable) : initialContentId;
  const focus = expanded ? (focusId && chain?.nodeIds.includes(focusId) ? focusId : firstEndpoint) : focusId ?? initialContentId;
  const localMarkers = useMemo(() => {
    if (!expanded || !chain) return endpointMarkers;
    const markers = new Map<string, Array<Step>>();
    for (const [id, marker] of [[start, 'start'], [end, 'end']] as const) {
      if (id && chain.nodeIds.includes(id)) markers.set(id, [...(markers.get(id) ?? []), marker]);
    }
    return markers;
  }, [expanded, chain, endpointMarkers, start, end]);

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" aria-label="원본 그래프에서 경로 끝점 고르기">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{step === 'start' ? '시작 대사 선택' : '끝 대사 선택'}</span>
        {sections.data && sections.data.length > 1 && (
          <Select value={sectionName} onValueChange={(value) => onSectionChange(value)}>
            <SelectTrigger className="w-56 max-w-full" aria-label="장 선택"><SelectValue placeholder="장 선택" /></SelectTrigger>
            <SelectContent>{sections.data.map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {expandedChain && <Button variant="ghost" onClick={() => onGraphNavigation({ chain: undefined, focus: undefined })}>전체 그래프</Button>}
        <CanvasDirectionControl direction={direction} onDirectionChange={onDirectionChange} />
      </div>
      <div className="grid shrink-0 gap-1 border-b border-border px-3 py-2">
        <Input aria-label="현재 장 그래프에서 대사 찾기" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="현재 장에서 화자·원문·키로 찾기" />
        {results.length > 0 && (
          <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-card" role="group" aria-label="그래프 검색 결과">
            {results.map((node) => <Button key={node.id} type="button" variant="ghost" className="flex h-auto w-full min-w-0 flex-col items-start rounded-none border-b border-border px-2 py-1.5 text-left text-sm last:border-b-0" onClick={() => locate(node.id)}><span className="w-full truncate font-medium">{node.speaker ? `${node.speaker}: ` : ''}{node.text ?? node.label ?? node.key}</span><span className="text-xs text-muted-foreground">{node.key} · 그래프에서 위치 찾기</span></Button>)}
          </div>
        )}
      </div>
      {sections.isError ? (
        <Empty className="flex-1"><EmptyHeader><EmptyTitle>그래프 장 목록을 불러오지 못했습니다</EmptyTitle><EmptyDescription>{sections.error.message}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => void sections.refetch()}>다시 시도</Button></Empty>
      ) : sections.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> 그래프 장을 불러오는 중…</div>
      ) : graph.isError ? (
        <Empty className="flex-1"><EmptyHeader><EmptyTitle>원본 그래프를 불러오지 못했습니다</EmptyTitle><EmptyDescription>{graph.error.message}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => void graph.refetch()}>다시 시도</Button></Empty>
      ) : graph.data?.status === 'error' || graph.data?.status === 'failed' || graph.data?.status === 'missing' ? (
        <Empty className="flex-1"><EmptyHeader><EmptyTitle>원본 그래프를 준비하지 못했습니다</EmptyTitle><EmptyDescription>{graph.data.error ?? '그래프 레이아웃에 실패했습니다.'}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => void graph.refetch()}>다시 시도</Button></Empty>
      ) : graph.isPending || graph.data?.status !== 'ready' || !currentLayout ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> 원본 그래프를 불러오는 중…</div>
      ) : !currentLayout.nodes.length ? (
        <Empty className="flex-1"><EmptyHeader><EmptyTitle>이 장에 대사가 없습니다</EmptyTitle></EmptyHeader></Empty>
      ) : (
        <CanvasSurface ref={sizeRef} className="min-h-0 min-w-0 flex-1" data-testid="endpoint-source-graph">
          <GraphCanvas
            key={`${direction}:${sectionName ?? 'all'}:${expandedChain ?? 'source'}:${focusId ?? ''}`}
            nodes={displayedNodes}
            edges={displayedEdges}
            looseEdges={expanded ? undefined : currentLayout.looseEdges}
            regions={expanded ? [] : currentLayout.regions}
            direction={direction}
            info={info}
            width={size.width}
            height={size.height}
            selectedId={expanded ? (focusId ?? undefined) : (expandedChain ?? focusId ?? undefined)}
            endpointMarkers={localMarkers}
            initialFocus={focus}
            initialFocusAlign={direction === 'vertical' ? 'top' : 'left'}
            initialViewport={initialViewport ?? undefined}
            onViewportChange={saveViewport}
            handle={canvas}
            onOpen={() => choose(focusId ?? undefined)}
            onSelect={choose}
          />
        </CanvasSurface>
      )}
    </section>
  );
}
