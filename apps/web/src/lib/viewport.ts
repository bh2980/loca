import { useCallback } from 'react';
import { stored, STORED, type Viewport } from './storage';

export type { Viewport };

/**
 * The one way a graph remembers where it was left: its pan and zoom, kept for the tab (AGENTS.md "Page state":
 * viewports live in the tab's storage, never in history, so panning adds no entries) per project, graph and scope.
 * The scope says what the graph was showing (a section and direction, a workflow, a run): the same graph showing
 * something else opens where that was left, or at its own start.
 */
export type ViewportGraph = 'source' | 'route' | 'relationships' | 'events' | 'workflow' | 'run';

/** A scope from its parts: `viewportScope('dialogue', 'vertical', section)`; an absent part is empty, so the places stay apart. */
export const viewportScope = (...parts: (string | undefined | null)[]) => parts.map((part) => part ?? '').join('.');

/**
 * A short name for a long description of what a graph shows (which people, which events and lines), to use as a
 * scope: the same set opens where it was left, another set at its own start.
 */
export function shortKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export const viewportSlot = (projectId: string, graph: ViewportGraph, scope = '') => stored(STORED.viewport, projectId, graph, scope);

/**
 * `initial`: what is kept for this key now. A graph reads it when it places itself: when it mounts, and (the source
 * graph) when its layout is made again, so the view stays where it was through an edit or an opened run.
 * `save`: called when a pan or zoom ends.
 */
export function useStoredViewport(projectId: string, graph: ViewportGraph, scope = '') {
  const slot = viewportSlot(projectId, graph, scope);
  const key = slot.key;
  const save = useCallback((viewport: Viewport) => viewportSlot(projectId, graph, scope).write({ x: viewport.x, y: viewport.y, zoom: viewport.zoom }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { initial: slot.read() ?? undefined, save };
}
