import { useMemo, useRef } from 'react';
import { queryOptions, useQueries } from '@tanstack/react-query';
import type { InferRequestType, InferResponseType } from 'hono/client';
import { client, unwrap } from './api';
import { sent } from './collections';
import { key } from './query-keys';
import { useLines, type Line } from './units';

/**
 * The dialogue and scene graphs: their layouts (graph topic: laid out on the server, asked again when the graph
 * changes), a node's detail, the reading route between two lines, and the edits the graph page makes.
 */
type GraphApi = (typeof client.projects)[':projectId']['graph'];
type Direction = 'vertical' | 'horizontal';

/** The dialogue graph's sections, each laid out on its own. */
export const graphSections = (projectId: string, direction: Direction = 'vertical') =>
  queryOptions({ queryKey: key('graph', 'sections', projectId, direction), queryFn: () => unwrap(client.projects[':projectId'].graph.sections.$get({ param: { projectId }, query: { direction } })), staleTime: Infinity });

/** A graph's layout. `section`: one section's own dialogue layout (dialogue scope only). */
export const graphLayout = (projectId: string, scope: 'scene' | 'dialogue', section?: string, direction: Direction = 'vertical') =>
  queryOptions({
    queryKey: key('graph', 'layout', projectId, scope, direction, section ?? ''),
    queryFn: () => unwrap(client.projects[':projectId'].graph[':scope{dialogue|scene}'].$get({ param: { projectId, scope }, query: { ...(section && { section }), direction } })),
    staleTime: Infinity,
  });

/** One stored line of the dialogue graph: its two ends and where it comes from. */
export const graphEdge = (projectId: string, edgeId: string) =>
  queryOptions({ queryKey: key('graph', 'edge', projectId, edgeId), queryFn: () => unwrap(client.projects[':projectId'].graph.edges[':edgeId'].$get({ param: { projectId, edgeId } })) });

/** The reading route between two lines (keyed under units; graph implies it: it walks the graph's nodes and edges). */
export const readingRoute = (projectId: string, query: { start?: string; end?: string; via?: string }) =>
  queryOptions({ queryKey: key('units', 'reading-route-between', projectId, query), queryFn: () => unwrap(client.projects[':projectId']['reading-route'].$get({ param: { projectId }, query })) });

/**
 * A graph node's own facts: its kind, type, scene, neighbours, and its lines by id with the speech level each one's
 * rule asks for (worked out per line). The lines themselves are the units collection's (useGraphNodes). Keyed under
 * units: the speech level follows the lines' listeners; graph and knowledge imply units.
 */
export const graphNode = (projectId: string, nodeId: string) =>
  queryOptions({ queryKey: key('units', 'graph-node', projectId, nodeId), queryFn: () => unwrap(client['graph-nodes'][':nodeId'].$get({ param: { nodeId }, query: { projectId } })) });
type GraphNodeAnswer = InferResponseType<(typeof client)['graph-nodes'][':nodeId']['$get']>;
/** A node with its lines: each the browser's row of the line, with its speech level. */
export type GraphNodeDetail = Omit<GraphNodeAnswer, 'lines'> & { units: (Line & { level: GraphNodeAnswer['lines'][number]['level'] })[] };

/**
 * Graph nodes with their lines, in the order asked: each node's answer joined with the lines from the units
 * collection (loading the ones not held). A node's `data` is there once its answer and all its lines are.
 */
export function useGraphNodes(projectId: string, nodeIds: readonly string[]) {
  const answers = useQueries({ queries: nodeIds.map((id) => graphNode(projectId, id)) });
  const lineIds = useMemo(() => [...new Set(answers.flatMap((answer) => answer.data?.lines.map((line) => line.id) ?? []))], [answers]);
  const { byId } = useLines(projectId, lineIds);
  // A node's joined detail stays the same object while its answer and its lines' rows do: screens compare it by identity.
  const joined = useRef(new Map<string, { node: GraphNodeAnswer; rows: Line[]; data: GraphNodeDetail }>());
  return answers.map((answer, index) => {
    const node = answer.data;
    const rows = node?.lines.map((line) => byId.get(line.id));
    let data: GraphNodeDetail | undefined;
    if (node && rows && rows.every((row): row is Line => row !== undefined)) {
      const before = joined.current.get(nodeIds[index]!);
      if (before && before.node === node && before.rows.length === rows.length && before.rows.every((row, at) => row === rows[at])) data = before.data;
      else {
        const { lines, ...rest } = node;
        data = { ...rest, units: lines.map((line, at) => ({ ...rows[at]!, level: line.level })) };
        joined.current.set(nodeIds[index]!, { node, rows, data });
      }
    }
    return { data, isPending: !data && !answer.isError, isError: answer.isError, error: answer.error };
  });
}

// ── edits (services/graph-edit.ts on the server): each answers with the token that takes it back (lib/undo.ts) ──

export function graphEdits(projectId: string) {
  const graph = client.projects[':projectId'].graph;
  const param = { projectId };
  return {
    connect: (fromId: string, toId: string) => sent(projectId, graph.edges.$post({ param, json: { fromId, toId } })),
    deleteEdges: (ids: string[]) => sent(projectId, graph.edges.delete.$post({ param, json: { ids } })),
    /** `bridge`: keep the way through the deleted nodes. */
    deleteNodes: (ids: string[], bridge: boolean) => sent(projectId, graph.nodes.delete.$post({ param, json: { ids, bridge } })),
    /** "대본 순서로 잇기" for scenes and/or nodes. */
    linkInOrder: (json: InferRequestType<GraphApi['link-in-order']['$post']>['json']) => sent(projectId, graph['link-in-order'].$post({ param, json })),
    /** A new line after a node. */
    insertAfter: (nodeId: string, line: InferRequestType<GraphApi['nodes'][':nodeId']['after']['$post']>['json']) => sent(projectId, graph.nodes[':nodeId'].after.$post({ param: { projectId, nodeId }, json: line })),
    duplicate: (ids: string[]) => sent(projectId, graph.nodes.duplicate.$post({ param, json: { ids } })),
  };
}
