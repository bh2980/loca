import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeftRight, ClipboardPaste, CopyPlus, ListOrdered, Trash2, FilePlus2, FolderPlus, MinusCircle, ArrowUpDown, Copy, ExternalLink, Flag, Focus, Network, Play, Route as RouteIcon, SlidersHorizontal } from 'lucide-react';
import { RunDialog } from '@/components/workflow/run-dialog';
import { GraphCanvas, type GraphCanvasHandle, type LayoutEdge, type NodeInfo, type Viewport } from '@/components/graph/graph-canvas';
import { LINE_CARD_WIDTH, LineCard } from '@/components/graph/line-card';
import { FlowPane, SceneNodeDetail } from '@/components/graph/node-detail';
import { KIND_LABEL } from '@/components/graph/shapes';
import { TypeLegend } from '@/components/graph/type-legend';
import { HeaderActions, HeaderViews, Page } from '@/components/page';
import { usePersonColors } from '@/lib/person-colors';
import { useDialogueGraphEdits, type DrawnGraph } from '@/components/graph/graph-edits';
import { EdgePane, InsertLinePane } from '@/components/graph/edit-panes';
import { LineMenuFor } from '@/components/script/line-menu';
import { GRAPH_KEYS, useGraphShortcuts } from '@/lib/graph-shortcuts';
import { keyLabel } from '@/lib/keys';

import { SearchField, SegmentedControl, SplitPane, PaneHeader, Button, CanvasOverlay, CanvasSurface, EmptyDescription, EmptyHeader, EmptyTitle, ScrollArea, Input, Popover, PopoverContent, PopoverTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, Spinner, Switch, ViewSwitch, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, SelectionToolbox, useRevealDock, GraphEndpointBar, Box, Stack, Text, Icon, Inline, Chip, Notice, FloatingZoomBar, FoundNodeList, Overlay, EmptyState } from '@loca/ui';
import { useSize } from '@/hooks/use-size';
import { q } from '@/lib/queries';
import { lineContext, useLineDetail } from '@/lib/units';
import { useReportView } from '@/lib/view-context';
import { DeleteViewDialog, OmittedPane, ViewInspector, ViewReason, useViewActions } from '@/components/graph/view-inspector';
import { ViewMenu } from '@/components/graph/view-menu';
import { PathMode } from '@/components/graph/path-mode';
import { GRAPH_SHOW_ITEMS, useGraphPaneView, useGraphShow, type GraphShow } from '@/lib/graph-show';
import { AUTO_OPEN_NODES, nodeAfterToggle, pickedAfterToggle, unfoldChains } from '@/components/graph/unfold-chains';
import { cn } from '@/lib/utils';
import { useGraphViews } from '@/lib/logs';
/** Dialogue-graph nodes copied with ⌘/Ctrl+C or 복사, pasted as copies. */
/** Copied nodes, shared by every graph page of this tab (read and set through these, not reassigned in a component). */
let nodeClipboard: string[] = [];
const copyNodes = (ids: string[]) => void (nodeClipboard = ids);
const copiedNodes = () => nodeClipboard;

type Scope = 'scene' | 'dialogue';
type GraphDirection = 'vertical' | 'horizontal';
interface GraphSearch {
  scope: Scope;
  direction?: GraphDirection;
  /** 길 따라 보기: the slice of the dialogue graph for the stored choices. */
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
  /** The right pane shows the open view's own details (name, request, counts). */
  viewInfo?: true;
  /** The right pane lists what a derived edge leaves out (the edge's id in the open layout). */
  omitted?: string;
  /** Node finder text (matches are listed under the box). */
  q?: string;
  /** A line of the dialogue graph picked (its drawn id): its pane shows where it comes from, 삭제. */
  edge?: string;
  /** 이 대사 뒤에 대사 추가: the node a new line goes after (its pane is open). */
  addAfter?: string;
  /** The folded runs drawn as their lines (their ids). Absent: a small graph opens them all, a big one none; `[]` is none. */
  open?: string[];
}

export const Route = createFileRoute('/p/$projectId/graph')({
  validateSearch: (raw: Record<string, unknown>): GraphSearch => ({
    scope: raw.scope === 'scene' && raw.view !== 'path' ? 'scene' : 'dialogue',
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
    viewInfo: raw.viewInfo === true || raw.viewInfo === 'true' || raw.viewInfo === '1' || raw.viewInfo === 1 ? true : undefined,
    omitted: typeof raw.omitted === 'string' && raw.omitted ? raw.omitted : undefined,
    q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
    edge: typeof raw.edge === 'string' && raw.edge ? raw.edge : undefined,
    addAfter: typeof raw.addAfter === 'string' && raw.addAfter ? raw.addAfter : undefined,
    open: Array.isArray(raw.open) ? raw.open.filter((id): id is string => typeof id === 'string') : undefined,
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

const GRAPH_MODES = ['dialogue', 'scene'] as const;
/** The graph's modes in one segment control: the dialogue graph (the default, where links are made) and the scene graph read off it. */
function ModeToggle({ value, onChange }: { value: (typeof GRAPH_MODES)[number]; onChange: (value: (typeof GRAPH_MODES)[number]) => void }) {
  return <ViewSwitch label="그래프 보기" value={value} onChange={(next) => onChange(next as (typeof GRAPH_MODES)[number])} items={[
    { value: 'dialogue', label: '대사' }, { value: 'scene', label: '장면' },
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
  const graphQuery = useQuery({ ...q.graph(projectId, search.scope, chosen, direction), enabled: !dialogue || !!search.section || sectionList.isSuccess });
  // Folded runs are drawn as their lines when asked (`open`), or all of them in a graph small enough to read.
  // Done here on the stored layout, not by the server: opening a run takes no layout calculation.
  const foldedRuns = graphQuery.data?.layout?.chains;
  const autoOpen = (graphQuery.data?.nodes.length ?? Infinity) <= AUTO_OPEN_NODES;
  const openRuns = useMemo(() => new Set(search.open ?? (autoOpen ? (foldedRuns ?? []).map((run) => run.id) : [])), [search.open, autoOpen, foldedRuns]);
  const graphData = useMemo(
    () => (graphQuery.data?.layout ? { ...graphQuery.data, layout: unfoldChains(graphQuery.data.layout, openRuns, direction) } : graphQuery.data),
    [graphQuery.data, openRuns, direction],
  );
  // What the cards show of each line (the side pane follows the same setting).
  const [show, setShow] = useGraphShow();
  const graph = { data: graphData, isPending: graphQuery.isPending };
  // The cards' translations come apart from the layout (it does not change when a line is saved).
  const translations = useQuery({ ...q.graphTranslations(projectId, chosen, direction), enabled: dialogue && graphQuery.data?.status === 'ready' && show !== 'source' }).data;
  /** The open run each of its lines belongs to (to fold it again from any of them). */
  const openedFrom = useMemo(() => new Map((foldedRuns ?? []).filter((run) => openRuns.has(run.id)).flatMap((run) => run.nodeIds.map((id) => [id, run.id] as const))), [foldedRuns, openRuns]);
  const toggleFold = (runId: string) => {
    const run = foldedRuns?.find((item) => item.id === runId);
    const opening = !openRuns.has(runId);
    // The selection follows the run's new form: the block and its lines are different nodes on the canvas.
    if (run) setPicked((current) => (current.size ? pickedAfterToggle(run, opening, current) : current));
    void navigate({
      search: (previous) => {
        const next = new Set(openRuns);
        if (!next.delete(runId)) next.add(runId);
        const holder = flowLines.find((line) => line.unitId === previous.edit)?.nodeId;
        return { ...previous, open: [...next], ...(run && previous.node && { node: nodeAfterToggle(run, opening, previous.node, holder) }) };
      },
      replace: true,
    });
  };
  // A view laid out on its own (the chat's show_graph, mode "only").
  const viewId = chosen?.startsWith('view:') ? chosen.slice('view:'.length) : undefined;
  // Editing reads what is drawn (folded runs) when it acts.
  const drawn = useRef<DrawnGraph | null>(null);
  // The edits read the drawn layout when they run (kept after each render).
  useLayoutEffect(() => {
    drawn.current = graph.data?.layout ?? null;
  });
  const edits = useDialogueGraphEdits(projectId, drawn);
  const viewDetail = useQuery({ ...q.graphView(projectId, viewId ?? ''), enabled: !!viewId });
  const view = viewId && graph.data?.layout?.view ? { ...graph.data.layout.view, label: viewDetail.data?.label ?? graph.data.layout.view.label } : undefined;
  const savedViews = useGraphViews(projectId, { enabled: dialogue }).data ?? [];
  const viewActions = useViewActions(projectId);
  const [deletingView, setDeletingView] = useState<{ id: string; label: string } | null>(null);
  /** Naming a view made from the picked nodes: the small popover stands where the menu was. */
  const [naming, setNaming] = useState<{ nodeIds: string[]; x: number; y: number } | null>(null);
  const [newName, setNewName] = useState('');
  // Nodes the chat asked to highlight (show_graph, mode "mark"); the canvas waits for them so it opens on them.
  const mark = useQuery({ ...q.graphView(projectId, search.mark ?? ''), enabled: dialogue && !!search.mark });
  const marking = dialogue && !!search.mark && mark.isPending;
  const [container, size] = useSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);
  const revealDock = useRevealDock();
  const [contextMenu, setContextMenu] = useState<{
    nodeId?: string;
    /** A right-click on a line (dialogue graph). */
    edgeId?: string;
    x: number;
    y: number;
  } | null>(null);
  /** Box or modifier-click selection; a single selection stays in the URL (`node`). */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [runUnits, setRunUnits] = useState<string[]>();
  const find = search.q ?? '';
  const setFind = (q: string | undefined) => void navigate({ search: (previous) => ({ ...previous, q }), replace: true });

  const colorOf = usePersonColors(projectId);
  const info = useMemo(() => {
    const types = graph.data?.nodeTypes ?? {};
    // Control nodes are labelled by what the game's node class means, not by its raw name.
    // A line card leads with who speaks and shows the line; the node key is in the side pane.
    const lineCard = (node: { id: string; speaker?: string | null; text?: string | null; total?: number }) =>
      node.text ? { title: `${node.speaker ?? '지문·화면 문구'}${(node.total ?? 0) > 1 ? ` · ${node.total}줄` : ''}`, titleColor: colorOf(node.speaker), ...shownText(node.text, translations?.[node.id]) } : {};
    // The first line's text by what is shown: the source, the translation alone, or the source over the translation.
    const shownText = (text: string, translation?: string | null): Pick<NodeInfo, 'body' | 'bodyStrong' | 'second' | 'missing'> =>
      show === 'source' ? { body: text } : show === 'translation' ? (translation ? { body: translation, bodyStrong: true } : { body: '번역 없음', missing: 'body' }) : { body: text, second: translation ?? '번역 없음', ...(!translation && { missing: 'second' as const }) };
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
        ...(spoken ? shownText(`${spoken.speaker ? `${spoken.speaker}: ` : ''}${spoken.text}`, translations?.[spoken.id] ? `${spoken.speaker ? `${spoken.speaker}: ` : ''}${translations[spoken.id]}` : null) : { body: first?.label ?? null }),
        preview: spoken?.preview ?? first?.preview ?? first?.label ?? null,
        key: `${first?.key ?? ''} 외 ${chain.nodeIds.length - 1}개`,
      });
    }
    // The card that opens a run, and the first line of an open run that folds it again.
    for (const run of foldedRuns ?? []) {
      const card = map.get(run.id);
      if (card) map.set(run.id, { ...card, fold: run.id });
    }
    for (const run of foldedRuns ?? []) {
      const head = openRuns.has(run.id) ? map.get(run.nodeIds[0]) : undefined;
      if (head) map.set(head.id, { ...head, fold: run.id });
    }
    return map;
  }, [graph.data, colorOf, foldedRuns, openRuns, show, translations]);
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
    // The translation is searched too once it is on the cards.
    return graph.data.nodes.filter((node) => [node.key, node.label, node.preview, show === 'source' ? null : translations?.[node.id]].some((value) => value?.toLowerCase().includes(text))).slice(0, 50);
  }, [find, graph.data, show, translations]);

  const key = viewportKey(projectId, search.scope, search.scene ?? (dialogue && search.mark ? `mark:${search.mark}` : undefined), dialogue ? (chosen ?? 'all') : undefined, direction);
  const select = (id: string | undefined) => {
    const target = id ? portals.get(id) : undefined;
    // A portal is navigation to the section it stands for (or, in a view of chosen scenes, to the
    // scene the lines continue in, shown in its own section), not a node to inspect.
    if (target?.groupId) void navigate({ search: { scope: 'dialogue', scene: target.groupId } });
    else if (target) void navigate({ search: (previous) => ({ ...previous, section: target.section, node: undefined, scene: undefined, omitted: undefined, viewInfo: undefined }) });
    else {
      // While the translation card is open, picking another node keeps translating there (its first
      // line without a translation); clicking empty canvas or Esc ends it.
      if (id && search.edit && search.node && shown(id) === anchorOf(search.node)) return;
      if (id && search.edit && dialogue) setFollow({ node: id, direction: 0 });
      void navigate({ search: (previous) => ({ ...previous, node: id, edit: undefined, edge: undefined, addAfter: undefined, omitted: id ? undefined : previous.omitted }), replace: true });
    }
  };
  const layout = graph.data?.layout;
  // Arriving from a line: the canvas opens centred on its node (inside a folded run, the run; a
  // choice, what it leads to), then `jump` is forgotten. The line's scene only picks the section; it
  // is not highlighted (the rest of the graph would dim while one only wants to read around the line).
  // A layout being made again (after an edit) keeps the last one on screen until the new one arrives.
  const relayout = graph.data?.status === 'pending' && Boolean(layout);
  const canvasShown = (graph.data?.status === 'ready' || relayout) && !!layout && size.width > 0 && !marking;
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
  const editUnit = useLineDetail(projectId, search.edit ?? '');
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
  // ── the side pane: the node, or the flow through it ──────────────
  const [paneView, setPaneView] = useGraphPaneView();
  const [span, setSpan] = useState({ before: 6, after: 6 });
  useEffect(() => setSpan({ before: 6, after: 6 }), [search.node]);
  const membersOf = (id: string) => layout?.chains?.find((chain) => chain.id === id)?.nodeIds ?? [id];
  const ownNodes = dialogue && search.node ? flowOf(search.node) : [];
  // The flow before and after the selection along the way: node by node until it forks, merges or ends (the rule ⌥↓ steps by).
  const flowAround = (() => {
    if (!dialogue || !search.node || !layout || paneView !== 'flow') return null;
    const walk = (direction: 1 | -1, limit: number) => {
      const ids: string[] = [];
      const seen = new Set([search.node!]);
      let at = search.node!;
      let stop: string | undefined;
      let more = false;
      while (true) {
        const step = neighbour(at, direction);
        if ('stop' in step) {
          stop = step.stop;
          break;
        }
        if (seen.has(step.target)) {
          stop = '흐름이 돌아옵니다.';
          break;
        }
        if (ids.length >= limit) {
          more = true;
          break;
        }
        seen.add(step.target);
        ids.push(step.target);
        at = step.target;
      }
      return { ids, stop, more };
    };
    return { before: walk(-1, span.before), after: walk(1, span.after) };
  })();
  const paneNodeIds = flowAround ? [...[...flowAround.before.ids].reverse().flatMap(membersOf), ...ownNodes, ...flowAround.after.ids.flatMap(membersOf)] : ownNodes;
  const textOf = (id: string) => {
    const card = info.get(id);
    return [card?.title, card?.body ?? card?.preview ?? card?.label].filter(Boolean).join(' · ') || id;
  };
  // What the selected node joins: the node on the other end of each way in and out, and the choice written on it.
  const connections = (() => {
    if (!dialogue || !search.node || !layout) return [];
    const here = shown(search.node);
    return layout.edges.flatMap((edge) => [
      ...(edge.to === here && !edge.from.startsWith('portal:') ? [{ dir: 'in' as const, id: edge.from, choice: edge.label, text: textOf(edge.from) }] : []),
      ...(edge.from === here && !edge.to.startsWith('portal:') ? [{ dir: 'out' as const, id: edge.to, choice: edge.label, text: textOf(edge.to) }] : []),
    ]);
  })();
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
    for (const line of [flowLines[editAt - 1], flowLines[editAt + 1]]) if (line && editAt >= 0) void queryClient.prefetchQuery(lineContext(line.unitId));
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
  const edges = useMemo<LayoutEdge[]>(() => {
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

  /** The lines of the picked nodes (a folded run's nodes; portals hold none), for a workflow run. */
  const runPicked = async (ids: Iterable<string>) => {
    const nodeIds = [...ids].flatMap((id) => (portals.has(id) ? [] : (layout?.chains?.find((chain) => chain.id === id)?.nodeIds ?? [id])));
    const details = await Promise.all(nodeIds.map((id) => queryClient.fetchQuery(q.graphNode(id))));
    const unitIds = [...new Set(details.flatMap((detail) => detail.units.map((unit) => unit.id)))];
    if (unitIds.length) setRunUnits(unitIds);
    else toast('고른 노드에 대사가 없습니다.');
  };

  /** The real node ids behind picked ids: a folded run's nodes; portals stand for none. */
  const realNodes = (ids: Iterable<string>) => [...new Set([...ids].flatMap((id) => (portals.has(id) ? [] : (layout?.chains?.find((chain) => chain.id === id)?.nodeIds ?? [id]))))];
  const makeView = () => {
    if (!naming || !newName.trim()) return;
    viewActions.create.mutate({ label: newName.trim(), nodeIds: naming.nodeIds }, {
      onSuccess: ({ id }) => {
        setNaming(null);
        setNewName('');
        setPicked(new Set());
        void navigate({ search: (previous) => ({ ...previous, section: `view:${id}`, node: undefined, edit: undefined, omitted: undefined, viewInfo: undefined }) });
      },
    });
  };
  const addToView = (id: string, label: string, ids: Iterable<string>) => {
    const nodeIds = realNodes(ids);
    viewActions.change.mutate({ id, add: nodeIds }, { onSuccess: () => toast.success(`보기 "${label}"에 노드 ${nodeIds.length.toLocaleString()}개를 더했습니다.`) });
  };
  const leaveView = (ids: Iterable<string>) => {
    if (!viewId) return;
    const nodeIds = realNodes(ids);
    viewActions.change.mutate({ id: viewId, remove: nodeIds }, {
      onSuccess: () => {
        setPicked(new Set());
        if (search.node) select(undefined);
      },
    });
  };
  /** The views a node set can be added to (the open one already holds its nodes). */
  const otherViews = savedViews.filter((saved) => saved.id !== viewId);
  const derivedEdges = edges.filter((edge) => edge.derived).length;
  const reasonOf = (nodeId: string) => {
    const reasons = viewDetail.data?.reasons;
    if (!reasons) return undefined;
    const ids = nodeId.startsWith('chain:') ? (layout?.chains?.find((chain) => chain.id === nodeId)?.nodeIds ?? []) : [nodeId];
    const texts = [...new Set(ids.flatMap((id) => (reasons[id] ? [reasons[id]] : [])))];
    return texts.length ? texts.join('\n') : undefined;
  };
  const omittedEdge = search.omitted ? edges.find((edge) => edge.id === search.omitted && edge.omitted) : undefined;
  const infoOpen = Boolean(search.viewInfo && viewId);

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
  // Editing the dialogue graph, with the keys every graph shares (lib/graph-shortcuts). A view's
  // lines are derived, so a view is read only.
  const editing = dialogue && !isPicking && !viewId;
  // The scene graph only shows how scenes connect: its links are read off the dialogue graph, where lines are linked. What it
  // still does is link the nodes inside a scene in script order (대본 순서로 잇기); undo is shared with the dialogue graph.
  const sceneEditing = !dialogue;
  /** The picked scenes, or the one the menu is on; hubs are not scenes. */
  const scenesOf = (id: string) => (picked.has(id) ? [...picked] : [id]).filter((sceneId) => !hubs.has(sceneId));
  const orderScenes = (ids: string[]) => void edits.linkInOrder({ groupIds: ids });
  const pickedNodes = picked.size ? [...picked] : search.node ? [search.node] : [];
  const openEdge = (edgeId: string | undefined) => void navigate({ search: (previous) => ({ ...previous, edge: edgeId, node: undefined, edit: undefined, addAfter: undefined }), replace: true });
  const removePicked = () => {
    if (search.edge && edits.canDeleteEdge(search.edge)) void edits.remove({ nodeIds: [], edgeId: search.edge }).then(() => openEdge(undefined));
    else if (pickedNodes.length) {
      setPicked(new Set());
      void edits.remove({ nodeIds: pickedNodes });
      select(undefined);
    }
  };
  const paste = async (ids: string[]) => {
    const made = ids.length ? await edits.duplicate(ids) : undefined;
    if (made) setPicked(new Set(Object.values(made)));
  };
  useGraphShortcuts(
    {
      undo: () => void edits.undo(),
      redo: () => void edits.redo(),
      // Scenes are not copied or deleted from here: only the dialogue graph has those.
      ...(editing && {
        copy: () => void (pickedNodes.length && copyNodes(pickedNodes)),
        cut: () => {
          if (!pickedNodes.length) return;
          copyNodes(pickedNodes);
          removePicked();
        },
        paste: () => void paste(copiedNodes()),
        remove: removePicked,
      }),
    },
    editing || sceneEditing,
  );
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
      <HeaderViews>
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
      </HeaderViews>
      <HeaderActions>
        {dialogue && (
          <Button
            variant={isPicking ? 'secondary' : 'outline'}
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
            <Icon icon={RouteIcon} size="sm" marginRight="tight" />
            {isPicking ? '취소' : '경로 따라 번역'}
          </Button>
        )}
        {dialogue && (sections.length > 1 || savedViews.length > 0 || view) && (
          <ViewMenu
            sections={sections}
            views={savedViews}
            chosen={chosen}
            openedLabel={view?.label}
            // Opening another view or section is navigation (a history entry); the pane's selection does not carry over.
            onPick={(value) => void navigate({ search: (previous) => ({ ...previous, section: value, node: undefined, omitted: undefined, viewInfo: undefined }) })}
            onDelete={setDeletingView}
          />
        )}
        <DeleteViewDialog
          projectId={projectId}
          view={deletingView}
          onClose={() => setDeletingView(null)}
          onDeleted={(id) => {
            setDeletingView(null);
            // The view that was open falls back to the whole graph.
            if (viewId === id) void navigate({ search: (previous) => ({ ...previous, section: undefined, viewInfo: undefined, node: undefined, omitted: undefined }) });
          }}
        />
      </HeaderActions>
      <Stack height="full" minHeight={0} grow overflow="hidden">
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
        <Box position="relative" minHeight={0} grow overflow="hidden">
          <SplitPane
            id="graph"
            selectionKey={isPicking ? undefined : search.node ?? (search.edge ? `edge:${search.edge}` : search.addAfter ? `add:${search.addAfter}` : omittedEdge ? `omitted:${omittedEdge.id}` : infoOpen ? 'view-info' : undefined)}
            defaultWidth="380px"
            fill
        pane={
          (search.node || omittedEdge || infoOpen || (dialogue && (search.edge || search.addAfter))) && (
            <Box height="full" background="page">
              {dialogue && search.edge ? (
                <EdgePane
                  key={search.edge}
                  projectId={projectId}
                  edgeId={search.edge}
                  onOpenNode={(id) => select(id)}
                  onRemove={editing && edits.canDeleteEdge(search.edge) ? () => void edits.remove({ nodeIds: [], edgeId: search.edge }).then(() => openEdge(undefined)) : undefined}
                  onClose={() => openEdge(undefined)}
                />
              ) : dialogue && search.addAfter ? (
                <InsertLinePane
                  key={search.addAfter}
                  // The line it goes after: a folded run's last one.
                  after={(() => {
                    const last = graph.data?.nodes.find((node) => node.id === (graph.data?.layout?.chains?.find((item) => item.id === search.addAfter)?.nodeIds.at(-1) ?? search.addAfter));
                    return { speaker: last?.speaker ?? null, text: last?.text ?? null };
                  })()}
                  onAdd={async (line) => {
                    const nodeId = await edits.insertAfter(search.addAfter!, line);
                    if (nodeId) void navigate({ search: (previous) => ({ ...previous, addAfter: undefined }), replace: true });
                  }}
                  onClose={() => void navigate({ search: (previous) => ({ ...previous, addAfter: undefined }), replace: true })}
                />
              ) : !search.node && omittedEdge ? (
                <OmittedPane
                  key={omittedEdge.id}
                  projectId={projectId}
                  edge={omittedEdge}
                  sections={sections}
                  onClose={() => void navigate({ search: (previous) => ({ ...previous, omitted: undefined }), replace: true })}
                  // Opening the source is navigation: the section holding the stretch, centred on its first node.
                  onOpenSource={(section, nodeId) => void navigate({ search: (previous) => ({ ...previous, section: section ?? 'all', scene: undefined, node: nodeId, jump: true, omitted: undefined, viewInfo: undefined, edit: undefined }) })}
                />
              ) : !search.node && viewId ? (
                <ViewInspector
                  projectId={projectId}
                  viewId={viewId}
                  shownNodes={layout ? layout.nodes.length - portals.size : 0}
                  derivedEdges={derivedEdges}
                  onClose={() => void navigate({ search: (previous) => ({ ...previous, viewInfo: undefined }), replace: true })}
                  onDeleted={() => void navigate({ search: (previous) => ({ ...previous, section: undefined, viewInfo: undefined, node: undefined }) })}
                />
              ) : !search.node ? null : search.scope === 'scene' && hubs.has(search.node) ? (
                <Stack as="aside" height="full" variant="body">
                  <PaneHeader kicker="장면 그래프" title="연결점" onClose={() => select(undefined)} />
                  <Text as="p" paddingX="comfortable" paddingY="normal" tone="muted">
                    장면에 속하지 않는 노드 {hubs.get(search.node)!.nodes.toLocaleString()}개가 장면 {hubs.get(search.node)!.scenes.toLocaleString()}개를 잇습니다
                  </Text>
                </Stack>
              ) : search.scope === 'dialogue' ? (
                // One pane for a node and a folded run alike: their lines, read in order.
                <Stack height="full" minHeight={0}>
                  {viewId && reasonOf(search.node) && <ViewReason reason={reasonOf(search.node)!} />}
                  <Box minHeight={0} grow>
                    <FlowPane
                      key={search.node}
                      projectId={projectId}
                      nodeIds={paneNodeIds}
                      ownIds={ownNodes}
                      view={paneView}
                      onView={setPaneView}
                      around={flowAround ? { before: { stop: flowAround.before.stop, more: flowAround.before.more }, after: { stop: flowAround.after.stop, more: flowAround.after.more } } : undefined}
                      onMore={(side) => setSpan((current) => ({ ...current, [side]: current[side] + 10 }))}
                      connections={connections}
                      onSelectNode={select}
                      way={wayInto(search.node)}
                      marked={flowAround && (flowAround.before.ids.length || flowAround.after.ids.length) ? ownNodes : chainOf.has(search.node) ? search.node : undefined}
                      editing={search.edit}
                      onEdit={edit}
                      title={info.get(chainOf.get(search.node) ?? search.node)?.title ?? info.get(chainOf.get(search.node) ?? search.node)?.label ?? ''}
                      onClose={() => select(undefined)}
                    />
                  </Box>
                </Stack>
              ) : search.scope === 'scene' ? (
                <SceneNodeDetail projectId={projectId} groupId={search.node} onClose={() => select(undefined)} />
              ) : null}
            </Box>
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
              onDirectionChange={(next) => void navigate({ search: (previous) => ({ ...previous, direction: next }) })}
              hubs={hubs}
              info={info}
              width={size.width}
              height={size.height}
              selectedId={isPicking ? undefined : search.node ? shown(search.node) : undefined}
              // The node a menu is open on is marked like a selected one while the menu is up.
              selectedIds={!picked.size && contextMenu?.nodeId ? new Set([contextMenu.nodeId]) : picked}
              onSelectMany={isPicking ? undefined : (ids, additive) => {
                setContextMenu(null);
                const next = new Set(additive ? picked : []);
                if (additive && search.node && !next.size) next.add(shown(search.node));
                for (const id of ids) {
                  if (portals.has(id) || id.startsWith('omitted:')) continue;
                  if (additive && ids.length === 1 && next.has(id)) next.delete(id);
                  else next.add(id);
                }
                // A box or ⌘/Ctrl+click picks (ringed), even a single node; only a plain click opens its pane.
                setPicked(next);
                if (search.node) select(undefined);
              }}
              highlight={highlight}
              endpointMarkers={endpointMarkers}
              initialViewport={search.jump ? undefined : readViewport(key)}
              initialFocus={search.jump && search.node ? shown(layout.edges.find((edge) => edge.via === search.node)?.to ?? search.node) : undefined}
              onViewportChange={(viewport) => sessionStorage.setItem(key, JSON.stringify(viewport))}
              onSelect={(id) => {
                setContextMenu(null);
                setPicked(new Set());
                if (!id) {
                  select(undefined);
                  return;
                }
                // A derived edge's label: the stretch it leaves out opens in the pane.
                if (id.startsWith('omitted:')) {
                  if (!isPicking) void navigate({ search: (previous) => ({ ...previous, omitted: id.slice('omitted:'.length), node: undefined, edit: undefined }), replace: true });
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
              // The menu acts on the node under the pointer; the selection (and the detail pane) stays as it was.
              onContextMenu={(rawId, pos) => {
                const nodeId = rawId?.startsWith('omitted:') ? undefined : rawId;
                if (nodeId && !picked.has(nodeId)) setPicked(new Set());
                setContextMenu({ nodeId, x: pos.clientX, y: pos.clientY });
              }}
              // One picked card has the toolbox the other graphs show over a picked item: 복제 · 삭제.
              toolbar={editing && search.node && !picked.size && layout?.nodes.some((node) => node.id === shown(search.node!)) ? {
                id: shown(search.node),
                content: <SelectionToolbox actions={[
                  { id: 'copy', label: '복제', icon: <CopyPlus />, onSelect: () => void paste([search.node!]) },
                  { id: 'delete', label: '삭제', icon: <Trash2 />, onSelect: removePicked },
                ]} />,
              } : sceneEditing && search.node && !picked.size && !hubs.has(search.node) && layout?.nodes.some((node) => node.id === search.node) ? {
                id: search.node,
                content: <SelectionToolbox actions={[
                  { id: 'order', label: '대본 순서로 잇기', icon: <ListOrdered />, onSelect: () => orderScenes([search.node!]) },
                ]} />,
              } : undefined}
              editable={editing}
              onConnect={(fromId, toId) => void edits.connect(fromId, toId)}
              selectedEdgeId={search.edge}
              onToggleFold={toggleFold}
              onSelectEdge={dialogue ? (edgeId) => (edgeId.startsWith('via:') ? select(edgeId.slice('via:'.length)) : edgeId.startsWith('link:') ? undefined : openEdge(edgeId)) : undefined}
              onEdgeContextMenu={editing ? (edgeId, pos) => setContextMenu({ edgeId, x: pos.clientX, y: pos.clientY }) : undefined}
              onOpen={dialogue ? startLine : undefined}
              anchor={
                anchorId && search.edit
                  ? {
                      id: anchorId,
                      content: <LineCard projectId={projectId} unitId={search.edit} choice={flowLines[editAt].choice} position={`${editAt + 1} / ${flowLines.length}`} maxHeight={Math.max(240, size.height - 24)} onShowNode={() => { setPaneView('node'); revealDock?.(); }} onStep={step} onClose={() => edit(undefined)} />,
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
              {search.scope === 'dialogue' && contextMenu.nodeId && picked.size > 1 && picked.has(contextMenu.nodeId) && (
                <DropdownMenuContent width="menu-lg" align="start" side="bottom" sideOffset={2}>
                  <DropdownMenuItem onSelect={() => void runPicked(picked)}>
                    <span>워크플로 실행…</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      setNewName('');
                      setNaming({ nodeIds: realNodes(picked), x: contextMenu.x, y: contextMenu.y });
                    }}
                  >
                    <span>보기 만들기…</span>
                  </DropdownMenuItem>
                  {otherViews.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <span>보기에 추가</span>
                      </DropdownMenuSubTrigger>
                      <Box asChild maxHeight="scroll" overflow="auto"><DropdownMenuSubContent width="menu">
                        {otherViews.map((saved) => (
                          <DropdownMenuItem key={saved.id} onSelect={() => addToView(saved.id, saved.label, picked)}>
                            <Text truncate>{saved.origin === 'ai' ? '✦ ' : ''}{saved.label}</Text>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent></Box>
                    </DropdownMenuSub>
                  )}
                  {viewId && (
                    <DropdownMenuItem onSelect={() => leaveView(picked)}>
                      <span>보기에서 빼기 ({realNodes(picked).length.toLocaleString()})</span>
                    </DropdownMenuItem>
                  )}
                  {editing && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void edits.linkInOrder({ nodeIds: realNodes(picked) })}>
                        <span>대본 순서로 잇기</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void paste([...picked])}>
                        <span>복제 ({picked.size.toLocaleString()}개)</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={removePicked}>
                        <span>삭제 ({picked.size.toLocaleString()}개)</span>
                        <DropdownMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              )}
              {search.scope === 'dialogue' && contextMenu.nodeId && !(picked.size > 1 && picked.has(contextMenu.nodeId)) && (
                <DropdownMenuContent width="menu" align="start" side="bottom" sideOffset={2}>
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
                    <span>이 자리에서 번역</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      select(contextMenu.nodeId);
                      revealDock?.();
                    }}
                  >
                    <span>상세 열기</span>
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
                    <span>번역 화면에서 열기</span>
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
                    <span>경로 시작으로</span>
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
                    <span>경로 끝으로</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {(info.get(contextMenu.nodeId!)?.kind === 'chain' || openedFrom.has(contextMenu.nodeId!)) && (
                    <DropdownMenuItem onSelect={() => toggleFold(openedFrom.get(contextMenu.nodeId!) ?? contextMenu.nodeId!)}>
                      <span>{openedFrom.has(contextMenu.nodeId!) ? '이어진 대사 접기' : '이어진 대사 펼치기'}</span>
                    </DropdownMenuItem>
                  )}
                  {!(graph.data?.nodes.find((item) => item.id === contextMenu.nodeId)?.total === 1 && !contextMenu.nodeId!.startsWith('chain:')) && <DropdownMenuItem
                    onSelect={() => {
                      const id = contextMenu.nodeId!;
                      const nodeKey = info.get(id)?.key ?? id;
                      void navigator.clipboard.writeText(nodeKey);
                      toast.success('노드 키를 복사했습니다.');
                    }}
                  >
                    <span>키 복사</span>
                  </DropdownMenuItem>}
                  {(() => {
                    // A card of one line has the line's own menu (as in the 대사 list); a folded run is several lines.
                    const node = graph.data?.nodes.find((item) => item.id === contextMenu.nodeId);
                    if (!node?.unitId || node.total !== 1 || contextMenu.nodeId!.startsWith('chain:')) return null;
                    return (
                      <>
                        <DropdownMenuSeparator />
                        <LineMenuFor
                          projectId={projectId}
                          unitId={node.unitId}
                          onEditSource={() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { line: node.unitId!, group: node.groupId ?? undefined, sourceAction: 'edit-unit', sourceKind: 'scene' } as never })}
                        />
                      </>
                    );
                  })()}
                  {editing && (
                    <>
                      <DropdownMenuSeparator />
                      {['script', 'chain'].includes(info.get(contextMenu.nodeId!)?.kind ?? '') && (
                        <DropdownMenuItem onSelect={() => void navigate({ search: (previous) => ({ ...previous, addAfter: contextMenu.nodeId, node: undefined, edge: undefined, edit: undefined }), replace: true })}>
                          <span>이 대사 뒤에 대사 추가</span>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => void paste([contextMenu.nodeId!])}>
                        <span>복제</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => copyNodes([contextMenu.nodeId!])}>
                        <span>복사</span>
                        <DropdownMenuShortcut>{keyLabel(GRAPH_KEYS.copy)}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => { void edits.remove({ nodeIds: [contextMenu.nodeId!] }); if (search.node) select(undefined); }}>
                        <span>삭제</span>
                        <DropdownMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  )}
                  {viewId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => leaveView([contextMenu.nodeId!])}>
                        <span>보기에서 빼기</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              )}
              {search.scope === 'scene' && contextMenu.nodeId && (
                <DropdownMenuContent width="menu" align="start" side="bottom" sideOffset={2}>
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
                    <span>장면 열기</span>
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
                    <span>대사 그래프에서 보기</span>
                  </DropdownMenuItem>
                  {scenesOf(contextMenu.nodeId).length > 0 && (
                    <DropdownMenuItem onSelect={() => orderScenes(scenesOf(contextMenu.nodeId!))}>
                      <span>대본 순서로 잇기{scenesOf(contextMenu.nodeId).length > 1 ? ` (${scenesOf(contextMenu.nodeId).length.toLocaleString()}개 장면)` : ''}</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      select(contextMenu.nodeId);
                      revealDock?.();
                    }}
                  >
                    <span>상세 열기</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              )}
              {contextMenu.edgeId && (
                <DropdownMenuContent width="menu" align="start" side="bottom" sideOffset={2}>
                  <DropdownMenuItem onSelect={() => openEdge(contextMenu.edgeId)}>
                    <span>상세 열기</span>
                  </DropdownMenuItem>
                  {edits.canDeleteEdge(contextMenu.edgeId) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void edits.remove({ nodeIds: [], edgeId: contextMenu.edgeId })}>
                        <span>삭제</span>
                        <DropdownMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              )}
              {!contextMenu.nodeId && !contextMenu.edgeId && (
                <DropdownMenuContent width="menu" align="start" side="bottom" sideOffset={2}>
                  {editing && copiedNodes().length > 0 && (
                    <>
                      <DropdownMenuItem onSelect={() => void paste(copiedNodes())}>
                        <span>붙여넣기</span>
                        <DropdownMenuShortcut>{keyLabel(GRAPH_KEYS.paste)}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onSelect={() => canvas.current?.fit()}>
                    <span>화면에 맞춤</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => canvas.current?.zoomTo(1)}>
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
                    <span>{direction === 'vertical' ? '가로 배치' : '세로 배치'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
          )}
          {naming && (
            <Popover open onOpenChange={(open) => !open && setNaming(null)}>
              <PopoverTrigger asChild>
                <span aria-hidden style={{ position: 'fixed', left: naming.x, top: naming.y, width: 1, height: 1, pointerEvents: 'none' }} />
              </PopoverTrigger>
              <Box asChild spaceY="condensed">
              <PopoverContent align="start" width="popover">
                <Input autoFocus value={newName} maxLength={80} aria-label="보기 이름" placeholder="예: 올렉 사망 분기" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && makeView()} />
                <Stack direction="row" justify="end" gap="condensed">
                  <Button variant="ghost" onClick={() => setNaming(null)}>취소</Button>
                  <Button disabled={!newName.trim() || viewActions.create.isPending} onClick={makeView}>보기 만들기</Button>
                </Stack>
              </PopoverContent>
              </Box>
            </Popover>
          )}
          {runUnits && (
            <RunDialog projectId={projectId} unitIds={runUnits} unitsLabel="고른 노드" open onOpenChange={(open) => !open && setRunUnits(undefined)} hideTrigger />
          )}
          {(graph.isPending || graph.data?.status === 'pending') && !relayout && (
            <Overlay asChild><Inline justify="center" gap="condensed" variant="body" tone="muted">
              <Spinner /> 그래프 배치를 계산하는 중…
            </Inline></Overlay>
          )}
          {relayout && (
            <Notice variant="floating" placement="canvas" role="status">
              <Spinner /> 바뀐 내용으로 다시 배치하는 중…
            </Notice>
          )}
          {graph.data?.status === 'failed' && <Text as="p" padding="spacious" variant="body" tone="danger">배치에 실패했습니다: {graph.data.error}</Text>}
          {graph.data?.status === 'missing' || (graph.data?.status === 'ready' && !layout?.nodes.length) ? (
            <EmptyState size="pane" overlay>
                <EmptyHeader>
                  <EmptyTitle>그래프가 없습니다</EmptyTitle>
                  <EmptyDescription>가져온 파일에 그래프 정보가 없습니다.</EmptyDescription>
                </EmptyHeader>
              </EmptyState>
          ) : null}

          {layout && (
            <>
              <CanvasOverlay
                tools={
                  <>
                    <Box position="relative" width="popover-lg" maxWidth="full" minWidth={0} shrink userSelect="none">
                      <SearchField value={search.q} onChange={setFind} placeholder="노드 찾기 (키·라벨·첫 대사)" onCanvas />
                      {matches.length > 0 && (
                        <FoundNodeList>
                          {matches.map((node) => (
                            <li key={node.id}>
                              <Button
                                variant="ghost"
                                size="row"
                                display="flex"
                                width="full"
                                align="start"
                                radius="md"
                                paddingY="tight"
                                textAlign="start"
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
                                <Text width="field-xs" shrink={false} paddingTop="hair" variant="caption" tone="muted">{KIND_LABEL[node.kind] ?? node.kind}</Text>
                                <Text minWidth={0} grow>
                                  <Text display="block" truncate variant="body" tone="default">{node.label ?? node.key}</Text>
                                  {node.preview && <Text display="block" truncate variant="caption" tone="muted">{node.preview}</Text>}
                                </Text>
                              </Button>
                            </li>
                          ))}
                        </FoundNodeList>
                      )}
                    </Box>
                    {search.scope === 'dialogue' && (
                      <SegmentedControl ariaLabel="카드에 보여 줄 것" value={show} onChange={(next) => setShow(next as GraphShow)} items={GRAPH_SHOW_ITEMS} />
                    )}
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
                    {picked.size > 1 && (
                      <Chip as="p" variant="note">
                        노드 {picked.size.toLocaleString()}개 선택
                      </Chip>
                    )}
                    {view && viewDetail.data && (
                      <Chip as="div" variant="bar" removable>
                        <span>
                          보기 "{view.label}" · 남김 {view.nodes.toLocaleString()} · 생략 구간 {derivedEdges.toLocaleString()} · {viewDetail.data.origin === 'ai' ? 'AI' : '직접'}
                          {viewDetail.data.missing.length > 0 && <Text tone="danger"> · 원본에 없음 {viewDetail.data.missing.length.toLocaleString()}</Text>}
                        </span>
                        <Button variant="ghost" onClick={() => void navigate({ search: (previous) => ({ ...previous, viewInfo: true, node: undefined, omitted: undefined, edit: undefined }), replace: true })}>
                          보기
                        </Button>
                      </Chip>
                    )}
                    {search.mark && mark.data && layout && (
                      <Chip as="div" variant="bar" removable>
                        <Chip.Dot />
                        <span>
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
                      </Chip>
                    )}
                    {hidden.length > 0 && (
                      <Chip as="label" variant="bar" tone="muted">
                        <Switch
                          checked={search.links === 'all'}
                          onCheckedChange={(on) => void navigate({ search: (previous) => ({ ...previous, links: on ? 'all' : undefined }), replace: true })}
                        />
                        장면 경유 연결 {hidden.length.toLocaleString()}
                      </Chip>
                    )}
                  </>
                }
              />

              {/* Minimal floating zoom bar (Figma / Miro style) */}
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
