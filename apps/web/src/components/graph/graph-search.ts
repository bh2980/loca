/**
 * The graph page's search params, in one place: what each one means, how the URL is read (`validateGraphSearch`),
 * what the page derives from them, and every change the page makes to them (`graphSearch.*`, each a function from
 * the search as it is to the search after). The URL is the page's state (AGENTS.md "Page state"); viewports and
 * preferences are not here (lib/viewport.ts, lib/graph-show.ts).
 */
import { param, searchParams, type SearchOf } from '@/lib/search';

export type GraphScope = 'scene' | 'dialogue';
type GraphDirection = 'vertical' | 'horizontal';
type RouteEnd = 'start' | 'end';

const graphSearchParams = {
  /** The open inspector's tab (lib/inspector-tab.ts). */
  pane: param.text,
  scope: param.oneOfOr<GraphScope>(['scene', 'dialogue'], 'dialogue'),
  direction: param.oneOf<GraphDirection>(['vertical', 'horizontal']),
  /** A reading route's two ends, applied: with both, the page shows the route (its graph and script). */
  routeStart: param.text,
  routeEnd: param.text,
  /** The ends while they are being picked on the graph; `routeStart`/`routeEnd` stay as they were until 경로 찾기. */
  pickStart: param.text,
  pickEnd: param.text,
  /** Which end the next click picks; present, the page is picking. */
  pickStep: param.oneOf<RouteEnd>(['start', 'end']),
  node: param.text,
  scene: param.text,
  /** Dialogue graph section (chapter, act, day…) or a view ("view:<id>"); "all" draws the whole graph on one sheet. Absent = the first section. */
  section: param.text,
  /** Highlight one node type (original class name, or "kind:<kind>"). */
  type: param.text,
  /** Also draw scene links hidden by the simplification (reachable through other scenes). */
  links: param.oneOf(['all']),
  /** Arrived from a line ("그래프에서 보기"): open centred on `node`, then forget it. */
  jump: param.flag,
  /** A stored view (made in the chat) whose nodes are highlighted. */
  mark: param.text,
  /** The line open in the translation card beside its node (dialogue graph). */
  edit: param.text,
  /** The right pane shows the open view's own details (name, request, counts). */
  viewInfo: param.flag,
  /** An open route view laid out as 그래프 + 대본: its graph beside its lines in reading order. */
  script: param.flag,
  /** The right pane lists what a derived edge leaves out (the edge's id in the open layout). */
  omitted: param.text,
  /** Node finder text (matches are listed under the box). */
  q: param.text,
  /** A line of the dialogue graph picked (its drawn id): its pane shows where it comes from, 삭제. */
  edge: param.text,
  /** 이 대사 뒤에 대사 추가: the node a new line goes after (its pane is open). */
  addAfter: param.text,
  /** The folded runs drawn as their lines (their ids). Absent: a small graph opens them all, a big one none; `[]` is none. */
  open: param.list,
};
export type GraphSearch = SearchOf<typeof graphSearchParams>;
export const validateGraphSearch = searchParams(graphSearchParams);

// ── what the page reads off the search ──────────────────────────────────────────

/** The ends of a route are being picked on the dialogue graph. */
export const isPickingRoute = (search: GraphSearch) => search.scope === 'dialogue' && Boolean(search.pickStep || search.pickStart || search.pickEnd);
/** A route picked but not saved yet: its graph and script. */
export const isUnsavedRoute = (search: GraphSearch) => search.scope === 'dialogue' && Boolean(search.routeStart && search.routeEnd && !search.pickStep);
/** The two ends as they stand: the picked ones, else the applied route's. */
export const routeEnds = (search: GraphSearch): { start?: string; end?: string } => ({ start: search.pickStart ?? search.routeStart, end: search.pickEnd ?? search.routeEnd });
/** Which end the next click picks: the one asked for, else the end once a start is picked, else the start. */
export const pickingEnd = (search: GraphSearch): RouteEnd => search.pickStep ?? (search.pickStart && !search.pickEnd ? 'end' : 'start');
/** The id of the view a section names ("view:<id>"). */
export const viewIdOf = (section: string | undefined) => (section?.startsWith('view:') ? section.slice('view:'.length) : undefined);
const viewSection = (viewId: string) => `view:${viewId}`;

// ── every change the page makes ────────────────────────────────────────────────

export type GraphSearchChange = (previous: GraphSearch) => GraphSearch;

const NO_ROUTE = { routeStart: undefined, routeEnd: undefined, pickStart: undefined, pickEnd: undefined, pickStep: undefined } as const;
/** What a pane shows of the current section; another section or view starts without it. */
const NO_PANE = { node: undefined, omitted: undefined, viewInfo: undefined } as const;

export const graphSearch = {
  // modes and layout
  /** The dialogue graph or the scene graph: a route belongs to the dialogue graph, so it goes. */
  mode: (scope: GraphScope): GraphSearchChange => (previous) => ({ ...previous, scope, ...NO_ROUTE, script: undefined }),
  direction: (direction: GraphDirection): GraphSearchChange => (previous) => ({ ...previous, direction }),
  /** A section or a view opened from the menu: the pane's selection does not carry over. */
  section: (section: string | undefined): GraphSearchChange => (previous) => ({ ...previous, section, ...NO_PANE }),
  /** The same from a route view's own menu: picking the view that is open keeps its script. */
  sectionFromScript: (section: string | undefined): GraphSearchChange => (previous) => ({ ...previous, section, script: section === previous.section ? true : undefined, edit: undefined, ...NO_PANE }),
  /** 그래프 | 그래프 + 대본 of a route view. */
  script: (on: boolean): GraphSearchChange => (previous) => ({ ...previous, script: on || undefined, edit: undefined, ...NO_PANE }),
  /** The open view is gone: the whole graph again. */
  viewDeleted: (): GraphSearchChange => (previous) => ({ ...previous, section: undefined, script: undefined, edit: undefined, ...NO_PANE }),
  /** Nodes were saved as a view: it opens. */
  viewMade: (viewId: string): GraphSearchChange => (previous) => ({ ...previous, section: viewSection(viewId), edit: undefined, ...NO_PANE }),
  /** A scene's lines in the dialogue graph (its section opens, its nodes highlighted). */
  sceneInDialogue: (scene: string): GraphSearchChange => (previous) => ({ ...previous, scope: 'dialogue', scene }),
  /** A portal to a scene shown in its own section: a fresh look at the dialogue graph there. */
  sceneAlone: (scene: string): GraphSearchChange => () => ({ scope: 'dialogue', scene }),
  /** A portal to the section the lines continue in. */
  portalSection: (section: string): GraphSearchChange => (previous) => ({ ...previous, section, scene: undefined, ...NO_PANE }),
  /** The stretch a derived edge leaves out, opened in the graph it comes from, centred on its first node. */
  omittedSource: (section: string | undefined, node: string): GraphSearchChange => (previous) => ({ ...previous, section: section ?? 'all', scene: undefined, node, jump: true, omitted: undefined, viewInfo: undefined, edit: undefined }),
  /** Arriving from a line: its scene only picked the section. */
  jumpSection: (section: string | undefined): GraphSearchChange => (previous) => ({ ...previous, section, scene: undefined }),
  jumpDone: (): GraphSearchChange => (previous) => ({ ...previous, jump: undefined }),

  // the selection and its panes (one thing is open at a time)
  /** A node opened (or none): a line, an insert pane and the translation card give way. */
  node: (node: string | undefined): GraphSearchChange => (previous) => ({ ...previous, node, edit: undefined, edge: undefined, addAfter: undefined, omitted: node ? undefined : previous.omitted }),
  /** The selection moved along the flow while translating; the card opens on its line once it has arrived. */
  nodeAlongFlow: (node: string): GraphSearchChange => (previous) => ({ ...previous, node, edit: undefined }),
  edit: (edit: string | undefined): GraphSearchChange => (previous) => ({ ...previous, edit }),
  edge: (edge: string | undefined): GraphSearchChange => (previous) => ({ ...previous, edge, node: undefined, edit: undefined, addAfter: undefined }),
  addAfter: (addAfter: string | undefined): GraphSearchChange => (previous) => (addAfter ? { ...previous, addAfter, node: undefined, edge: undefined, edit: undefined } : { ...previous, addAfter: undefined }),
  omitted: (omitted: string | undefined): GraphSearchChange => (previous) => (omitted ? { ...previous, omitted, node: undefined, edit: undefined } : { ...previous, omitted: undefined }),
  viewInfo: (on: boolean): GraphSearchChange => (previous) => (on ? { ...previous, viewInfo: true, node: undefined, omitted: undefined, edit: undefined } : { ...previous, viewInfo: undefined }),
  /** Which folded runs are drawn as their lines; `moved` says where the selection stands once its run is drawn the other way. */
  open: (open: string[], moved?: (node: string) => string | undefined): GraphSearchChange => (previous) => ({ ...previous, open, ...(previous.node && moved && { node: moved(previous.node) }) }),

  // what is shown on the canvas
  find: (q: string | undefined): GraphSearchChange => (previous) => ({ ...previous, q }),
  type: (type: string | undefined): GraphSearchChange => (previous) => ({ ...previous, type }),
  links: (all: boolean): GraphSearchChange => (previous) => ({ ...previous, links: all ? 'all' : undefined }),
  markSection: (section: string): GraphSearchChange => (previous) => ({ ...previous, section, node: undefined }),
  unmark: (): GraphSearchChange => (previous) => ({ ...previous, mark: undefined }),

  // a reading route: pick two ends, apply, save
  /** 새 경로: the next click on the graph picks the start. */
  newRoute: (): GraphSearchChange => (previous) => ({ ...previous, script: undefined, pickStep: 'start', node: undefined, edit: undefined }),
  /** Picking again from a route shown: its ends are the ones to change. */
  repick: (step: RouteEnd = 'start'): GraphSearchChange => (previous) => ({ ...previous, pickStart: previous.routeStart, pickEnd: previous.routeEnd, pickStep: step, node: undefined, edit: undefined }),
  pickStep: (step: RouteEnd): GraphSearchChange => (previous) => ({ ...previous, pickStep: step }),
  /** A node picked as an end on the graph; either way the end is picked next (the start is picked once, the end until it suits). */
  pick: (end: RouteEnd, node: string): GraphSearchChange => (previous) => ({ ...previous, ...(end === 'start' ? { pickStart: node } : { pickEnd: node }), pickStep: 'end', node: undefined, edit: undefined }),
  /** 경로 시작으로 (a node's menu): the start is this node, the end is picked next. */
  startAt: (node: string): GraphSearchChange => (previous) => ({ ...previous, scope: 'dialogue', pickStart: node, pickStep: 'end', node: undefined, edit: undefined }),
  /** 경로 끝으로: with a start already there the route is shown, else the start is picked next. */
  endAt: (node: string): GraphSearchChange => (previous) => {
    const start = routeEnds(previous).start;
    return start
      ? { ...previous, scope: 'dialogue', ...NO_ROUTE, routeStart: start, routeEnd: node, node: undefined, edit: undefined }
      : { ...previous, scope: 'dialogue', pickEnd: node, pickStep: 'start', node: undefined, edit: undefined };
  },
  /** 경로 찾기: the picked ends become the route (nothing changes until both are there). */
  applyRoute: (): GraphSearchChange => (previous) => {
    const { start, end } = routeEnds(previous);
    return start && end ? { ...previous, ...NO_ROUTE, routeStart: start, routeEnd: end, node: undefined, edit: undefined } : previous;
  },
  clearRoute: (): GraphSearchChange => (previous) => ({ ...previous, ...NO_ROUTE, node: undefined, edit: undefined }),
  /** The route shown was saved as a view: it opens as that view with its script, and the draft leaves the URL. */
  routeSaved: (viewId: string): GraphSearchChange => (previous) => ({ ...previous, ...NO_ROUTE, section: viewSection(viewId), script: true, ...NO_PANE }),
};
