import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGraphShow } from '@/lib/graph-show';
import { useGraphViews } from '@/lib/graph-views';
import { usePersonColors } from '@/lib/person-colors';
import { q } from '@/lib/queries';
import { useLines } from '@/lib/units';
import { flowModel, hiddenEdgeLines } from './flow-model';
import type { LayoutEdge } from './graph-canvas';
import { viewIdOf, type GraphSearch } from './graph-search';
import { findNodes, highlighted, nodeCards } from './node-cards';
import { AUTO_OPEN_NODES, unfoldChains } from './unfold-chains';

const NO_HIDDEN: { from: string; to: string }[] = [];

/**
 * The graph as the page draws it, from what the URL asks for: which section or view (the first section when none is
 * named), its layout from the server with the open runs drawn as their lines (done here on the stored layout:
 * opening a run takes no layout calculation), what each card says, the traversal model over it, and what is
 * highlighted or found. Everything here follows the server's answers and the search; the page's own state
 * (selection, menus) is not here.
 */
export function useDrawnGraph(projectId: string, search: GraphSearch) {
  const dialogue = search.scope === 'dialogue';
  const direction = search.direction ?? 'vertical';
  // The section list is small and separate: the default section (the first, or the one holding `scene`) is known
  // before any layout is loaded.
  const sectionList = useQuery({ ...q.graphSections(projectId, direction), enabled: dialogue });
  const sections = dialogue ? (sectionList.data ?? []) : [];
  const chosen = !dialogue || search.section === 'all' ? undefined : search.section ?? (sections.length > 1 ? (sections.find((section) => section.groupIds.includes(search.scene ?? ''))?.name ?? sections[0]!.name) : undefined);
  const query = useQuery({ ...q.graph(projectId, search.scope, chosen, direction), enabled: !dialogue || !!search.section || sectionList.isSuccess });

  // Folded runs are drawn as their lines when asked (`open`), or all of them in a graph small enough to read.
  const foldedRuns = query.data?.layout?.chains;
  const autoOpen = (query.data?.nodes.length ?? Infinity) <= AUTO_OPEN_NODES;
  const openRuns = useMemo(() => new Set(search.open ?? (autoOpen ? (foldedRuns ?? []).map((run) => run.id) : [])), [search.open, autoOpen, foldedRuns]);
  const data = useMemo(() => (query.data?.layout ? { ...query.data, layout: unfoldChains(query.data.layout, openRuns, direction) } : query.data), [query.data, openRuns, direction]);
  const layout = data?.layout;
  /** The open run each of its lines belongs to (to fold it again from any of them). */
  const openedFrom = useMemo(() => new Map((foldedRuns ?? []).filter((run) => openRuns.has(run.id)).flatMap((run) => run.nodeIds.map((id) => [id, run.id] as const))), [foldedRuns, openRuns]);
  const model = useMemo(() => flowModel(layout), [layout]);

  // What the cards show of each line (the side pane follows the same setting). The translations come apart from the
  // layout (it does not change when a line is saved): each card's line is in the layout, its translation is the
  // line's, from the units collection (the feed keeps it current).
  const [show, setShow] = useGraphShow();
  const shownLines = useMemo(() => (dialogue && show !== 'source' ? query.data?.nodes?.flatMap((node) => (node.unitId ? [node.unitId] : [])) : undefined), [dialogue, show, query.data]);
  const cardLines = useLines(projectId, shownLines).byId;
  const translations = useMemo(() => {
    if (!shownLines) return undefined;
    const byNode: Record<string, string> = {};
    for (const node of query.data?.nodes ?? []) {
      const text = node.unitId ? cardLines.get(node.unitId)?.translation?.trim().slice(0, 120) : null;
      if (text) byNode[node.id] = text;
    }
    return byNode;
  }, [shownLines, query.data, cardLines]);
  const colorOf = usePersonColors(projectId);
  const info = useMemo(
    () => nodeCards({ nodes: data?.nodes ?? [], nodeTypes: data?.nodeTypes, portals: layout?.portals, chains: layout?.chains, foldable: foldedRuns, openRuns, show, translations, colorOf }),
    [data, layout, colorOf, foldedRuns, openRuns, show, translations],
  );
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node] as const)), [data]);
  const portals = useMemo(() => new Map((layout?.portals ?? []).map((portal) => [portal.id, portal])), [layout]);
  const hubs = useMemo(() => new Map((!dialogue ? (layout?.hubs ?? []) : []).map((hub) => [hub.id, hub])), [layout, dialogue]);

  // A view laid out on its own (the chat's show_graph, mode "only"), and the stored views there are.
  const viewId = viewIdOf(chosen);
  const viewDetail = useQuery({ ...q.graphView(projectId, viewId ?? ''), enabled: !!viewId });
  const view = viewId && layout?.view ? { ...layout.view, label: viewDetail.data?.label ?? layout.view.label } : undefined;
  const savedViews = useGraphViews(projectId, { enabled: dialogue }).data ?? [];

  // Nodes the chat asked to highlight (show_graph, mode "mark"); the canvas waits for them so it opens on them.
  const mark = useQuery({ ...q.graphView(projectId, search.mark ?? ''), enabled: dialogue && !!search.mark });
  const marking = dialogue && !!search.mark && mark.isPending;
  const highlight = useMemo(() => {
    if (!data) return undefined;
    const ids = highlighted(data.nodes, { mark: dialogue && search.mark ? mark.data?.nodeIds : undefined, type: search.type, scene: dialogue ? search.scene : undefined });
    // Nodes inside a folded run are highlighted through their block.
    if (ids) for (const id of [...ids]) if (model.chainOf.has(id)) ids.add(model.chainOf.get(id)!);
    return ids;
  }, [data, dialogue, search.scene, search.type, search.mark, mark.data, model]);
  const matches = useMemo(() => findNodes(data?.nodes ?? [], search.q ?? '', translations), [search.q, data, translations]);

  // Scene links the simplification hides are drawn as straight lines between the laid-out boxes when asked.
  const hidden = (!dialogue && layout?.hiddenEdges) || NO_HIDDEN;
  const edges = useMemo<LayoutEdge[]>(
    () => (layout && search.links === 'all' && hidden.length ? [...layout.edges, ...hiddenEdgeLines(layout.nodes, hidden, direction)] : (layout?.edges ?? [])),
    [layout, hidden, search.links, direction],
  );

  // A layout being made again (after an edit) keeps the last one on screen until the new one arrives.
  const relayout = data?.status === 'pending' && Boolean(layout);
  return {
    direction, sections, chosen, data, isPending: query.isPending, layout, relayout,
    foldedRuns, openRuns, openedFrom, model, show, setShow, translations, info, nodeById, portals, hubs,
    viewId, viewDetail, view, savedViews, mark, marking, highlight, matches, hidden, edges,
    derivedEdges: edges.filter((edge) => edge.derived).length,
  };
}

export type DrawnGraphData = ReturnType<typeof useDrawnGraph>;
