import { createOptimisticAction, useLiveQuery, type Collection } from '@tanstack/react-db';
import type { InferRequestType, InferResponseType } from 'hono/client';
import { client } from './api';
import { loaded, projectCollection, sent } from './collections';
import { termsCollection } from './terms';

/**
 * The project's people, relationships, speech rules and notes, and its statuses and tags: one
 * collection each, kept current by the server's row feed, that every screen reads. A row stays the
 * same object while it does not change. Rejected knowledge is not listed. Story events are still a
 * query (their flow is computed on the server).
 */
type Api = (typeof client.projects)[':projectId'];
type People = InferResponseType<Api['characters']['$get']>;
type Taxonomy = InferResponseType<Api['statuses']['$get']>;
export type Character = People['characters'][number];
export type Relationship = People['relationships'][number];
export type SpeechRule = InferResponseType<Api['speech-rules']['$get']>[number];
export type KnowledgeDocument = InferResponseType<Api['documents']['$get']>[number];
/** A status; how many lines it has is q.statusCounts. */
export type Status = Omit<Taxonomy['statuses'][number], 'units'>;
/** A tag; how many lines and items carry it is q.statusCounts. */
export type Tag = Omit<Taxonomy['tags'][number], 'units' | 'items'> & { sort: number };

type Options = { enabled?: boolean };
type DraftKind = InferRequestType<Api['drafts']['$post']>['json']['kind'];

export const charactersCollection = (projectId: string) => projectCollection<Character>('characters', projectId);
export const relationshipsCollection = (projectId: string) => projectCollection<Relationship>('relationships', projectId);
export const speechRulesCollection = (projectId: string) => projectCollection<SpeechRule>('speechRules', projectId);
export const documentsCollection = (projectId: string) => projectCollection<KnowledgeDocument>('documents', projectId);
export const statusesCollection = (projectId: string) => projectCollection<Status>('statuses', projectId);
export const tagsCollection = (projectId: string) => projectCollection<Tag>('tags', projectId);

/** People by name. */
export function useCharacters(projectId: string, { enabled = true }: Options = {}) {
  return loaded<Character>(useLiveQuery((q) => (enabled ? q.from({ row: charactersCollection(projectId) }).orderBy(({ row }) => row.name) : undefined)), enabled);
}

export function useRelationships(projectId: string, { enabled = true }: Options = {}) {
  return loaded<Relationship>(useLiveQuery((q) => (enabled ? q.from({ row: relationshipsCollection(projectId) }) : undefined)), enabled);
}

export function useSpeechRules(projectId: string, { enabled = true }: Options = {}) {
  return loaded<SpeechRule>(useLiveQuery((q) => (enabled ? q.from({ row: speechRulesCollection(projectId) }) : undefined)), enabled);
}

/** Notes by kind, then title. */
export function useDocuments(projectId: string, { enabled = true }: Options = {}) {
  return loaded<KnowledgeDocument>(useLiveQuery((q) => (enabled ? q.from({ row: documentsCollection(projectId) }).orderBy(({ row }) => row.kind).orderBy(({ row }) => row.title) : undefined)), enabled);
}

/** The project's statuses and tags in their order (each its own collection, so a tag edit leaves status readers alone). */
export function useTaxonomy(projectId: string, { enabled = true }: Options = {}) {
  const statuses = loaded<Status>(useLiveQuery((q) => (enabled ? q.from({ row: statusesCollection(projectId) }).orderBy(({ row }) => row.sort) : undefined)), enabled);
  const tags = loaded<Tag>(useLiveQuery((q) => (enabled ? q.from({ row: tagsCollection(projectId) }).orderBy(({ row }) => row.sort).orderBy(({ row }) => row.name) : undefined)), enabled);
  return { statuses: statuses.data, tags: tags.data, isPending: statuses.isPending || tags.isPending, isSuccess: statuses.isSuccess && tags.isSuccess };
}

/** The kinds a person confirms or discards whose rows are collections (story events are a query: their refetch shows the change). */
const DECIDED = { terms: termsCollection, characters: charactersCollection, relationships: relationshipsCollection, speechRules: speechRulesCollection, documents: documentsCollection } as const;

/**
 * 확정·확인함 / 버리기 on terms or knowledge: the rows change at once (confirmed ones become a person's
 * and lose 확인 권장, discarded ones leave their lists) and the saved rows replace them when the feed
 * brings them; a failure puts them back. Resolves to how many the server changed.
 */
export function decideItems(projectId: string, items: { kind: DraftKind; ids: string[] }[], action: 'confirm' | 'discard') {
  const changed = { count: 0 };
  const run = createOptimisticAction<void>({
    onMutate: () => {
      for (const { kind, ids } of items) {
        if (!(kind in DECIDED)) continue;
        const rows = DECIDED[kind as keyof typeof DECIDED](projectId) as unknown as Collection<{ id: string }, string>;
        for (const id of ids) {
          if (!rows.has(id)) continue;
          if (action === 'discard') rows.delete(id);
          else rows.update(id, (draft) => void Object.assign(draft, { status: 'confirmed', statusBy: 'human' }, kind === 'terms' ? {} : { reviewNote: '' }));
        }
      }
    },
    mutationFn: async () => {
      for (const { kind, ids } of items) if (ids.length) changed.count += (await sent(projectId, client.projects[':projectId'].drafts.$post({ param: { projectId }, json: { kind, ids, action } }))).changed;
    },
  });
  return run().when('settled').then(() => changed.count);
}

/** Statuses or tags in this order (the settings page's drag): they move at once, and back when the server refuses. */
export function reorderTaxonomy(projectId: string, kind: 'statuses' | 'tags', ids: string[]) {
  const rows = (kind === 'statuses' ? statusesCollection(projectId) : tagsCollection(projectId)) as unknown as Collection<{ id: string; sort: number }, string>;
  const api = client.projects[':projectId'];
  const run = createOptimisticAction<void>({
    onMutate: () => {
      ids.forEach((id, sort) => {
        if (rows.has(id)) rows.update(id, (draft) => void (draft.sort = sort));
      });
    },
    mutationFn: async () => {
      if (kind === 'statuses') await sent(projectId, api.statuses.order.$put({ param: { projectId }, json: { ids } }));
      else await sent(projectId, api.tags.order.$put({ param: { projectId }, json: { ids } }));
    },
  });
  return run().when('settled');
}

/**
 * The story events with where each happens and what follows it (the event flow): a collection the server
 * computes again when an event, its links or tags, its evidence lines' place or the dialogue graph
 * changes, sending only the events whose row differs.
 */
export type StoryEvent = InferResponseType<Api['events']['$get']>[number];
export const storyEventsCollection = (projectId: string) => projectCollection<StoryEvent>('events', projectId);

export function useStoryEvents(projectId: string, { enabled = true }: Options = {}) {
  return loaded<StoryEvent>(useLiveQuery((q) => (enabled ? q.from({ row: storyEventsCollection(projectId) }) : undefined)), enabled);
}
