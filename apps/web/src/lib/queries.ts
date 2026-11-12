import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import { ATTACH_PAGE, normalizeTagScopes, type AttachKind, type DetectedCustomFormatRule, type DetectedFormatPreset, type FormatPreset, type MarkStyles, type TagScope } from '@tw/shared';
import { client, unwrap } from './api';
import { useProject } from './project';

/**
 * Query keys start with the server's change topic (see server events.ts), so an SSE
 * "units changed" event refetches exactly the queries that show units.
 */
export const q = {
  detectFormatRules: (projectId: string) =>
    queryOptions({
      queryKey: ['units', 'detect-format-rules', projectId],
      queryFn: () =>
        unwrap(client.projects[':projectId']['detect-format-rules'].$get({ param: { projectId } })) as Promise<{
          presets: DetectedFormatPreset[];
          customCandidates: DetectedCustomFormatRule[];
          recommendedPresets: FormatPreset[];
        }>,
    }),
  readingRoute: (projectId: string, query: { start?: string; end?: string; via?: string }) => queryOptions({
    queryKey: ['units', 'reading-route-between', projectId, query],
    queryFn: () => unwrap(client.projects[':projectId']['reading-route'].$get({ param: { projectId }, query })),
  }),
  /** Every line a filter matches (id and scene, script order), for walking them inside their scenes. */
  unitMatches: (projectId: string, query: { groupId?: string; kind?: 'scene' | 'document' | 'ui'; section?: string; statusId?: string; tagIds?: string; q?: string; speaker?: string; listener?: string; review?: '1'; marks?: string }) =>
    queryOptions({ queryKey: ['units', 'matches', projectId, query], queryFn: () => unwrap(client.projects[':projectId'].units.matches.$get({ param: { projectId }, query })) }),
  /** Other lines with the same source, translated or not (a confirmed translation may be applied to them). */
  sameSource: (unitId: string) => queryOptions({ queryKey: ['units', 'same-source', unitId], queryFn: () => unwrap(client.units[':unitId'].same.$get({ param: { unitId } })) }),
  /** Translated lines with the same or a similar source (the editor's suggestions). */
  lineMatches: (unitId: string) => queryOptions({ queryKey: ['units', 'line-matches', unitId], queryFn: () => unwrap(client.units[':unitId'].matches.$get({ param: { unitId } })) }),
  graphSections: (projectId: string, direction: 'vertical' | 'horizontal' = 'vertical') =>
    queryOptions({ queryKey: ['graph', projectId, 'sections', direction], queryFn: () => unwrap(client.projects[':projectId'].graph.sections.$get({ param: { projectId }, query: { direction } })), staleTime: Infinity }),
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
  graphNode: (nodeId: string, projectId?: string) => queryOptions({
    queryKey: ['units', 'graph-node', projectId ?? null, nodeId],
    queryFn: () => unwrap(client['graph-nodes'][':nodeId'].$get({
      param: { nodeId },
      query: { projectId },
    })),
  }),
  termUsage: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['terms', 'usage', id], queryFn: () => unwrap(client.projects[':projectId'].terms[':id'].usage.$get({ param: { projectId, id } })) }),
  ruleLines: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['units', 'rule-lines', id], queryFn: () => unwrap(client.projects[':projectId']['speech-rules'][':id'].lines.$get({ param: { projectId, id } })) }),
  /** What one model request sent (kept for whole-script reads and glossary fills). */
  aiCallRequest: (projectId: string, id: string) =>
    queryOptions({ queryKey: ['calls', 'request', id], queryFn: () => unwrap(client.projects[':projectId']['ai-calls'][':id'].request.$get({ param: { projectId, id } })), staleTime: Infinity }),
  /** The batches a run was planned in. */
  runPlan: (id: string) => queryOptions({ queryKey: ['runs', 'plan', id], queryFn: () => unwrap(client.runs[':id'].plan.$get({ param: { id } })), staleTime: Infinity }),
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
  chatSearch: (projectId: string, query: string) =>
    queryOptions({
      queryKey: ['chat', 'search', projectId, query],
      queryFn: () => unwrap(client.projects[':projectId'].chat.search.$get({ param: { projectId }, query: { q: query } })),
    }),
};

/** The project's own names and colours for automatic tags (markName / markColor fall back to the defaults). */
export function useMarkStyles(projectId: string | undefined): MarkStyles | undefined {
  return useProject(projectId).data?.markStyles as MarkStyles | undefined;
}

/** The tags that can be put in a place (the server sends each tag's effective scope). */
export const tagsIn = <T extends { scope: readonly string[] }>(tags: T[] | undefined, scope: TagScope) =>
  (tags ?? []).filter((tag) => normalizeTagScopes(tag.scope).includes(scope));
/** The tags that can be on lines. */
export const lineTags = <T extends { scope: readonly string[] }>(tags: T[] | undefined) => tagsIn(tags, 'lines');
