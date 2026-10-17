import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { effectivePicks } from './next-route.ts';
import { buildSlice, graphKey, type RouteSlice } from './route-slice.ts';

// Kept apart from route-slice.ts: the slice needs the route picks (next-route.ts), which build on route-slice.
const cache = new Map<string, { key: string; slice: RouteSlice }>();

/** The project's slice with its stored picks (round 1 with no history: the best route under a person's picks); kept until the graph, the lines or the picks change. */
export function projectSlice(db: Db, projectId: string): RouteSlice {
  const row = db.select({ picks: s.projects.routePicks, state: s.projects.routeState }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  const manual = row?.picks ?? {};
  // The routes of the earlier rounds decide the seams, so they belong to the cache key.
  const history = row?.state.history ?? [];
  const graph = graphKey(db, projectId);
  const key = JSON.stringify([manual, history, row?.state.round ?? 1, graph]);
  const hit = cache.get(projectId);
  if (hit?.key === key) return hit.slice;
  const slice = buildSlice(db, projectId, effectivePicks(db, projectId, row, graph), history, manual);
  cache.set(projectId, { key, slice });
  return slice;
}
