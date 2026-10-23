import { infiniteQueryOptions, keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { ATTACH_PAGE, REVIEW_TAG, normalizeTagScopes, type AttachKind, type DetectedCustomFormatRule, type DetectedFormatPreset, type FormatPreset, type MarkColors, type TagScope } from '@tw/shared';
import { client, unwrap } from './api';

/**
 * Query keys start with the server's change topic (see server events.ts), so an SSE
 * "units changed" event refetches exactly the queries that show units.
 */
export const q = {
  detectFormatRules: (projectId: string) =>
    queryOptions({
      queryKey: ['units', 'detect-format-rules', projectId],
      queryFn: () =>
        unwrap((client.projects[':projectId'] as any)['detect-format-rules'].$get({ param: { projectId } })) as Promise<{
          presets: DetectedFormatPreset[];
          customCandidates: DetectedCustomFormatRule[];
          recommendedPresets: FormatPreset[];
        }>,
    }),
  readingRoute: (projectId: string, query: { start?: string; end?: string; via?: string }) => queryOptions({
    queryKey: ['units', 'reading-route-between', projectId, query],
    queryFn: () => unwrap(client.projects[':projectId']['reading-route'].$get({ param: { projectId }, query })),
  }),
  projects: () => queryOptions({ queryKey: ['projects'], queryFn: () => unwrap(client.projects.$get()) }),
  project: (projectId: string) =>
    queryOptions({ queryKey: ['units', 'project', projectId], queryFn: () => unwrap(client.projects[':projectId'].$get({ param: { projectId } })) }),
  statuses: (projectId: string) =>
    queryOptions({ queryKey: ['statuses', projectId], queryFn: () => unwrap(client.projects[':projectId'].statuses.$get({ param: { projectId } })) }),
  groups: (projectId: string, query: { kind?: 'scene' | 'document' | 'ui'; q?: string } = {}) =>
    queryOptions({ queryKey: ['units', 'groups', projectId, query], queryFn: () => unwrap(client.projects[':projectId'].groups.$get({ param: { projectId }, query })) }),
  group: (groupId: string) => queryOptions({ queryKey: ['units', 'group', groupId], queryFn: () => unwrap(client.groups[':groupId'].$get({ param: { groupId } })) }),
  speakers: (projectId: string) => queryOptions({ queryKey: ['units', 'speakers', projectId], queryFn: () => unwrap(client.projects[':projectId'].speakers.$get({ param: { projectId } })) }),
  listeners: (projectId: string) => queryOptions({ queryKey: ['units', 'listeners', projectId], queryFn: () => unwrap(client.projects[':projectId'].listeners.$get({ param: { projectId } })) }),
  /** Every line a filter matches (id and scene, script order), for walking them inside their scenes. */
  unitMatches: (projectId: string, query: { groupId?: string; kind?: 'scene' | 'document' | 'ui'; section?: string; statusId?: string; tagIds?: string; q?: string; speaker?: string; listener?: string; review?: '1'; marks?: string }) =>
    queryOptions({ queryKey: ['units', 'matches', projectId, query], queryFn: () => unwrap(client.projects[':projectId'].units.matches.$get({ param: { projectId }, query })) }),
  units: (projectId: string, query: { groupId?: string; section?: string; kind?: 'scene' | 'document' | 'ui'; statusId?: string; tagIds?: string; q?: string; speaker?: string; listener?: string; review?: '1'; marks?: string; focus?: string; offset?: number; limit?: number }) =>
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
  /** Other lines with the same source, translated or not (a confirmed translation may be applied to them). */
  sameSource: (unitId: string) => queryOptions({ queryKey: ['units', 'same-source', unitId], queryFn: () => unwrap(client.units[':unitId'].same.$get({ param: { unitId } })) }),
  /** Translated lines with the same or a similar source (the editor's suggestions). */
  lineMatches: (unitId: string) => queryOptions({ queryKey: ['units', 'line-matches', unitId], queryFn: () => unwrap(client.units[':unitId'].matches.$get({ param: { unitId } })) }),
  graphSections: (projectId: string, direction: 'vertical' | 'horizontal' = 'vertical') =>
    queryOptions({ queryKey: ['graph', projectId, 'sections', direction], queryFn: () => unwrap(client.projects[':projectId'].graph.sections.$get({ param: { projectId }, query: { direction } })), staleTime: Infinity }),
  /** The project's stored views of the dialogue graph (graph topic: the SSE refreshes it). */
  graphViews: (projectId: string) =>
    queryOptions({ queryKey: ['graph', projectId, 'views'], queryFn: () => unwrap(client.projects[':projectId'].graph.views.$get({ param: { projectId } })) }),
  /** A view of graph nodes made in the chat (show_graph). */
  graphView: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['graph', projectId, 'views', id], queryFn: () => unwrap(client.projects[':projectId'].graph.views[':id'].$get({ param: { projectId, id } })), staleTime: Infinity }),
  /** `section`: one section's own dialogue layout (dialogue scope only). */
  graph: (projectId: string, scope: 'scene' | 'dialogue', section?: string, direction: 'vertical' | 'horizontal' = 'vertical') =>
    queryOptions({
      queryKey: ['graph', projectId, scope, direction, section ?? ''],
      queryFn: () => unwrap(client.projects[':projectId'].graph[':scope{dialogue|scene}'].$get({ param: { projectId, scope }, query: { ...(section && { section }), direction } })),
      staleTime: Infinity,
    }),
  /** The slice of the dialogue graph for the stored choices (길 따라 보기): blocks, edges, forks, stubs, seams, the picks and the translation counts (units topic: translations decide them). */
  route: (projectId: string) => queryOptions({ queryKey: ['units', projectId, 'route'], queryFn: () => unwrap(client.projects[':projectId'].route.$get({ param: { projectId } })) }),
  /** The visible rows of the path view's translation list: a chunk of the route's lines by id, in that order (units topic: a translation changes them). */
  routeRows: (projectId: string, ids: string[]) =>
    queryOptions({
      queryKey: ['units', 'route-rows', projectId, ids],
      queryFn: () => unwrap(client.projects[':projectId'].units['by-ids'].$post({ param: { projectId }, json: { ids } })),
      enabled: ids.length > 0,
      placeholderData: keepPreviousData,
    }),
  /** 다음 길: the route through the most untranslated lines, what it adds and how many routes are left (units topic, like the counts it is made from). */
  routeNext: (projectId: string) => queryOptions({ queryKey: ['units', projectId, 'route-next'], queryFn: () => unwrap(client.projects[':projectId'].route.next.$get({ param: { projectId } })) }),
  /** 남은 갈래: untranslated lines the current route does not pass, by branch, and lines no route reaches (units topic). */
  routeRemaining: (projectId: string) => queryOptions({ queryKey: ['units', projectId, 'route-remaining'], queryFn: () => unwrap(client.projects[':projectId'].route.remaining.$get({ param: { projectId } })) }),
  /** 이음새 점검: the checked seams of the current route with whether their lines still read as they did, and the counts for the round (units topic: translations decide). */
  seamChecks: (projectId: string) => queryOptions({ queryKey: ['units', 'seam-checks', projectId], queryFn: () => unwrap(client.projects[':projectId']['seam-checks'].$get({ param: { projectId } })) }),
  /** One seam: the current route's last lines before it and the earlier route's lines after it. */
  seamDetail: (projectId: string, nodeId: string) =>
    queryOptions({ queryKey: ['units', 'seam', projectId, nodeId], queryFn: () => unwrap(client.projects[':projectId'].route.seams[':nodeId'].$get({ param: { projectId, nodeId } })) }),
  graphNode: (nodeId: string, projectId?: string) => queryOptions({
    queryKey: ['units', 'graph-node', projectId ?? null, nodeId],
    queryFn: () => unwrap(client['graph-nodes'][':nodeId'].$get({
      param: { nodeId },
      query: { projectId },
    })),
  }),
  terms: (projectId: string) => queryOptions({ queryKey: ['terms', projectId], queryFn: () => unwrap(client.projects[':projectId'].terms.$get({ param: { projectId } })) }),
  termUsage: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['terms', 'usage', id], queryFn: () => unwrap(client.projects[':projectId'].terms[':id'].usage.$get({ param: { projectId, id } })) }),
  documents: (projectId: string) => queryOptions({ queryKey: ['knowledge', 'documents', projectId], queryFn: () => unwrap(client.projects[':projectId'].documents.$get({ param: { projectId } })) }),
  characters: (projectId: string) =>
    queryOptions({ queryKey: ['knowledge', 'characters', projectId], queryFn: () => unwrap(client.projects[':projectId'].characters.$get({ param: { projectId } })) }),
  storyEvents: (projectId: string) => queryOptions({ queryKey: ['knowledge', 'events', projectId], queryFn: () => unwrap(client.projects[':projectId'].events.$get({ param: { projectId } })) }),
  speechRules: (projectId: string) =>
    queryOptions({ queryKey: ['knowledge', 'speech-rules', projectId], queryFn: () => unwrap(client.projects[':projectId']['speech-rules'].$get({ param: { projectId } })) }),
  ruleLines: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['units', 'rule-lines', id], queryFn: () => unwrap(client.projects[':projectId']['speech-rules'][':id'].lines.$get({ param: { projectId, id } })) }),
  /** Lines cited as evidence, by key. */
  linesByKeys: (projectId: string, keys: string[]) =>
    queryOptions({
      queryKey: ['units', 'by-keys', projectId, keys],
      queryFn: () => unwrap(client.projects[':projectId'].units['by-keys'].$post({ param: { projectId }, json: { keys } })),
      enabled: keys.length > 0,
    }),
  connections: () => queryOptions({ queryKey: ['connections'], queryFn: () => unwrap(client.connections.$get()) }),
  /** Recent model tests of one connection (AI log rows outside any project). */
  connectionTests: (connectionId: string) => queryOptions({ queryKey: ['calls', 'tests', connectionId], queryFn: () => unwrap(client.connections[':id'].tests.$get({ param: { id: connectionId } })) }),
  workflows: (projectId: string) =>
    queryOptions({ queryKey: ['workflows', projectId], queryFn: () => unwrap(client.projects[':projectId'].workflows.$get({ param: { projectId } })) }),
  workflow: (id: string) => queryOptions({ queryKey: ['workflows', 'detail', id], queryFn: () => unwrap(client.workflows[':id'].$get({ param: { id } })) }),
  /** The project's AI log (every model request); `kind` narrows it to one source. */
  aiCalls: (projectId: string, kind?: 'run' | 'whole' | 'terms' | 'test' | 'chat', ref?: string) =>
    queryOptions({ queryKey: ['calls', projectId, kind ?? '', ref ?? ''], queryFn: () => unwrap(client.projects[':projectId']['ai-calls'].$get({ param: { projectId }, query: { ...(kind && { kind }), ...(ref && { ref }) } })) }),
  /** What one model request sent (kept for whole-script reads and glossary fills). */
  aiCallRequest: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['calls', 'request', id], queryFn: () => unwrap(client.projects[':projectId']['ai-calls'][':id'].request.$get({ param: { projectId, id } })), staleTime: Infinity }),
  /** How fast this model has answered this kind of request before (seconds per 1,000 input tokens). */
  aiPace: (model: string, kind: 'whole' | 'terms' | 'run' | 'chat' | 'test') =>
    queryOptions({ queryKey: ['calls', 'pace', model, kind], queryFn: () => unwrap(client['ai-calls'].pace.$get({ query: { model, kind } })) }),
  /** Work analyses and glossary fills, for 실행 기록 beside the runs. */
  jobs: (projectId: string) => queryOptions({ queryKey: ['runs', projectId, 'jobs'], queryFn: () => unwrap(client.projects[':projectId'].jobs.$get({ param: { projectId } })) }),
  runs: (projectId: string) => queryOptions({ queryKey: ['runs', projectId], queryFn: () => unwrap(client.projects[':projectId'].runs.$get({ param: { projectId } })) }),
  run: (id: string) => queryOptions({ queryKey: ['runs', 'detail', id], queryFn: () => unwrap(client.runs[':id'].$get({ param: { id } })) }),
  runItems: (id: string, query: { state?: string; nodeId?: string; offset?: number }) =>
    queryOptions({
      queryKey: ['runs', 'items', id, query],
      queryFn: () => unwrap(client.runs[':id'].items.$get({ param: { id }, query: { ...query, offset: query.offset?.toString() } as never })),
      placeholderData: keepPreviousData,
    }),
  /** The batches a run was planned in. */
  runPlan: (id: string) => queryOptions({ queryKey: ['runs', 'plan', id], queryFn: () => unwrap(client.runs[':id'].plan.$get({ param: { id } })), staleTime: Infinity }),
  runSteps: (id: string) => queryOptions({ queryKey: ['runs', 'steps', id], queryFn: () => unwrap(client.runs[':id'].steps.$get({ param: { id } })) }),
  /** Proposals of one CLI chat, or (no session) those sent from the loca CLI. */
  proposals: (projectId: string, session?: string) =>
    queryOptions({
      queryKey: ['proposals', projectId, session ?? 'external'],
      queryFn: () => unwrap(client.projects[':projectId'].proposals.$get({ param: { projectId }, query: session ? { session } : {} })),
    }),
  chatSessions: (projectId: string) => queryOptions({ queryKey: ['chat', projectId], queryFn: () => unwrap(client.projects[':projectId'].chat.$get({ param: { projectId } })) }),
  chatSession: (sessionId: string) =>
    queryOptions({ queryKey: ['chat', 'session', sessionId], queryFn: () => unwrap(client.chat[':sessionId'].$get({ param: { sessionId } })), staleTime: Infinity }),
  /** @-attach, every kind: the top matches of each, grouped. Keyed under units (projects, terms, knowledge, workflows and statuses imply it), so a change refetches; runs are read when the list opens. */
  attach: (projectId: string, term: string) =>
    queryOptions({
      queryKey: ['units', 'attach', projectId, 'all', term],
      queryFn: () => unwrap(client.projects[':projectId'].chat.attach.$get({ param: { projectId }, query: { q: term } })),
      placeholderData: keepPreviousData,
    }),
  /** @-attach inside one kind: pages of up to ATTACH_PAGE, the next on 더 보기. */
  attachKind: (projectId: string, kind: AttachKind, term: string) =>
    infiniteQueryOptions({
      queryKey: ['units', 'attach', projectId, kind, term],
      queryFn: ({ pageParam }) => unwrap(client.projects[':projectId'].chat.attach.$get({ param: { projectId }, query: { q: term, kind, offset: String(pageParam), limit: String(ATTACH_PAGE) } })),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => (last.groups[0]?.more ? pages.length * ATTACH_PAGE : undefined),
      placeholderData: keepPreviousData,
    }),
  /** 저장한 지시, for the chat's / list and the settings page (projects imply units). */
  prompts: (projectId: string) => queryOptions({ queryKey: ['units', 'prompts', projectId], queryFn: () => unwrap(client.projects[':projectId'].prompts.$get({ param: { projectId } })) }),
  chatSearch: (projectId: string, query: string) =>
    queryOptions({
      queryKey: ['chat', 'search', projectId, query],
      queryFn: () => unwrap(client.projects[':projectId'].chat.search.$get({ param: { projectId }, query: { q: query } })),
    }),
};

/** The id of the project's 확인 권장 tag (knowledge items an app check marked for a look), once it exists. */
export function useReviewTagId(projectId: string) {
  const statuses = useQuery(q.statuses(projectId));
  return statuses.data?.tags.find((tag) => tag.role === REVIEW_TAG.role)?.id;
}

/** The project's own colors for automatic marks (defaults fill the rest, see markColor). */
export function useMarkColors(projectId: string | undefined): MarkColors | undefined {
  const project = useQuery({ ...q.project(projectId ?? ''), enabled: !!projectId });
  return project.data?.markColors as MarkColors | undefined;
}

/** The tags that can be put in a place (the server sends each tag's effective scope). */
export const tagsIn = <T extends { scope: readonly string[] }>(tags: T[] | undefined, scope: TagScope) =>
  (tags ?? []).filter((tag) => normalizeTagScopes(tag.scope).includes(scope));
/** The tags that can be on lines. */
export const lineTags = <T extends { scope: readonly string[] }>(tags: T[] | undefined) => tagsIn(tags, 'lines');
