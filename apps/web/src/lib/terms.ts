import { useMemo } from 'react';
import { createOptimisticAction, useLiveQuery, type Collection } from '@tanstack/react-db';
import { duplicateTargets, type FeedSnapshot } from '@tw/shared';
import type { Term } from '@/components/glossary/term-pane';
import { client, unwrap, unwrapSeq } from './api';
import { feedCollection } from './collections';
import { feed } from './feed';

const collections = new Map<string, Collection<Term, string>>();

/** The project's glossary (not rejected terms), kept current by the server's row feed: every screen reads this one. */
export function termsCollection(projectId: string) {
  let terms = collections.get(projectId);
  if (!terms) {
    terms = feedCollection<Term>({
      projectId,
      name: 'terms',
      load: () => unwrap(client.projects[':projectId'].sync[':collection'].$get({ param: { projectId, collection: 'terms' } })) as Promise<FeedSnapshot>,
    });
    collections.set(projectId, terms);
  }
  return terms;
}

/**
 * The glossary in source order, as the old terms query gave it (`data` undefined until loaded), with
 * the terms whose Korean form another source shares (#번역어 중복). Rows stay the same objects while
 * they do not change, so a row component can skip drawing them.
 */
export function useTerms(projectId: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const query = useLiveQuery((q) => (enabled ? q.from({ term: termsCollection(projectId) }).orderBy(({ term }) => term.source) : undefined));
  const data = query.isReady ? (query.data as Term[] | undefined) : undefined;
  const duplicates = useMemo(() => duplicateTargets(data ?? []), [data]);
  return { data, duplicates, isLoading: enabled && !query.isReady, isSuccess: query.isReady, isFetching: enabled && !query.isReady };
}

/** A term's automatic marks with its #번역어 중복 from the whole glossary. */
export const withDuplicate = (term: Term, duplicates: Set<Term>) => ({ ...term, duplicateTarget: duplicates.has(term) });

/** Waits for the row feed to bring a write's rows back (its x-seq), so the screen shows the saved row. */
export async function sent<T extends Response & { json(): Promise<unknown> }>(projectId: string, request: Promise<T>): Promise<Awaited<ReturnType<T['json']>>> {
  const { body, seq } = await unwrapSeq(request);
  await feed.wait(projectId, seq);
  return body;
}

/**
 * 확정·버리기 on terms: the rows change at once (confirmed ones become a person's, discarded ones leave
 * the list) and the saved rows replace them when the feed brings them; a failure puts them back.
 */
export function decideTerms(projectId: string, ids: string[], accept: boolean) {
  const terms = termsCollection(projectId);
  const changed = { count: 0 };
  const run = createOptimisticAction<void>({
    onMutate: () => {
      for (const id of ids) {
        if (!terms.has(id)) continue;
        if (accept) terms.update(id, (draft) => void Object.assign(draft, { status: 'confirmed', statusBy: 'human' }));
        else terms.delete(id);
      }
    },
    mutationFn: async () => {
      const body = await sent(projectId, client.projects[':projectId'].drafts.$post({ param: { projectId }, json: { kind: 'terms', ids, action: accept ? 'confirm' : 'discard' } }));
      changed.count = body.changed;
    },
  });
  return run().when('settled').then(() => changed.count);
}
