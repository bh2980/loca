import { useMemo } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { duplicateTargets } from '@tw/shared';
import type { Term } from '@/components/glossary/term-pane';
import { loaded, projectCollection } from './collections';

/** The project's glossary (not rejected terms), kept current by the server's row feed: every screen reads this one. */
export const termsCollection = (projectId: string) => projectCollection<Term>('terms', projectId);

/**
 * The glossary in source order, as the old terms query gave it (`data` undefined until loaded), with
 * the terms whose Korean form another source shares (#번역어 중복). Rows stay the same objects while
 * they do not change, so a row component can skip drawing them.
 */
export function useTerms(projectId: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const query = loaded<Term>(useLiveQuery((q) => (enabled ? q.from({ term: termsCollection(projectId) }).orderBy(({ term }) => term.source) : undefined)), enabled);
  const duplicates = useMemo(() => duplicateTargets(query.data ?? []), [query.data]);
  return { ...query, duplicates };
}

/** A term's automatic marks with its #번역어 중복 from the whole glossary. */
export const withDuplicate = (term: Term, duplicates: Set<Term>) => ({ ...term, duplicateTarget: duplicates.has(term) });

