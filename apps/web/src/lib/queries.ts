import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { client, unwrap } from './api';

/**
 * Query keys start with the server's change topic (see server events.ts), so an SSE
 * "units changed" event refetches exactly the queries that show units.
 */
export const q = {
  projects: () => queryOptions({ queryKey: ['projects'], queryFn: () => unwrap(client.projects.$get()) }),
  project: (projectId: string) =>
    queryOptions({ queryKey: ['units', 'project', projectId], queryFn: () => unwrap(client.projects[':projectId'].$get({ param: { projectId } })) }),
  statuses: (projectId: string) =>
    queryOptions({ queryKey: ['statuses', projectId], queryFn: () => unwrap(client.projects[':projectId'].statuses.$get({ param: { projectId } })) }),
  groups: (projectId: string, query: { kind?: 'scene' | 'document' | 'ui'; q?: string } = {}) =>
    queryOptions({ queryKey: ['units', 'groups', projectId, query], queryFn: () => unwrap(client.projects[':projectId'].groups.$get({ param: { projectId }, query })) }),
  group: (groupId: string) => queryOptions({ queryKey: ['units', 'group', groupId], queryFn: () => unwrap(client.groups[':groupId'].$get({ param: { groupId } })) }),
  units: (projectId: string, query: { groupId?: string; kind?: 'scene' | 'document' | 'ui'; statusId?: string; tagId?: string; q?: string; offset?: number; limit?: number }) =>
    queryOptions({
      queryKey: ['units', 'list', projectId, query],
      queryFn: () =>
        unwrap(
          client.projects[':projectId'].units.$get({
            param: { projectId },
            query: { ...query, offset: query.offset?.toString(), limit: query.limit?.toString() } as never,
          }),
        ),
      placeholderData: keepPreviousData,
    }),
  unit: (unitId: string) => queryOptions({ queryKey: ['units', 'detail', unitId], queryFn: () => unwrap(client.units[':unitId'].$get({ param: { unitId } })) }),
  graph: (projectId: string, scope: 'scene' | 'dialogue') =>
    queryOptions({
      queryKey: ['graph', projectId, scope],
      queryFn: () => unwrap(client.projects[':projectId'].graph[':scope{dialogue|scene}'].$get({ param: { projectId, scope } })),
      staleTime: Infinity,
    }),
  graphNode: (nodeId: string) => queryOptions({ queryKey: ['units', 'graph-node', nodeId], queryFn: () => unwrap(client['graph-nodes'][':nodeId'].$get({ param: { nodeId } })) }),
  terms: (projectId: string) => queryOptions({ queryKey: ['terms', projectId], queryFn: () => unwrap(client.projects[':projectId'].terms.$get({ param: { projectId } })) }),
  termUsage: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['terms', 'usage', id], queryFn: () => unwrap(client.projects[':projectId'].terms[':id'].usage.$get({ param: { projectId, id } })) }),
  documents: (projectId: string) => queryOptions({ queryKey: ['knowledge', 'documents', projectId], queryFn: () => unwrap(client.projects[':projectId'].documents.$get({ param: { projectId } })) }),
  characters: (projectId: string) =>
    queryOptions({ queryKey: ['knowledge', 'characters', projectId], queryFn: () => unwrap(client.projects[':projectId'].characters.$get({ param: { projectId } })) }),
  connections: () => queryOptions({ queryKey: ['connections'], queryFn: () => unwrap(client.connections.$get()) }),
  profiles: () => queryOptions({ queryKey: ['profiles'], queryFn: () => unwrap(client.profiles.$get()) }),
  workflows: (projectId: string) =>
    queryOptions({ queryKey: ['workflows', projectId], queryFn: () => unwrap(client.projects[':projectId'].workflows.$get({ param: { projectId } })) }),
  workflow: (id: string) => queryOptions({ queryKey: ['workflows', 'detail', id], queryFn: () => unwrap(client.workflows[':id'].$get({ param: { id } })) }),
  runs: (projectId: string) => queryOptions({ queryKey: ['runs', projectId], queryFn: () => unwrap(client.projects[':projectId'].runs.$get({ param: { projectId } })) }),
  run: (id: string) => queryOptions({ queryKey: ['runs', 'detail', id], queryFn: () => unwrap(client.runs[':id'].$get({ param: { id } })) }),
  runItems: (id: string, query: { state?: string; nodeId?: string; offset?: number }) =>
    queryOptions({
      queryKey: ['runs', 'items', id, query],
      queryFn: () => unwrap(client.runs[':id'].items.$get({ param: { id }, query: { ...query, offset: query.offset?.toString() } as never })),
      placeholderData: keepPreviousData,
    }),
  runSteps: (id: string) => queryOptions({ queryKey: ['runs', 'steps', id], queryFn: () => unwrap(client.runs[':id'].steps.$get({ param: { id } })) }),
  reviews: (projectId: string) => queryOptions({ queryKey: ['units', 'reviews', projectId], queryFn: () => unwrap(client.projects[':projectId'].reviews.$get({ param: { projectId } })) }),
  /** Proposals of one pi chat, or (no session) those sent from the CLI. */
  proposals: (projectId: string, session?: string) =>
    queryOptions({
      queryKey: ['proposals', projectId, session ?? 'external'],
      queryFn: () => unwrap(client.projects[':projectId'].proposals.$get({ param: { projectId }, query: session ? { session } : {} })),
    }),
  chatSessions: (projectId: string) => queryOptions({ queryKey: ['chat', projectId], queryFn: () => unwrap(client.projects[':projectId'].chat.$get({ param: { projectId } })) }),
  chatSession: (sessionId: string) =>
    queryOptions({ queryKey: ['chat', 'session', sessionId], queryFn: () => unwrap(client.chat[':sessionId'].$get({ param: { sessionId } })), staleTime: Infinity }),
};
