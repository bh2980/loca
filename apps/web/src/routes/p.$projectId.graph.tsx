import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Maximize, Minus, Plus } from 'lucide-react';
import { GraphCanvas, type GraphCanvasHandle, type NodeInfo, type Viewport } from '@/components/graph/graph-canvas';
import { LINE_CARD_WIDTH, LineCard } from '@/components/graph/line-card';
import { FlowPane, SceneNodeDetail } from '@/components/graph/node-detail';
import { KIND_LABEL } from '@/components/graph/shapes';
import { TypeLegend } from '@/components/graph/type-legend';
import { HeaderActions, Page } from '@/components/page';
import { SearchInput, SplitPane, PaneHeader, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, ScrollArea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, Switch, ViewSwitch } from '@loca/ui';
import { useSize } from '@/hooks/use-size';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { PathMode } from '@/components/graph/path-mode';
import { cn } from '@/lib/utils';

type Scope = 'scene' | 'dialogue';
interface GraphSearch {
  scope: Scope;
  /** 길 따라 보기: the slice of the dialogue graph for the stored choices (docs/DESIGN.md J2c). */
  view?: 'path';
  /** 길 따라 보기: the overview node the window is around (default: the first). */
  at?: string;
  /** 길 따라 보기: draw the whole overview instead of the window. */
  all?: 1;
  node?: string;
  scene?: string;
  /** Dialogue graph section (chapter, act, day…); "all" draws the whole graph on one sheet. Absent = the first section. */
  section?: string;
  /** Highlight one node type (original class name, or "kind:<kind>"). */
  type?: string;
  /** Also draw scene links hidden by the simplification (reachable through other scenes). */
  links?: 'all';
  /** Arrived from a line ("그래프에서 보기"): open centred on `node`, then forget it. */
  jump?: true;
  /** A stored view (made in the chat) whose nodes are highlighted. */
  mark?: string;
  /** The line open in the translation card beside its node (dialogue graph). */
  edit?: string;
  /** Node finder text (matches are listed under the box). */
  q?: string;
}

export const Route = createFileRoute('/p/$projectId/graph')({
  validateSearch: (raw: Record<string, unknown>): GraphSearch => ({
    scope: raw.scope === 'dialogue' || raw.view === 'path' ? 'dialogue' : 'scene',
    view: raw.view === 'path' ? 'path' : undefined,
    at: raw.view === 'path' && typeof raw.at === 'string' && raw.at ? raw.at : undefined,
    all: raw.view === 'path' && (raw.all === 1 || raw.all === '1' || raw.all === true) ? 1 : undefined,
    node: typeof raw.node === 'string' ? raw.node : undefined,
    scene: typeof raw.scene === 'string' ? raw.scene : undefined,
    section: typeof raw.section === 'string' && raw.section ? raw.section : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    links: raw.links === 'all' ? 'all' : undefined,
    mark: typeof raw.mark === 'string' && raw.mark ? raw.mark : undefined,
    jump: raw.jump === true || raw.jump === 'true' ? true : undefined,
    edit: typeof raw.edit === 'string' && raw.edit ? raw.edit : undefined,
    q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
  }),
  component: GraphRoute,
});

/** Viewport is a per-tab preference: kept in sessionStorage, never in history, so panning adds no entries. */
const viewportKey = (projectId: string, scope: Scope, scene?: string, section?: string) => `tw.graph.view.${projectId}.${scope}.${section ?? ''}.${scene ?? ''}`;
const readViewport = (key: string): Viewport | undefined => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
};


const GRAPH_MODES = ['scene', 'dialogue', 'path'] as const;
/** The graph's three modes in one sleek segment control */
function ModeToggle({ value, onChange }: { value: (typeof GRAPH_MODES)[number]; onChange: (value: (typeof GRAPH_MODES)[number]) => void }) {
  return <ViewSwitch label="그래프 보기" value={value} onChange={(next) => onChange(next as (typeof GRAPH_MODES)[number])} items={[
    { value: 'scene', label: '장면' }, { value: 'dialogue', label: '대사' }, { value: 'path', label: '경로' },
  ]} />;
}

function GraphRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (search.view !== 'path') return <GraphPage />;
  return (
    <PathMode
      projectId={projectId}
      toggle={<ModeToggle value="path" onChange={(mode) => void navigate({ search: mode === 'path' ? { scope: 'dialogue', view: 'path' } : { scope: mode } })} />}
      node={search.node}
      edit={search.edit}
      at={search.at}
      all={search.all === 1}
      onSelect={(node, focus) => void navigate({ search: (previous) => ({ ...previous, node, ...(node && focus && { at: node }) }), replace: true })}
      onEdit={(edit) => void navigate({ search: (previous) => ({ ...previous, edit }), replace: true })}
      onMove={(at) => void navigate({ search: (previous) => ({ ...previous, at }), replace: true })}
      onAll={(all) => void navigate({ search: (previous) => ({ ...previous, all: all ? 1 : undefined }) })}
    />
  );
}

function GraphPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const dialogue = search.scope === 'dialogue';
  // The section list is small and separate: the default section (the first, or the one holding
  // `scene`) is known before any layout is loaded.
  const sectionList = useQuery({ ...q.graphSections(projectId), enabled: dialogue });
  const sections = dialogue ? (sectionList.data ?? []) : [];
  const chosen = !dialogue || search.section === 'all' ? undefined : search.section ?? (sections.length > 1 ? (sections.find((section) => section.groupIds.includes(search.scene ?? ''))?.name ?? sections[0].name) : undefined);
  const graph = useQuery({ ...q.graph(projectId, search.scope, chosen), enabled: !dialogue || !!search.section || sectionList.isSuccess });
  // A view laid out on its own (the chat's show_graph, mode "only").
  const viewId = chosen?.startsWith('view:') ? chosen.slice('view:'.length) : undefined;
  const viewInfo = useQuery({ ...q.graphView(projectId, viewId ?? ''), enabled: !!viewId });
  const view = viewId && graph.data?.layout?.view ? { ...graph.data.layout.view, label: viewInfo.data?.label ?? graph.data.layout.view.label } : undefined;
  // Nodes the chat asked to highlight (show_graph, mode "mark"); the canvas waits for them so it opens on them.
  const mark = useQuery({ ...q.graphView(projectId, search.mark ?? ''), enabled: dialogue && !!search.mark });
  const marking = dialogue && !!search.mark && mark.isPending;
  const [container, size] = useSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);
  const find = search.q ?? '';
  const setFind = (q: string | undefined) => void navigate({ search: (previous) => ({ ...previous, q }), replace: true });

  const info = useMemo(() => {
    const types = graph.data?.nodeTypes ?? {};
    // Control nodes are labelled by what the game's node class means, not by its raw name.
    // A line card leads with who speaks and shows the line; the node key is in the side pane.
    const lineCard = (node: { speaker?: string | null; text?: string | null; total?: number }) =>
      node.text ? { title: `${node.speaker ?? '지문·화면 문구'}${(node.total ?? 0) > 1 ? ` · ${node.total}줄` : ''}`, body: node.text } : {};
    const map = new Map<string, NodeInfo>(
      (graph.data?.nodes ?? []).map((node) => [node.id, { ...node, label: node.label ?? (node.type ? (types[node.type]?.label ?? node.type) : null), ...(node.kind === 'script' && lineCard(node)), ...(node.kind === 'choice' && { title: `▶ ${node.text ?? ''} 고르면`, body: node.text }) }]),
    );
    const totals = new Map((graph.data?.nodes ?? []).map((node) => [node.id, node] as const));
    // Stand-ins for lines that continue in (or come from) another section.
    for (const portal of graph.data?.layout?.portals ?? []) map.set(portal.id, { id: portal.id, kind: 'portal', label: `${portal.direction === 'out' ? '→' : '←'} ${portal.section}`, preview: null, key: portal.id });
    // A folded straight run reads as its first line, with how many nodes it holds.
    // A folded straight run of lines: how many lines it holds, and its first spoken line.
    for (const chain of graph.data?.layout?.chains ?? []) {
      const first = map.get(chain.nodeIds[0]);
      const spoken = chain.nodeIds.map((id) => totals.get(id)).find((node) => node?.text);
      const lines = chain.nodeIds.reduce((sum, id) => sum + (totals.get(id)?.total ?? 0), 0);
      map.set(chain.id, {
        id: chain.id,
        kind: 'chain',
        label: `이어진 대사 ${lines}줄`,
        title: lines ? `이어진 대사 ${lines}줄` : `이어진 노드 ${chain.nodeIds.length}개`,
        body: spoken ? `${spoken.speaker ? `${spoken.speaker}: ` : ''}${spoken.text}` : (first?.label ?? null),
        preview: spoken?.preview ?? first?.preview ?? first?.label ?? null,
        key: `${first?.key ?? ''} 외 ${chain.nodeIds.length - 1}개`,
      });
    }
    return map;
  }, [graph.data]);
  // Nodes inside a folded run are shown, selected and highlighted through their block.
  const chainOf = useMemo(() => new Map((graph.data?.layout?.chains ?? []).flatMap((chain) => chain.nodeIds.map((id) => [id, chain.id] as const))), [graph.data]);
  const shown = (id: string) => chainOf.get(id) ?? id;
  const portals = useMemo(() => new Map((graph.data?.layout?.portals ?? []).map((portal) => [portal.id, portal])), [graph.data]);
  const highlight = useMemo(() => {
    const picked = pickHighlight();
    if (!picked) return undefined;
    for (const id of [...picked]) if (chainOf.has(id)) picked.add(chainOf.get(id)!);
    return picked;
  }, [graph.data, search.scope, search.scene, search.type, search.mark, mark.data, dialogue, chainOf]); // eslint-disable-line react-hooks/exhaustive-deps
  function pickHighlight() {
    if (!graph.data) return undefined;
    if (dialogue && search.mark && mark.data) return new Set(mark.data.nodeIds);
    if (search.type) return new Set(graph.data.nodes.filter((node) => (node.type ?? `kind:${node.kind}`) === search.type).map((node) => node.id));
    if (search.scope !== 'dialogue' || !search.scene) return undefined;
    return new Set(graph.data.nodes.filter((node) => node.groupId === search.scene).map((node) => node.id));
  }
  const matches = useMemo(() => {
    const text = find.trim().toLowerCase();
    if (!text || !graph.data) return [];
    return graph.data.nodes.filter((node) => [node.key, node.label, node.preview].some((value) => value?.toLowerCase().includes(text))).slice(0, 50);
  }, [find, graph.data]);

  const key = viewportKey(projectId, search.scope, search.scene ?? (dialogue && search.mark ? `mark:${search.mark}` : undefined), dialogue ? (chosen ?? 'all') : undefined);
  const select = (id: string | undefined) => {
    const target = id ? portals.get(id) : undefined;
    // A portal is navigation to the section it stands for (or, in a view of chosen scenes, to the
    // scene the lines continue in, shown in its own section), not a node to inspect.
    if (target?.groupId) void navigate({ search: { scope: 'dialogue', scene: target.groupId } });
    else if (target) void navigate({ search: (previous) => ({ ...previous, section: target.section, node: undefined, scene: undefined }) });
    else {
      // While the translation card is open, picking another node keeps translating there (its first
      // line without a translation); clicking empty canvas or Esc ends it.
      if (id && search.edit && search.node && shown(id) === anchorOf(search.node)) return;
      if (id && search.edit && dialogue) setFollow({ node: id, direction: 0 });
      void navigate({ search: (previous) => ({ ...previous, node: id, edit: undefined }), replace: true });
    }
  };
  const layout = graph.data?.layout;
  // Arriving from a line: the canvas opens centred on its node (inside a folded run, the run; a
  // choice, what it leads to), then `jump` is forgotten. The line's scene only picks the section; it
  // is not highlighted (the rest of the graph would dim while one only wants to read around the line).
  const canvasShown = graph.data?.status === 'ready' && !!layout && size.width > 0 && !marking;
  useEffect(() => {
    if (!search.jump || !search.node || !layout) return;
    if (search.scene) return void navigate({ search: (previous) => ({ ...previous, section: chosen, scene: undefined }), replace: true });
    if (canvasShown) void navigate({ search: (previous) => ({ ...previous, jump: undefined }), replace: true });
  }, [search.jump, search.node, search.scene, layout, canvasShown]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * What the pane reads for a selection: a folded run's nodes; a choice (on its edge) followed by
   * the lines it leads to, so picking a choice shows what happens after it; else the node.
   */
  const flowOf = (id: string) => {
    const run = (target: string) => layout?.chains?.find((chain) => chain.id === target)?.nodeIds ?? [target];
    if (id.startsWith('chain:')) return run(id);
    // A node inside a folded run reads with the whole run (its own lines marked).
    if (chainOf.has(id)) return run(chainOf.get(id)!);
    const way = layout?.edges.find((edge) => edge.via === id);
    return way ? [id, ...run(way.to)] : [id];
  };
  /**
   * The way into a selection, nearest last: the labels (choices, conditions) on the single path
   * back to the previous meeting point. `merged`: lines arrive here from several ways.
   */
  const wayInto = (id: string) => {
    const edges = layout?.edges ?? [];
    const via = edges.find((edge) => edge.via === id);
    // A choice is the pane's first row already; the way starts before it.
    const labels: { text: string; choice: boolean }[] = [];
    let at = via ? via.from : shown(id);
    for (let step = 0; step < 40 && labels.length < 3; step++) {
      const into = edges.filter((edge) => edge.to === at);
      if (into.length !== 1) return { labels: labels.reverse(), merged: into.length > 1 };
      if (into[0].label) labels.push({ text: into[0].label, choice: Boolean(into[0].via) });
      at = into[0].from;
    }
    return { labels: labels.reverse(), merged: false };
  };
  // ── translating in the graph: the card beside the node ──────────
  // The selection's lines in order (choices included: their text is translated too).
  const flowIds = dialogue && search.node && layout ? flowOf(search.node) : [];
  const flowNodes = useQueries({ queries: flowIds.map((id) => q.graphNode(id)) });
  const flowReady = flowIds.length > 0 && flowNodes.every((result) => result.data);
  const flowLines = flowNodes.flatMap((result) => (result.data ? result.data.units.map((unit) => ({ unitId: unit.id, nodeId: result.data.id, choice: result.data.kind === 'choice' })) : []));
  const editAt = flowLines.findIndex((line) => line.unitId === search.edit);
  // Where the card stands: the node's box (a folded run's block); a choice has no box of its own, so it stands by what it leads to.
  const anchorOf = (nodeId: string) => shown(layout?.edges.find((edge) => edge.via === nodeId)?.to ?? nodeId);
  const anchorId = editAt >= 0 ? anchorOf(flowLines[editAt].nodeId) : undefined;
  // The line open in the translation card (the selected node reports itself from its pane).
  const editUnit = useQuery({ ...q.unit(search.edit ?? ''), enabled: !!search.edit });
  useReportView('graph-line', [editUnit.data && { kind: '대사', id: editUnit.data.id, label: `${editUnit.data.key} · ${editUnit.data.source.slice(0, 40)}` }]);
  const edit = (unitId: string | undefined) => void navigate({ search: (previous) => ({ ...previous, edit: unitId }), replace: true });
  // After stepping past the selection's end, the next selection opens on its first (or last) line
  // once its lines have arrived.
  // direction 0: a node picked while translating opens on its first line without a translation.
  const [follow, setFollow] = useState<{ node: string; direction: 1 | -1 | 0 }>();
  useEffect(() => {
    if (!follow || follow.node !== search.node || !flowReady) return;
    setFollow(undefined);
    const untranslated = flowNodes.flatMap((result) => result.data?.units ?? []).find((unit) => !unit.translation);
    const line = follow.direction === 0 ? (flowLines.find((item) => item.unitId === untranslated?.id) ?? flowLines[0]) : follow.direction === 1 ? flowLines[0] : flowLines[flowLines.length - 1];
    if (line) edit(line.unitId);
  }, [follow, search.node, flowReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineTotals = useMemo(() => new Map((graph.data?.nodes ?? []).map((node) => [node.id, node.total ?? 0] as const)), [graph.data]);
  /** The selection one step along the flow from `from`, or why there is none (a fork, a merge, the end). */
  const neighbour = (from: string, direction: 1 | -1): { target: string } | { stop: string } => {
    const edges = layout?.edges ?? [];
    const via = edges.find((edge) => edge.via === from);
    if (direction === 1) {
      const out = edges.filter((edge) => edge.from === (via ? shown(via.to) : shown(from)));
      if (out.length !== 1) return { stop: out.length ? `여기서 길이 ${out.length}갈래로 나뉩니다. 그래프에서 이어질 쪽을 고르세요.` : '이 흐름의 마지막 대사입니다.' };
      return { target: out[0].via ?? out[0].to };
    }
    if (via) return { target: via.from };
    const into = edges.filter((edge) => edge.to === shown(from));
    if (into.length !== 1) return { stop: into.length ? `여러 길(${into.length}갈래)이 이리로 모입니다. 그래프에서 앞 노드를 고르세요.` : '이 흐름의 첫 대사입니다.' };
    return { target: into[0].from };
  };
  /**
   * ⌥↓/⌥↑ in the card: the next line of the selection, then on along the flow while it does not
   * fork. Nodes without lines (conditions) are passed through; where the way stops, the card stays.
   */
  const step = (direction: 1 | -1) => {
    const next = flowLines[editAt + direction];
    if (editAt >= 0 && next) return edit(next.unitId);
    if (!search.node || !layout) return;
    let at = search.node;
    for (let hops = 0; hops < 50; hops++) {
      const found = neighbour(at, direction);
      if ('stop' in found) return void toast(found.stop);
      if (portals.has(found.target)) return void toast('다음 대사는 다른 구역에 이어집니다. 그래프의 이름표를 눌러 넘어가세요.');
      at = found.target;
      if (flowOf(at).some((id) => (lineTotals.get(id) ?? 0) > 0)) break;
    }
    const target = at;
    setFollow({ node: target, direction });
    canvas.current?.reveal(anchorOf(target), LINE_CARD_WIDTH);
    void navigate({ search: (previous) => ({ ...previous, node: target, edit: undefined }), replace: true });
  };
  // The lines either side are loaded ahead, so stepping shows them at once.
  const queryClient = useQueryClient();
  useEffect(() => {
    for (const line of [flowLines[editAt - 1], flowLines[editAt + 1]]) if (line && editAt >= 0) void queryClient.prefetchQuery(q.unit(line.unitId));
  }, [search.edit, flowReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // The card opens beside its node with room for itself; the graph pans only when it has to.
  useEffect(() => {
    if (anchorId) canvas.current?.reveal(anchorId, LINE_CARD_WIDTH);
  }, [anchorId, search.edit]);
  // Enter on the canvas, like the pane's 번역하기: the first line without a translation, else the first.
  const startLine = () => {
    const units = flowNodes.flatMap((result) => result.data?.units ?? []);
    const line = units.find((unit) => !unit.translation) ?? units[0];
    if (line) edit(line.id);
  };

  const hubs = useMemo(() => new Map((search.scope === 'scene' ? (layout?.hubs ?? []) : []).map((hub) => [hub.id, hub])), [layout, search.scope]);
  const looseEdges = layout?.looseEdges;
  const hidden = search.scope === 'scene' ? (layout?.hiddenEdges ?? []) : [];
  // Hidden links are drawn as straight lines between the laid-out boxes (bottom centre → top centre).
  const edges = useMemo(() => {
    if (!layout || search.links !== 'all' || !hidden.length) return layout?.edges ?? [];
    const box = new Map(layout.nodes.map((node) => [node.id, node]));
    const extra = hidden.flatMap((edge, i) => {
      const a = box.get(edge.from);
      const b = box.get(edge.to);
      return a && b ? [{ id: `h${i}`, from: edge.from, to: edge.to, points: [a.x + a.width / 2, a.y + a.height, b.x + b.width / 2, b.y] }] : [];
    });
    return [...layout.edges, ...extra];
  }, [layout, hidden, search.links]);

  return (
    <Page title="그래프" flush>
      <HeaderActions>
        <ModeToggle value={search.scope} onChange={(mode) => void navigate({ search: mode === 'path' ? { scope: 'dialogue', view: 'path' } : { scope: mode } })} />
          {dialogue && (sections.length > 1 || view) && (
            <Select
              value={chosen ?? 'all'}
              onValueChange={(value) => void navigate({ search: (previous) => ({ ...previous, section: value, node: undefined }), replace: true })}
            >
              <SelectTrigger size="sm" className="w-52" aria-label="구역">
                <span className="text-muted-foreground">구역</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 (한 장)</SelectItem>
                {view && chosen && <SelectItem value={chosen}>보기: {view.label || `노드 ${view.nodes.toLocaleString()}개`}</SelectItem>}
                {sections.map((section) => (
                  <SelectItem key={section.name} value={section.name}>
                    {section.name} <span className="text-muted-foreground">· {section.nodes.toLocaleString()}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
      </HeaderActions>
      <SplitPane
        id="graph"
        defaultWidth="380px"
        className="absolute inset-0"
        pane={
          search.node && (
            <div className="h-full bg-background">
              {search.scope === 'scene' && hubs.has(search.node) ? (
                <aside className="flex h-full flex-col text-sm">
                  <PaneHeader kicker="장면 그래프" title="연결점" onClose={() => select(undefined)} />
                  <p className="px-4 py-3 text-muted-foreground">
                    장면에 속하지 않는 노드 {hubs.get(search.node)!.nodes.toLocaleString()}개가 장면 {hubs.get(search.node)!.scenes.toLocaleString()}개를 잇습니다. 대사 그래프에서 파생한 연결입니다.
                  </p>
                </aside>
              ) : search.scope === 'dialogue' ? (
                // One pane for a node and a folded run alike: their lines, read in order.
                <FlowPane
                  key={search.node}
                  projectId={projectId}
                  nodeIds={flowOf(search.node)}
                  way={wayInto(search.node)}
                  marked={chainOf.has(search.node) ? search.node : undefined}
                  editing={search.edit}
                  onEdit={edit}
                  title={info.get(chainOf.get(search.node) ?? search.node)?.title ?? info.get(chainOf.get(search.node) ?? search.node)?.label ?? ''}
                  onClose={() => select(undefined)}
                />
              ) : search.scope === 'scene' ? (
                <SceneNodeDetail projectId={projectId} groupId={search.node} onClose={() => select(undefined)} />
              ) : null}
            </div>
          )
        }
      >
        <div ref={container} className="relative min-w-0 flex-1 bg-[radial-gradient(var(--graph-grid)_1px,transparent_1px)] [background-size:20px_20px]">
          {canvasShown && layout && (
            <GraphCanvas
              key={`${search.scope}:${chosen ?? 'all'}:${search.scene ?? ''}:${search.mark ?? ''}`}
              handle={canvas}
              nodes={layout.nodes}
              regions={layout.regions}
              edges={edges}
              looseEdges={looseEdges}
              hubs={hubs}
              info={info}
              width={size.width}
              height={size.height}
              selectedId={search.node ? shown(search.node) : undefined}
              highlight={highlight}
              initialViewport={search.jump ? undefined : readViewport(key)}
              initialFocus={search.jump && search.node ? shown(layout.edges.find((edge) => edge.via === search.node)?.to ?? search.node) : undefined}
              onViewportChange={(viewport) => sessionStorage.setItem(key, JSON.stringify(viewport))}
              onSelect={select}
              onOpen={dialogue ? startLine : undefined}
              anchor={
                anchorId && search.edit
                  ? {
                      id: anchorId,
                      content: <LineCard projectId={projectId} unitId={search.edit} choice={flowLines[editAt].choice} position={`${editAt + 1} / ${flowLines.length}`} onStep={step} onClose={() => edit(undefined)} />,
                    }
                  : undefined
              }
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
              <div className="absolute top-3 left-3 flex w-[26rem] items-center gap-1.5 select-none">
                <div className="min-w-0 flex-1">
                  <SearchInput value={search.q} onChange={setFind} placeholder="노드 찾기 (키·라벨·첫 대사)" className="w-full h-7 bg-card border-border shadow-2xs text-xs rounded-md" />
                  {matches.length > 0 && (
                    <ul className="mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-popover/95 p-1 text-xs shadow-md backdrop-blur-md">
                      {matches.map((node) => (
                        <li key={node.id}>
                          <Button
                            variant="ghost"
                            size="row"
                            className="block truncate rounded-md text-xs py-1"
                            onClick={() => {
                              select(node.id);
                              canvas.current?.focus(shown(node.id));
                              setFind(undefined);
                            }}
                          >
                            <span className="text-xs text-muted-foreground">{KIND_LABEL[node.kind] ?? node.kind}</span> {node.preview ?? node.label ?? node.key}
                          </Button>
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

              {/* Minimal floating zoom bar (Figma / Miro style) */}
              <div className="absolute right-3 bottom-3 flex items-center rounded-lg border border-border bg-card shadow-xs backdrop-blur-md overflow-hidden select-none">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="축소"
                  onClick={() => canvas.current?.zoomBy(0.7)}
                  className="rounded-none hover:bg-accent text-muted-foreground hover:text-foreground"
                >
                  <Minus className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="확대"
                  onClick={() => canvas.current?.zoomBy(1.4)}
                  className="rounded-none hover:bg-accent text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="전체 맞춤"
                  onClick={() => canvas.current?.fit()}
                  className="rounded-none hover:bg-accent text-muted-foreground hover:text-foreground"
                >
                  <Maximize className="size-3.5" />
                </Button>
              </div>

              {/* Status pill & legend */}
              <p className="absolute top-3 right-3 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-mono text-muted-foreground tabular-nums shadow-2xs backdrop-blur-xs select-none">
                {search.scope === 'scene'
                  ? `장면 ${(layout.nodes.length - hubs.size).toLocaleString()}${hubs.size ? ` · 연결점 ${hubs.size.toLocaleString()}` : ''} · 연결 ${(edges.length + (looseEdges?.length ?? 0)).toLocaleString()}${looseEdges?.length ? ` (연결점 직선 ${looseEdges.length.toLocaleString()})` : ''}`
                  : `${view ? `보기${view.label ? ` "${view.label}"` : ''} · ` : chosen ? `구역 ${chosen} · ` : sections.length > 1 ? '전체 · ' : ''}노드 ${(layout.nodes.length - portals.size - (layout.chains?.length ?? 0) + (layout.chains ?? []).reduce((sum, chain) => sum + chain.nodeIds.length, 0)).toLocaleString()}개${layout.chains?.length ? ` (한 길로 이어진 ${(layout.chains ?? []).reduce((sum, chain) => sum + chain.nodeIds.length, 0).toLocaleString()}개는 덩어리 ${layout.chains.length.toLocaleString()}개로 접음)` : ''}${portals.size ? ` · 다른 구역으로 이어지는 이름표 ${portals.size.toLocaleString()}` : ''} · 연결 ${(edges.length + (looseEdges?.length ?? 0)).toLocaleString()}`}
                {highlight && !mark.data && ` · 강조 ${highlight.size.toLocaleString()}`}
              </p>
              {search.mark && mark.data && layout && (
                <div className="absolute top-10 right-3 flex items-center gap-2 rounded-md border border-border bg-card py-1 pr-1.5 pl-2.5 text-xs shadow-2xs backdrop-blur-xs select-none">
                  <span className="size-1.5 rounded-full bg-primary" />
                  <span className="text-xs">
                    강조{mark.data.label ? ` "${mark.data.label}"` : ''} · 이 화면 {layout.nodes.filter((node) => highlight?.has(node.id)).length.toLocaleString()} / {mark.data.nodeIds.length.toLocaleString()}개
                  </span>
                  {mark.data.section && mark.data.section !== chosen && (
                    <Button variant="ghost" onClick={() => void navigate({ search: (previous) => ({ ...previous, section: mark.data.section!, node: undefined }) })}>
                      가장 많은 구역으로
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => void navigate({ search: (previous) => ({ ...previous, mark: undefined }), replace: true })}>
                    강조 해제
                  </Button>
                </div>
              )}
              {search.scope === 'dialogue' && !!looseEdges?.length && (
                <p className="absolute top-10 right-3 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-2xs backdrop-blur-xs select-none">
                  허브 연결 {looseEdges.length.toLocaleString()}개는 숨김 · 허브를 누르면 그 선만 보입니다
                </p>
              )}
              {search.scope === 'scene' && hubs.size > 0 && (
                <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-2xs backdrop-blur-xs select-none">
                  연결점: 장면에 속하지 않으면서 여러 장면을 잇는 노드 묶음 (대사 그래프에서 파생)
                </p>
              )}
              {hidden.length > 0 && (
                <label className="absolute top-10 right-3 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-2xs backdrop-blur-xs select-none">
                  <Switch
                    checked={search.links === 'all'}
                    onCheckedChange={(on) => void navigate({ search: (previous) => ({ ...previous, links: on ? 'all' : undefined }), replace: true })}
                  />
                  다른 장면을 거쳐도 이어지는 연결 {hidden.length.toLocaleString()}개 {search.links === 'all' ? '표시 중' : '숨김'}
                </label>
              )}
            </>
          )}
        </div>
      </SplitPane>
    </Page>
  );
}
