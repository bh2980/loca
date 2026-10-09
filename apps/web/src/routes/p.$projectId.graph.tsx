import { useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Maximize, Minus, Plus, Search } from 'lucide-react';
import { GraphCanvas, type GraphCanvasHandle, type NodeInfo, type Viewport } from '@/components/graph/graph-canvas';
import { DialogueNodeDetail, SceneNodeDetail } from '@/components/graph/node-detail';
import { KIND_LABEL } from '@/components/graph/shapes';
import { TypeLegend } from '@/components/graph/type-legend';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSize } from '@/hooks/use-size';
import { q } from '@/lib/queries';

type Scope = 'scene' | 'dialogue';
interface GraphSearch {
  scope: Scope;
  node?: string;
  scene?: string;
  /** Highlight one node type (original class name, or "kind:<kind>"). */
  type?: string;
}

export const Route = createFileRoute('/p/$projectId/graph')({
  validateSearch: (raw: Record<string, unknown>): GraphSearch => ({
    scope: raw.scope === 'dialogue' ? 'dialogue' : 'scene',
    node: typeof raw.node === 'string' ? raw.node : undefined,
    scene: typeof raw.scene === 'string' ? raw.scene : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
  }),
  component: GraphPage,
});

/** Viewport is a per-tab preference: kept in sessionStorage, never in history, so panning adds no entries. */
const viewportKey = (projectId: string, scope: Scope, scene?: string) => `tw.graph.view.${projectId}.${scope}.${scene ?? ''}`;
const readViewport = (key: string): Viewport | undefined => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
};

function GraphPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const graph = useQuery(q.graph(projectId, search.scope));
  const [container, size] = useSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);
  const [find, setFind] = useState('');

  const info = useMemo(() => {
    const types = graph.data?.nodeTypes ?? {};
    // Control nodes are labelled by what the game's node class means, not by its raw name.
    return new Map<string, NodeInfo>((graph.data?.nodes ?? []).map((node) => [node.id, { ...node, label: node.label ?? (node.type ? (types[node.type]?.label ?? node.type) : null) }]));
  }, [graph.data]);
  const highlight = useMemo(() => {
    if (!graph.data) return undefined;
    if (search.type) return new Set(graph.data.nodes.filter((node) => (node.type ?? `kind:${node.kind}`) === search.type).map((node) => node.id));
    if (search.scope !== 'dialogue' || !search.scene) return undefined;
    return new Set(graph.data.nodes.filter((node) => node.groupId === search.scene).map((node) => node.id));
  }, [graph.data, search.scope, search.scene, search.type]);
  const matches = useMemo(() => {
    const text = find.trim().toLowerCase();
    if (!text || !graph.data) return [];
    return graph.data.nodes.filter((node) => [node.key, node.label, node.preview].some((value) => value?.toLowerCase().includes(text))).slice(0, 50);
  }, [find, graph.data]);

  const key = viewportKey(projectId, search.scope, search.scene);
  const select = (id: string | undefined) => void navigate({ search: (previous) => ({ ...previous, node: id }), replace: true });
  const layout = graph.data?.layout;

  return (
    <Page
      title="그래프"
      actions={
        <ToggleGroup type="single" variant="outline" size="sm" value={search.scope} onValueChange={(value) => value && void navigate({ search: { scope: value as Scope } })}>
          <ToggleGroupItem value="scene">장면 그래프</ToggleGroupItem>
          <ToggleGroupItem value="dialogue">대사 그래프</ToggleGroupItem>
        </ToggleGroup>
      }
      flush
    >
      <div className="absolute inset-0 flex">
        <div ref={container} className="relative min-w-0 flex-1 bg-[radial-gradient(var(--graph-grid)_1px,transparent_1px)] [background-size:20px_20px]">
          {graph.data?.status === 'ready' && layout && size.width > 0 && (
            <GraphCanvas
              key={`${search.scope}:${search.scene ?? ''}`}
              handle={canvas}
              nodes={layout.nodes}
              regions={layout.regions}
              edges={layout.edges}
              info={info}
              width={size.width}
              height={size.height}
              selectedId={search.node}
              highlight={highlight}
              initialViewport={readViewport(key)}
              onViewportChange={(viewport) => sessionStorage.setItem(key, JSON.stringify(viewport))}
              onSelect={select}
            />
          )}
          {(graph.isPending || graph.data?.status === 'pending') && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner /> 그래프 배치를 계산하는 중…
            </div>
          )}
          {graph.data?.status === 'failed' && <p className="p-6 text-sm text-destructive">배치에 실패했습니다: {graph.data.error}</p>}
          {graph.data?.status === 'missing' || (graph.data?.status === 'ready' && !layout?.nodes.length) ? (
            <Empty className="absolute inset-0">
              <EmptyHeader>
                <EmptyTitle>그래프가 없습니다</EmptyTitle>
                <EmptyDescription>가져온 표준 파일에 그래프 정보가 없거나 장면 사이 연결이 없습니다.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {layout && (
            <>
              <div className="absolute top-3 left-3 flex w-[28rem] items-start gap-2">
                <div className="min-w-0 flex-1">
                <InputGroup className="bg-background shadow-sm">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput value={find} onChange={(event) => setFind(event.target.value)} placeholder="노드 찾기 (키·라벨·첫 대사)" />
                </InputGroup>
                {matches.length > 0 && (
                  <ul className="mt-1 max-h-72 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
                    {matches.map((node) => (
                      <li key={node.id}>
                        <button
                          className="w-full truncate rounded px-2 py-1 text-left hover:bg-muted"
                          onClick={() => {
                            select(node.id);
                            canvas.current?.focus(node.id);
                            setFind('');
                          }}
                        >
                          <span className="text-xs text-muted-foreground">{KIND_LABEL[node.kind] ?? node.kind}</span> {node.preview ?? node.label ?? node.key}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                </div>
                {search.scope === 'dialogue' && (
                  <TypeLegend
                    nodes={graph.data!.nodes}
                    nodeTypes={graph.data!.nodeTypes}
                    active={search.type}
                    onPick={(type) => void navigate({ search: (previous) => ({ ...previous, type }), replace: true })}
                  />
                )}
              </div>
              <div className="absolute right-3 bottom-3 flex flex-col gap-1">
                <Button size="icon" variant="outline" className="size-8 bg-background" aria-label="확대" onClick={() => canvas.current?.zoomBy(1.4)}>
                  <Plus />
                </Button>
                <Button size="icon" variant="outline" className="size-8 bg-background" aria-label="축소" onClick={() => canvas.current?.zoomBy(0.7)}>
                  <Minus />
                </Button>
                <Button size="icon" variant="outline" className="size-8 bg-background" aria-label="전체 맞춤" onClick={() => canvas.current?.fit()}>
                  <Maximize />
                </Button>
              </div>
              <p className="absolute top-3 right-3 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground tabular-nums shadow-sm">
                노드 {layout.nodes.length.toLocaleString()} · 연결 {layout.edges.length.toLocaleString()}
                {highlight && ` · 강조 ${highlight.size.toLocaleString()}`}
              </p>
            </>
          )}
        </div>
        {search.node && (
          <div className="w-[380px] shrink-0 border-l bg-background">
            {search.scope === 'scene' ? (
              <SceneNodeDetail projectId={projectId} groupId={search.node} onClose={() => select(undefined)} />
            ) : (
              <DialogueNodeDetail
                projectId={projectId}
                nodeId={search.node}
                onClose={() => select(undefined)}
                onSelect={(id) => {
                  select(id);
                  canvas.current?.focus(id);
                }}
              />
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
