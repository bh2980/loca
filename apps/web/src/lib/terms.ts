import { useMemo } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { duplicateTargets } from '@tw/shared';
import type { InferRequestType } from 'hono/client';
import { client } from './api';
import { liveRows, projectCollection, sent, type FeedRow } from './collections';
import { key } from './query-keys';
import { queryOptions } from '@tanstack/react-query';
import { unwrap } from './api';

/** A glossary term as the terms collection holds it. */
export type Term = FeedRow['terms'];

/** The project's glossary (not rejected terms), kept current by the server's row feed: every screen reads this one. */
export const termsCollection = (projectId: string) => projectCollection('terms', projectId);

/**
 * The glossary in source order (`data` undefined until loaded), with
 * the terms whose Korean form another source shares (#번역어 중복). Rows stay the same objects while
 * they do not change, so a row component can skip drawing them.
 */
export function useTerms(projectId: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const query = liveRows<Term[]>(useLiveQuery((q) => (enabled ? q.from({ term: termsCollection(projectId) }).orderBy(({ term }) => term.source) : undefined)), enabled);
  const duplicates = useMemo(() => duplicateTargets(query.data ?? []), [query.data]);
  return { ...query, duplicates };
}

/** A term's automatic marks with its #번역어 중복 from the whole glossary. */
export const withDuplicate = (term: Term, duplicates: Set<Term>) => ({ ...term, duplicateTarget: duplicates.has(term) });


/** Where a term appears in the script (terms topic; units imply it: a term's usage counts lines). */
export const termUsage = (projectId: string, id: string) =>
  queryOptions({ queryKey: key('terms', 'usage', projectId, id), queryFn: () => unwrap(client.projects[':projectId'].terms[':id'].usage.$get({ param: { projectId, id } })) });

// ── writes: each is done when the feed has brought the saved term ───────────────

type TermsApi = (typeof client.projects)[':projectId']['terms'];
export type TermCreate = InferRequestType<TermsApi['$post']>['json'];
export type TermPatch = InferRequestType<TermsApi[':id']['$patch']>['json'];

export const createTerm = (projectId: string, json: TermCreate) => sent(projectId, client.projects[':projectId'].terms.$post({ param: { projectId }, json }));
export const saveTerm = (projectId: string, id: string, json: TermPatch) => sent(projectId, client.projects[':projectId'].terms[':id'].$patch({ param: { projectId, id }, json }));
export const deleteTerm = (projectId: string, id: string) => sent(projectId, client.projects[':projectId'].terms[':id'].$delete({ param: { projectId, id } }));
/** A tag put on or taken off terms. */
export const tagTerms = (projectId: string, ids: string[], tagId: string, add: boolean) => sent(projectId, client.projects[':projectId']['knowledge-tags'].$post({ param: { projectId }, json: { kind: 'terms', ids, tagId, add } }));
/** 용어 찾기: starts the job that collects terms from the script (its progress is a job notice). */
export const discoverTerms = (projectId: string) => sent(projectId, client.projects[':projectId'].terms.discover.$post({ param: { projectId } }));
