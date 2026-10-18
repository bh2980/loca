import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeftRight, ArrowUpDown, Copy, ExternalLink, Flag, Focus, Maximize, Minus, Network, Plus, Route as RouteIcon, SlidersHorizontal, Sparkles } from 'lucide-react';
import { GraphCanvas, type GraphCanvasHandle, type NodeInfo, type Viewport } from '@/components/graph/graph-canvas';
import { LINE_CARD_WIDTH, LineCard } from '@/components/graph/line-card';
import { FlowPane, SceneNodeDetail } from '@/components/graph/node-detail';
import { KIND_LABEL } from '@/components/graph/shapes';
import { TypeLegend } from '@/components/graph/type-legend';
import { HeaderActions, Page } from '@/components/page';
import { SearchInput, SplitPane, PaneHeader, Button, CanvasDirectionControl, CanvasOverlay, CanvasSurface, Empty, EmptyDescription, EmptyHeader, EmptyTitle, ScrollArea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, Switch, ViewSwitch, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, useRevealDock, GraphEndpointBar } from '@loca/ui';
import { useSize } from '@/hooks/use-size';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { PathMode } from '@/components/graph/path-mode';
import { cn } from '@/lib/utils';

type Scope = 'scene' | 'dialogue';
type GraphDirection = 'vertical' | 'horizontal';
interface GraphSearch {
  scope: Scope;
  direction?: GraphDirection;
  /** 길 따라 보기: the slice of the dialogue graph for the stored choices (docs/DESIGN.md J2c). */
  view?: 'path';
  /** Reading route endpoints belong to this URL, independent of persisted legacy graph slices. */
  routeStart?: string;
  routeEnd?: string;
  /** Draft endpoint selection; applied endpoints remain routeStart/routeEnd until path creation. */
  pickStart?: string;
  pickEnd?: string;
  pickStep?: 'start' | 'end';
  pickSection?: string;
  pickQ?: string;
  pickChain?: string;
  pickFocus?: string;
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
    direction: raw.direction === 'horizontal' ? 'horizontal' : raw.direction === 'vertical' ? 'vertical' : undefined,
    view: raw.view === 'path' ? 'path' : undefined,
    routeStart: typeof raw.routeStart === 'string' && raw.routeStart ? raw.routeStart : undefined,
    routeEnd: typeof raw.routeEnd === 'string' && raw.routeEnd ? raw.routeEnd : undefined,
    pickStart: typeof raw.pickStart === 'string' && raw.pickStart ? raw.pickStart : undefined,
    pickEnd: typeof raw.pickEnd === 'string' && raw.pickEnd ? raw.pickEnd : undefined,
    pickStep: raw.pickStep === 'start' || raw.pickStep === 'end' ? raw.pickStep : undefined,
    pickSection: typeof raw.pickSection === 'string' && raw.pickSection ? raw.pickSection : undefined,
    pickQ: typeof raw.pickQ === 'string' && raw.pickQ ? raw.pickQ : undefined,
    pickChain: typeof raw.pickChain === 'string' && raw.pickChain ? raw.pickChain : undefined,
    pickFocus: typeof raw.pickFocus === 'string' && raw.pickFocus ? raw.pickFocus : undefined,
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
const viewportKey = (projectId: string, scope: Scope, scene?: string, section?: string, direction: GraphDirection = 'vertical') => `tw.graph.view.${projectId}.${scope}.${direction}.${section ?? ''}.${scene ?? ''}`;
const readViewport = (key: string): Viewport | undefined => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
};

const GRAPH_MODES = ['scene', 'dialogue'] as const;
/** The graph's modes in one sleek segment control: scene vs dialogue */
function ModeToggle({ value, onChange }: { value: (typeof GRAPH_MODES)[number]; onChange: (value: (typeof GRAPH_MODES)[number]) => void }) {
  return <ViewSwitch label="그래프 보기" value={value} onChange={(next) => onChange(next as (typeof GRAPH_MODES)[number])} items={[
    { value: 'scene', label: '장면' }, { value: 'dialogue', label: '대사' },
  ]} />;
}

function resolveChainEndpoint(
  id: string,
  role: 'start' | 'end',
  chains?: { id: string; nodeIds: string[] }[],
  nodes?: { id: string; total?: number }[],
): string {
  if (!id.startsWith('chain:') || !chains) return id;
  const chain = chains.find((c) => c.id === id);
  if (!chain || !chain.nodeIds.length) return id;
  const totals = new Map((nodes ?? []).map((n) => [n.id, n.total ?? 0] as const));
  if (role === 'start') {
    const candidate = chain.nodeIds.find((nodeId) => (totals.get(nodeId) ?? 0) > 0);
    return candidate ?? chain.nodeIds[0]!;
  } else {
    for (let i = chain.nodeIds.length - 1; i >= 0; i--) {
      const nodeId = chain.nodeIds[i]!;
      if ((totals.get(nodeId) ?? 0) > 0) return nodeId;
    }
    return chain.nodeIds[chain.nodeIds.length - 1]!;
  }
}

function GraphRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const direction = search.direction ?? 'vertical';
  const isRouteView = search.scope === 'dialogue' && Boolean(search.routeStart && search.routeEnd && !search.pickStep);

  if (isRouteView) {
    return (
      <PathMode
        projectId={projectId}
        direction={direction}
        onDirectionChange={(next) => void navigate({ search: (previous) => ({ ...previous, direction: next }) })}
        toggle={
          <ModeToggle
            value="dialogue"
            onChange={(mode) => void navigate({
              search: (previous) => ({
                ...previous,
                scope: mode,
                routeStart: undefined,
                routeEnd: undefined,
                pickStart: undefined,
                pickEnd: undefined,
                pickStep: undefined,
              }),
            })}
          />
        }
        start={search.routeStart}
        end={search.routeEnd}
        edit={search.edit}
        onEdit={(edit) => void navigate({ search: (previous) => ({ ...previous, edit }), replace: true })}
        onBeginPicking={(pickStep) => void navigate({
          search: (previous) => ({
            ...previous,
            pickStart: previous.routeStart,
            pickEnd: previous.routeEnd,
            pickStep: pickStep ?? 'start',
            node: undefined,
            edit: undefined,
          }),
        })}
        onClear={() => void navigate({
          search: (previous) => ({
            ...previous,
            routeStart: undefined,
            routeEnd: undefined,
            pickStart: undefined,
            pickEnd: undefined,
            pickStep: undefined,
            node: undefined,
            edit: undefined,
          }),
        })}
      />
    );
  }

  return <GraphPage />;
}

function GraphPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const dialogue = search.scope === 'dialogue';
  const direction = search.direction ?? 'vertical';
  // The section list is small and separate: the default section (the first, or the one holding
  // `scene`) is known before any layout is loaded.
  const sectionList = useQuery({ ...q.graphSections(projectId, direction), enabled: dialogue });
  const sections = dialogue ? (sectionList.data ?? []) : [];
  const chosen = !dialogue || search.section === 'all' ? undefined : search.section ?? (sections.length > 1 ? (sections.find((section) => section.groupIds.includes(search.scene ?? ''))?.name ?? sections[0].name) : undefined);
  const graph = useQuery({ ...q.graph(projectId, search.scope, chosen, direction), enabled: !dialogue || !!search.section || sectionList.isSuccess });
  // A view laid out on its own (the chat's show_graph, mode "only").
  const viewId = chosen?.startsWith('view:') ? chosen.slice('view:'.length) : undefined;
  const viewInfo = useQuery({ ...q.graphView(projectId, viewId ?? ''), enabled: !!viewId });
  const view = viewId && graph.data?.layout?.view ? { ...graph.data.layout.view, label: viewInfo.data?.label ?? graph.data.layout.view.label } : undefined;
  // Nodes the chat asked to highlight (show_graph, mode "mark"); the canvas waits for them so it opens on them.
  const mark = useQuery({ ...q.graphView(projectId, search.mark ?? ''), enabled: dialogue && !!search.mark });
  const marking = dialogue && !!search.mark && mark.isPending;
  const [container, size] = useSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);
  const revealDock = useRevealDock();
  const [contextMenu, setContextMenu] = useState<{
    nodeId?: string;
    x: number;
    y: number;
  } | null>(null);
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

  const key = viewportKey(projectId, search.scope, search.scene ?? (dialogue && search.mark ? `mark:${search.mark}` : undefined), dialogue ? (chosen ?? 'all') : undefined, direction);
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
  useReportView('graph-line', [
    editUnit.data && {
      kind: '대사',
      id: editUnit.data.id,
      label: `${editUnit.data.speaker?.trim() ? `${editUnit.data.speaker.trim()}: ` : ''}${editUnit.data.source.slice(0, 40)}`,
      detail: JSON.stringify({ key: editUnit.data.key }),
    },
  ]);
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
      return a && b ? [{ id: `h${i}`, from: edge.from, to: edge.to, points: direction === 'horizontal'
        ? [a.x + a.width, a.y + a.height / 2, b.x, b.y + b.height / 2]
        : [a.x + a.width / 2, a.y + a.height, b.x + b.width / 2, b.y] }] : [];
    });
    return [...layout.edges, ...extra];
  }, [layout, hidden, search.links]);

  const endpointIds = useMemo(() => [
    ...new Set([search.pickStart ?? search.routeStart, search.pickEnd ?? search.routeEnd].filter((id): id is string => Boolean(id)))
  ], [search.pickStart, search.routeStart, search.pickEnd, search.routeEnd]);
  const endpointDetails = useQueries({ queries: endpointIds.map((id) => q.graphNode(id, projectId)) });
  const endpointDetailById = useMemo(() => new Map(endpointIds.map((id, index) => {
    const detail = endpointDetails[index]?.data;
    return [id, detail?.projectId === projectId ? detail : undefined] as const;
  })), [endpointIds, endpointDetails, projectId]);

  const getEndpointValue = (id?: string, role: 'start' | 'end' = 'start') => {
    if (!id) return undefined;
    const detail = endpointDetailById.get(id);
    if (!detail) return undefined;
    if (detail.units.length === 0) {
      const label = detail.label ?? detail.key;
      return { id, label };
    }
    const unit = role === 'start' ? detail.units[0] : detail.units[detail.units.length - 1];
    const source = unit?.source ?? detail.label ?? detail.key;
    const text = source.replace(/\s+/g, ' ').trim();
    const label = `${unit?.speaker?.trim() ? `${unit.speaker.trim()}: ` : ''}${text}${detail.key ? ` · ${detail.key}` : ''}${detail.units.length > 1 ? ` · ${detail.units.length}줄` : ''}`;
    return { id, label };
  };

  const startValue = getEndpointValue(search.pickStart ?? search.routeStart, 'start');
  const endValue = getEndpointValue(search.pickEnd ?? search.routeEnd, 'end');
  const isPicking = Boolean(dialogue && (search.pickStep || search.pickStart || search.pickEnd));
  const currentStep: 'start' | 'end' = search.pickStep ?? (search.pickStart && !search.pickEnd ? 'end' : 'start');

  const endpointMarkers = useMemo(() => {
    if (!dialogue) return undefined;
    const markers = new Map<string, Array<'start' | 'end'>>();
    const sId = search.pickStart ?? search.routeStart;
    const eId = search.pickEnd ?? search.routeEnd;
    if (sId) {
      const visibleStart = shown(sId);
      markers.set(visibleStart, [...(markers.get(visibleStart) ?? []), 'start']);
    }
    if (eId) {
      const visibleEnd = shown(eId);
      markers.set(visibleEnd, [...(markers.get(visibleEnd) ?? []), 'end']);
    }
    return markers.size > 0 ? markers : undefined;
  }, [dialogue, search.pickStart, search.routeStart, search.pickEnd, search.routeEnd, chainOf]);

  return (
    <Page title="그래프" flush>
      <HeaderActions>
        <ModeToggle
          value={search.scope}
          onChange={(mode) => void navigate({
            search: (previous) => ({
              ...previous,
              scope: mode,
              routeStart: undefined,
              routeEnd: undefined,
              pickStart: undefined,
              pickEnd: undefined,
              pickStep: undefined,
            }),
          })}
        />
        <CanvasDirectionControl direction={direction} onDirectionChange={(next) => void navigate({ search: (previous) => ({ ...previous, direction: next }) })} />
        {dialogue && (
          <Button
            variant={isPicking ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => void navigate({
              search: (prev) => isPicking
                ? {
                    ...prev,
                    routeStart: undefined,
                    routeEnd: undefined,
                    pickStart: undefined,
                    pickEnd: undefined,
                    pickStep: undefined,
                  }
                : {
                    ...prev,
                    pickStep: 'start',
                    node: undefined,
                    edit: undefined,
                  },
            })}
          >
            <RouteIcon className="size-3.5 mr-1" />
            {isPicking ? '경로 선택 취소' : '경로 따라 번역'}
          </Button>
        )}
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
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {isPicking && (
          <GraphEndpointBar
            start={startValue}
            end={endValue}
            step={currentStep}
            picking={true}
            canFind={Boolean(startValue && endValue)}
            onStepChange={(step) => void navigate({ search: (prev) => ({ ...prev, pickStep: step }) })}
            onFind={() => {
              const finalStart = search.pickStart ?? search.routeStart;
              const finalEnd = search.pickEnd ?? search.routeEnd;
              if (finalStart && finalEnd) {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    routeStart: finalStart,
                    routeEnd: finalEnd,
                    pickStart: undefined,
                    pickEnd: undefined,
                    pickStep: undefined,
                    node: undefined,
                    edit: undefined,
                  }),
                });
              }
            }}
            onClear={() => {
              void navigate({
                search: (prev) => ({
                  ...prev,
                  routeStart: undefined,
                  routeEnd: undefined,
                  pickStart: undefined,
                  pickEnd: undefined,
                  pickStep: undefined,
                  node: undefined,
                  edit: undefined,
                }),
              });
            }}
          />
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <SplitPane
            id="graph"
            selectionKey={isPicking ? undefined : search.node}
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
        <CanvasSurface ref={container}>
          {canvasShown && layout && (
            <GraphCanvas
              key={`${search.scope}:${direction}:${chosen ?? 'all'}:${search.scene ?? ''}:${search.mark ?? ''}`}
              handle={canvas}
              nodes={layout.nodes}
              regions={layout.regions}
              edges={edges}
              looseEdges={looseEdges}
              direction={direction}
              hubs={hubs}
              info={info}
              width={size.width}
              height={size.height}
              selectedId={isPicking ? undefined : search.node ? shown(search.node) : undefined}
              highlight={highlight}
              endpointMarkers={endpointMarkers}
              initialViewport={search.jump ? undefined : readViewport(key)}
              initialFocus={search.jump && search.node ? shown(layout.edges.find((edge) => edge.via === search.node)?.to ?? search.node) : undefined}
              onViewportChange={(viewport) => sessionStorage.setItem(key, JSON.stringify(viewport))}
              onSelect={(id) => {
                setContextMenu(null);
                if (!id) {
                  select(undefined);
                  return;
                }
                if (dialogue && isPicking) {
                  const targetId = resolveChainEndpoint(id, currentStep, layout?.chains, graph.data?.nodes);
                  if (currentStep === 'start') {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        pickStart: targetId,
                        pickStep: 'end',
                        node: undefined,
                        edit: undefined,
                      }),
                      replace: true,
                    });
                  } else {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        pickEnd: targetId,
                        pickStep: 'end',
                        node: undefined,
                        edit: undefined,
                      }),
                      replace: true,
                    });
                  }
                  return;
                }
                select(id);
              }}
              onContextMenu={(nodeId, pos) => {
                if (nodeId) select(nodeId);
                setContextMenu({ nodeId, x: pos.clientX, y: pos.clientY });
              }}
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
          {contextMenu && (
            <DropdownMenu open={Boolean(contextMenu)} onOpenChange={(open) => !open && setContextMenu(null)} modal={false}>
              <DropdownMenuTrigger asChild>
                <span
                  aria-hidden
                  style={{
                    position: 'fixed',
                    left: contextMenu.x,
                    top: contextMenu.y,
                    width: 1,
                    height: 1,
                    pointerEvents: 'none',
                  }}
                />
              </DropdownMenuTrigger>
              {search.scope === 'dialogue' && contextMenu.nodeId && (
                <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-48">
                  <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      select(id);
                      setFollow({ node: id, direction: 0 });
                      const untranslated = flowNodes.flatMap((result) => result.data?.units ?? []).find((unit) => !unit.translation);
                      const unitId = untranslated?.id ?? flowLines[0]?.unitId;
                      if (search.node === id && unitId) {
                        edit(unitId);
                      }
                    }}
                  >
                    <Sparkles className="size-3.5" />
                    <span>이 자리에서 번역</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      select(contextMenu.nodeId);
                      revealDock?.();
                    }}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    <span>상세 속성 열기</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      const targetNodeId = id.startsWith('chain:')
                        ? (layout?.chains?.find((c) => c.id === id)?.nodeIds[0] ?? id)
                        : id;
                      const rawNode = graph.data?.nodes.find((n) => n.id === targetNodeId);
                      const groupId = rawNode?.groupId;
                      const lineId = flowLines.find((l) => l.nodeId === targetNodeId)?.unitId ?? (search.node === id ? flowLines[0]?.unitId : undefined);
                      void navigate({
                        to: '/p/$projectId/script',
                        params: { projectId },
                        search: {
                          ...(groupId ? { group: groupId } : {}),
                          ...(lineId ? { line: lineId } : {}),
                        },
                      });
                    }}
                  >
                    <ExternalLink className="size-3.5" />
                    <span>대사 화면에서 열기</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      const startId = resolveChainEndpoint(id, 'start', layout?.chains, graph.data?.nodes);
                      void navigate({
                        search: (prev) => ({
                          ...prev,
                          scope: 'dialogue',
                          pickStart: startId,
                          pickStep: 'end',
                          node: undefined,
                          edit: undefined,
                        }),
                      });
                    }}
                  >
                    <RouteIcon className="size-3.5" />
                    <span>경로 시작점으로 지정</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      const endId = resolveChainEndpoint(id, 'end', layout?.chains, graph.data?.nodes);
                      const existingStart = search.pickStart ?? search.routeStart;
                      if (existingStart) {
                        void navigate({
                          search: (prev) => ({
                            ...prev,
                            scope: 'dialogue',
                            routeStart: existingStart,
                            routeEnd: endId,
                            pickStart: undefined,
                            pickEnd: undefined,
                            pickStep: undefined,
                            node: undefined,
                            edit: undefined,
                          }),
                        });
                      } else {
                        void navigate({
                          search: (prev) => ({
                            ...prev,
                            scope: 'dialogue',
                            pickEnd: endId,
                            pickStep: 'start',
                            node: undefined,
                            edit: undefined,
                          }),
                        });
                      }
                    }}
                  >
                    <Flag className="size-3.5" />
                    <span>경로 끝점으로 지정</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      const nodeKey = info.get(id)?.key ?? id;
                      void navigator.clipboard.writeText(nodeKey);
                      toast.success('노드 키를 복사했습니다.');
                    }}
                  >
                    <Copy className="size-3.5" />
                    <span>노드 키 복사</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              )}
              {search.scope === 'scene' && contextMenu.nodeId && (
                <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-48">
                  <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      void navigate({
                        to: '/p/$projectId/script',
                        params: { projectId },
                        search: { group: id },
                      });
                    }}
                  >
                    <ExternalLink className="size-3.5" />
                    <span>장면 대사 열기</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      void navigate({
                        search: (prev) => ({
                          ...prev,
                          scope: 'dialogue',
                          scene: id,
                        }),
                      });
                    }}
                  >
                    <Network className="size-3.5" />
                    <span>대사 그래프에서 보기</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      select(contextMenu.nodeId);
                      revealDock?.();
                    }}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    <span>상세 속성 열기</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              )}
              {!contextMenu.nodeId && (
                <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-48">
                  <DropdownMenuItem onSelect={() => canvas.current?.fit()}>
                    <Maximize className="size-3.5" />
                    <span>화면에 맞춤</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => canvas.current?.zoomTo(1)}>
                    <Focus className="size-3.5" />
                    <span>100% 배율</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      void navigate({
                        search: (prev) => ({
                          ...prev,
                          direction: direction === 'vertical' ? 'horizontal' : 'vertical',
                        }),
                      });
                    }}
                  >
                    {direction === 'vertical' ? <ArrowLeftRight className="size-3.5" /> : <ArrowUpDown className="size-3.5" />}
                    <span>{direction === 'vertical' ? '가로 배치로 전환' : '세로 배치로 전환'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
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
              <CanvasOverlay
                tools={
                  <>
                    <div className="relative w-[26rem] max-w-full min-w-0 shrink select-none">
                      <SearchInput value={search.q} onChange={setFind} placeholder="노드 찾기 (키·라벨·첫 대사)" className="w-full h-7 bg-card border-border shadow-2xs text-xs rounded-md" />
                      {matches.length > 0 && (
                        <ul className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover/95 p-1 text-xs shadow-md backdrop-blur-md">
                          {matches.map((node) => (
                            <li key={node.id}>
                              <Button
                                variant="ghost"
                                size="row"
                                className="flex w-full items-start gap-2 rounded-md py-1 text-left"
                                onClick={() => {
                                  if (dialogue && isPicking) {
                                    const targetId = resolveChainEndpoint(node.id, currentStep, layout?.chains, graph.data?.nodes);
                                    if (currentStep === 'start') {
                                      void navigate({
                                        search: (prev) => ({
                                          ...prev,
                                          pickStart: targetId,
                                          pickStep: 'end',
                                          node: undefined,
                                          edit: undefined,
                                        }),
                                        replace: true,
                                      });
                                    } else {
                                      void navigate({
                                        search: (prev) => ({
                                          ...prev,
                                          pickEnd: targetId,
                                          pickStep: 'end',
                                          node: undefined,
                                          edit: undefined,
                                        }),
                                        replace: true,
                                      });
                                    }
                                    canvas.current?.focus(shown(node.id));
                                    setFind(undefined);
                                    return;
                                  }
                                  select(node.id);
                                  canvas.current?.focus(shown(node.id));
                                  setFind(undefined);
                                }}
                              >
                                <span className="w-14 shrink-0 pt-0.5 text-xs text-muted-foreground">{KIND_LABEL[node.kind] ?? node.kind}</span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs text-foreground">{node.label ?? node.key}</span>
                                  {node.preview && <span className="block truncate text-xs text-muted-foreground">{node.preview}</span>}
                                </span>
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
                  </>
                }
                details={
                  <>
                    <p className="max-w-3xl break-words rounded-md border border-border bg-card px-2.5 py-1 text-xs font-mono text-muted-foreground tabular-nums shadow-2xs backdrop-blur-xs select-none">
                      {search.scope === 'scene'
                        ? `장면 ${(layout.nodes.length - hubs.size).toLocaleString()}${hubs.size ? ` · 연결점 ${hubs.size.toLocaleString()}` : ''} · 연결 ${(edges.length + (looseEdges?.length ?? 0)).toLocaleString()}${looseEdges?.length ? ` (연결점 직선 ${looseEdges.length.toLocaleString()})` : ''}`
                        : `${view ? `보기${view.label ? ` "${view.label}"` : ''} · ` : chosen ? `구역 ${chosen} · ` : sections.length > 1 ? '전체 · ' : ''}노드 ${(layout.nodes.length - portals.size - (layout.chains?.length ?? 0) + (layout.chains ?? []).reduce((sum, chain) => sum + chain.nodeIds.length, 0)).toLocaleString()}개${layout.chains?.length ? ` (한 길로 이어진 ${(layout.chains ?? []).reduce((sum, chain) => sum + chain.nodeIds.length, 0).toLocaleString()}개는 덩어리 ${layout.chains.length.toLocaleString()}개로 접음)` : ''}${portals.size ? ` · 다른 구역으로 이어지는 이름표 ${portals.size.toLocaleString()}` : ''} · 연결 ${(edges.length + (looseEdges?.length ?? 0)).toLocaleString()}`}
                      {highlight && !mark.data && ` · 강조 ${highlight.size.toLocaleString()}`}
                    </p>
                    {search.scope === 'scene' && hubs.size > 0 && (
                      <p className="max-w-3xl rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                        연결점: 장면에 속하지 않으면서 여러 장면을 잇는 노드 묶음 (대사 그래프에서 파생)
                      </p>
                    )}
                    {search.mark && mark.data && layout && (
                      <div className="flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card py-1 pr-1.5 pl-2.5 text-xs shadow-2xs backdrop-blur-xs select-none">
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
                      <p className="max-w-3xl break-words rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-2xs backdrop-blur-xs select-none">
                        허브 연결 {looseEdges.length.toLocaleString()}개는 숨김 · 허브를 누르면 그 선만 보입니다
                      </p>
                    )}
                    {hidden.length > 0 && (
                      <label className="flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-2xs backdrop-blur-xs select-none">
                        <Switch
                          checked={search.links === 'all'}
                          onCheckedChange={(on) => void navigate({ search: (previous) => ({ ...previous, links: on ? 'all' : undefined }), replace: true })}
                        />
                        다른 장면을 거쳐도 이어지는 연결 {hidden.length.toLocaleString()}개 {search.links === 'all' ? '표시 중' : '숨김'}
                      </label>
                    )}
                  </>
                }
              />

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


            </>
          )}
        </CanvasSurface>
      </SplitPane>
    </div>
  </div>
</Page>
  );
}
