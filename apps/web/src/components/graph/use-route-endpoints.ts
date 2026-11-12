import { useMemo } from 'react';
import { useGraphNodes } from '@/lib/graph';
import { endpointLabel } from './endpoint-label';

export interface RouteEndpoint {
  id: string;
  label: string;
}

/**
 * The two ends of a reading route as the endpoint bar shows them (endpoint-label.ts), read from their nodes. An end
 * is absent until its node has arrived (and when it belongs to another project: a link carried over).
 */
export function useRouteEndpoints(projectId: string, ends: { start?: string; end?: string }): { start?: RouteEndpoint; end?: RouteEndpoint } {
  const ids = useMemo(() => [...new Set([ends.start, ends.end].filter((id): id is string => Boolean(id)))], [ends.start, ends.end]);
  const details = useGraphNodes(projectId, ids);
  const value = (id: string | undefined, role: 'start' | 'end') => {
    const detail = id ? details[ids.indexOf(id)]?.data : undefined;
    return id && detail?.projectId === projectId ? { id, label: endpointLabel(detail, role) } : undefined;
  };
  return { start: value(ends.start, 'start'), end: value(ends.end, 'end') };
}
