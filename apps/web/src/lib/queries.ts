import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import { ATTACH_PAGE, type AttachKind, type LineFilterInput, type MarkStyles, type TagScope } from '@tw/shared';
import { aiCallRequest } from './ai-calls';
import { client, unwrap } from './api';
import { chatSearch, chatSession } from './chat-sessions';
import { graphEdge, graphLayout, graphNode, graphSections, readingRoute } from './graph';
import { graphView } from './graph-views';
import { detectedFormatRules, useProject } from './project';
import { key } from './query-keys';
import { runPlan } from './runs';
import { termUsage } from './terms';

/**
 * The screens' questions by name. Each is defined beside the rows it asks about (the modules imported here) or
 * below; every key comes from `key` (lib/query-keys.ts) and starts with the topic whose change asks it again.
 */
export const q = {
  detectFormatRules: detectedFormatRules,
  readingRoute,
  /** Every line a filter matches (id and scene, script order), for walking them inside their scenes. */
  unitMatches: (projectId: string, filter: LineFilterInput) =>
    queryOptions({ queryKey: key('units', 'matches', projectId, filter), queryFn: () => unwrap(client.projects[':projectId'].units.matches.$post({ param: { projectId }, json: { filter } })) }),
  /**
   * Other lines with the same source, translated or not, each with its rev (a confirmed translation may be applied
   * to them). Read once before that write, with the words the offer shows: the lines are mostly not on screen.
   */
  sameSource: (unitId: string) => queryOptions({ queryKey: key('units', 'same-source', unitId), queryFn: () => unwrap(client.units[':unitId'].same.$get({ param: { unitId } })) }),
  /** Translated lines with the same or a similar source (the editor's suggestions): an answer computed per line, each with its score and words. */
  lineMatches: (unitId: string) => queryOptions({ queryKey: key('units', 'line-matches', unitId), queryFn: () => unwrap(client.units[':unitId'].matches.$get({ param: { unitId } })) }),
  graphSections,
  graphView,
  graph: graphLayout,
  graphEdge,
  graphNode,
  termUsage,
  /** The lines a speech rule applies to. */
  ruleLines: (projectId: string, id: string) =>
    queryOptions({ queryKey: key('units', 'rule-lines', projectId, id), queryFn: () => unwrap(client.projects[':projectId']['speech-rules'][':id'].lines.$get({ param: { projectId, id } })) }),
  aiCallRequest,
  runPlan,
  chatSession,
  /** @-attach, every kind: the top matches of each, grouped. Keyed under units (projects, terms, knowledge, workflows and statuses imply it), so a change refetches; runs are read when the list opens. */
  attach: (projectId: string, term: string) =>
    queryOptions({
      queryKey: key('units', 'attach', projectId, 'all', term),
      queryFn: () => unwrap(client.projects[':projectId'].chat.attach.$get({ param: { projectId }, query: { q: term } })),
      placeholderData: keepPreviousData,
    }),
  /** @-attach inside one kind: pages of up to ATTACH_PAGE, the next on 더 보기. */
  attachKind: (projectId: string, kind: AttachKind, term: string) =>
    infiniteQueryOptions({
      queryKey: key('units', 'attach', projectId, kind, term),
      queryFn: ({ pageParam }) => unwrap(client.projects[':projectId'].chat.attach.$get({ param: { projectId }, query: { q: term, kind, offset: String(pageParam), limit: String(ATTACH_PAGE) } })),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => (last.groups[0]?.more ? pages.length * ATTACH_PAGE : undefined),
      placeholderData: keepPreviousData,
    }),
  chatSearch,
};

/** The project's own names and colours for automatic tags (markName / markColor fall back to the defaults). */
export function useMarkStyles(projectId: string | undefined): MarkStyles | undefined {
  return useProject(projectId).data?.markStyles as MarkStyles | undefined;
}

/** The tags that can be put in a place (the server sends each tag's effective scope). */
export const tagsIn = <T extends { scope: readonly string[] }>(tags: T[] | undefined, scope: TagScope) =>
  (tags ?? []).filter((tag) => tag.scope.includes(scope));
/** The tags that can be on lines. */
export const lineTags = <T extends { scope: readonly string[] }>(tags: T[] | undefined) => tagsIn(tags, 'lines');
