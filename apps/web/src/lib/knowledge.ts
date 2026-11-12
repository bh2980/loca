import { useMemo } from 'react';
import { createOptimisticAction, useLiveQuery, type Collection } from '@tanstack/react-db';
import type { InferRequestType } from 'hono/client';
import { client } from './api';
import { liveRows, projectCollection, sent, type FeedRow } from './collections';
import { termsCollection } from './terms';

/**
 * The project's people, relationships, speech rules and notes, and its statuses and tags: one
 * collection each, kept current by the server's row feed, that every screen reads. A row stays the
 * same object while it does not change. Rejected knowledge is not listed.
 */
type Api = (typeof client.projects)[':projectId'];
export type Character = FeedRow['characters'];
export type Relationship = FeedRow['relationships'];
export type SpeechRule = FeedRow['speechRules'];
export type KnowledgeDocument = FeedRow['documents'];
/** A status; how many lines it has is useTaxonomyCounts. */
export type Status = FeedRow['statuses'];
/** A tag; how many lines and items carry it is useTaxonomyCounts. */
export type Tag = FeedRow['tags'];

type Options = { enabled?: boolean };
type DraftKind = InferRequestType<Api['drafts']['$post']>['json']['kind'];

export const charactersCollection = (projectId: string) => projectCollection('characters', projectId);
export const relationshipsCollection = (projectId: string) => projectCollection('relationships', projectId);
export const speechRulesCollection = (projectId: string) => projectCollection('speechRules', projectId);
export const documentsCollection = (projectId: string) => projectCollection('documents', projectId);
export const statusesCollection = (projectId: string) => projectCollection('statuses', projectId);
export const tagsCollection = (projectId: string) => projectCollection('tags', projectId);

/** People by name. */
export function useCharacters(projectId: string, { enabled = true }: Options = {}) {
  return liveRows(useLiveQuery((q) => (enabled ? q.from({ row: charactersCollection(projectId) }).orderBy(({ row }) => row.name) : undefined)), enabled);
}

export function useRelationships(projectId: string, { enabled = true }: Options = {}) {
  return liveRows(useLiveQuery((q) => (enabled ? q.from({ row: relationshipsCollection(projectId) }) : undefined)), enabled);
}

export function useSpeechRules(projectId: string, { enabled = true }: Options = {}) {
  return liveRows(useLiveQuery((q) => (enabled ? q.from({ row: speechRulesCollection(projectId) }) : undefined)), enabled);
}

/** Notes by kind, then title. */
export function useDocuments(projectId: string, { enabled = true }: Options = {}) {
  return liveRows(useLiveQuery((q) => (enabled ? q.from({ row: documentsCollection(projectId) }).orderBy(({ row }) => row.kind).orderBy(({ row }) => row.title) : undefined)), enabled);
}

/** The project's statuses and tags in their order (each its own collection, so a tag edit leaves status readers alone). */
export function useTaxonomy(projectId: string, { enabled = true }: Options = {}) {
  const statuses = liveRows(useLiveQuery((q) => (enabled ? q.from({ row: statusesCollection(projectId) }).orderBy(({ row }) => row.sort) : undefined)), enabled);
  const tags = liveRows(useLiveQuery((q) => (enabled ? q.from({ row: tagsCollection(projectId) }).orderBy(({ row }) => row.sort).orderBy(({ row }) => row.name) : undefined)), enabled);
  return { statuses: statuses.data, tags: tags.data, isLoading: statuses.isLoading || tags.isLoading };
}

/** The kinds a person confirms or discards, each with the collection that holds its rows. */
const DECIDED = { terms: termsCollection, characters: charactersCollection, relationships: relationshipsCollection, speechRules: speechRulesCollection, documents: documentsCollection, events: (projectId: string) => projectCollection('events', projectId) } as const satisfies Record<DraftKind, unknown>;

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
        const rows = DECIDED[kind](projectId) as unknown as Collection<{ id: string }, string>;
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
export type StoryEvent = FeedRow['events'];
export const storyEventsCollection = (projectId: string) => projectCollection('events', projectId);

export function useStoryEvents(projectId: string, { enabled = true }: Options = {}) {
  return liveRows(useLiveQuery((q) => (enabled ? q.from({ row: storyEventsCollection(projectId) }) : undefined)), enabled);
}

/**
 * How many lines each status has and how many lines and items each tag is on: two collections the
 * feed keeps current count by count (a line that changes status sends the two statuses it left and joined).
 */
export function useTaxonomyCounts(projectId: string) {
  const statuses = liveRows(useLiveQuery((q) => q.from({ row: projectCollection('statusCounts', projectId) })));
  const tags = liveRows(useLiveQuery((q) => q.from({ row: projectCollection('tagCounts', projectId) })));
  return useMemo(() => ({ statuses: new Map((statuses.data ?? []).map((row) => [row.id, row.units])), tags: new Map((tags.data ?? []).map((row) => [row.id, { units: row.units, items: row.items }])) }), [statuses.data, tags.data]);
}

// ── writes ────────────────────────────────────────────────────────────────────

const api = client.projects[':projectId'];
export type SpeechRuleCreate = InferRequestType<Api['speech-rules']['$post']>['json'];
export type CharacterCreate = InferRequestType<Api['characters']['$post']>['json'];
export type RelationshipCreate = InferRequestType<Api['relationships']['$post']>['json'];
export type DocumentCreate = InferRequestType<Api['documents']['$post']>['json'];
export type StoryEventCreate = InferRequestType<Api['events']['$post']>['json'];
export type RelationshipChanges = InferRequestType<Api['relationships'][':id']['changes']['$patch']>['json']['changes'];
/** What a knowledge delete takes: rows by kind (a story line between two events is an `eventLinks` item). */
export type KnowledgeDelete = InferRequestType<Api['knowledge-delete']['$post']>['json']['items'][number];
/** A line of the 사건 흐름, by its two ends, and what a person made of it (drawn, hidden, or as derived). */
export type EventLine = { fromId: string; toId: string };
export type EventLinkKind = 'added' | 'hidden' | null;

/**
 * The project's knowledge writes, one set per kind: create, save (a form through the kind's PATCH) and remove. Each
 * is done when the feed has brought the saved row, so the screen that asked can open or read it at once.
 *
 * `save` takes only what the endpoint accepts: a form key it does not take fails to compile here (the server's
 * schema would drop it and the edit would vanish without an error).
 */
export function knowledgeWrites(projectId: string) {
  const param = { projectId };
  const at = (id: string) => ({ param: { projectId, id } });
  const patchTo =
    <P, T extends Response & { json(): Promise<unknown> }>(patch: (args: { param: { projectId: string; id: string }; json: P }) => Promise<T>) =>
    <J extends P>(id: string, json: J & Record<Exclude<keyof J, keyof P>, never>) =>
      sent(projectId, patch({ ...at(id), json }));
  return {
    characters: {
      create: (json: CharacterCreate) => sent(projectId, api.characters.$post({ param, json })),
      save: patchTo(api.characters[':id'].$patch),
      remove: (id: string) => sent(projectId, api.characters[':id'].$delete(at(id))),
    },
    relationships: {
      create: (json: RelationshipCreate) => sent(projectId, api.relationships.$post({ param, json })),
      save: patchTo(api.relationships[':id'].$patch),
      remove: (id: string) => sent(projectId, api.relationships[':id'].$delete(at(id))),
      /** How the relationship changes over the story, whole. */
      saveChanges: (id: string, changes: RelationshipChanges) => sent(projectId, api.relationships[':id'].changes.$patch({ ...at(id), json: { changes } })),
    },
    speechRules: {
      create: (json: SpeechRuleCreate) => sent(projectId, api['speech-rules'].$post({ param, json })),
      save: patchTo(api['speech-rules'][':id'].$patch),
      remove: (id: string) => sent(projectId, api['speech-rules'][':id'].$delete(at(id))),
    },
    documents: {
      create: (json: DocumentCreate) => sent(projectId, api.documents.$post({ param, json })),
      save: patchTo(api.documents[':id'].$patch),
      remove: (id: string) => sent(projectId, api.documents[':id'].$delete(at(id))),
    },
    events: {
      create: (json: StoryEventCreate) => sent(projectId, api.events.$post({ param, json })),
      save: patchTo(api.events[':id'].$patch),
      remove: (id: string) => sent(projectId, api.events[':id'].$delete(at(id))),
      /** Draws a line between two events or takes it away; answers with what the pair was and is now. */
      link: (line: EventLine, action: 'link' | 'unlink') => sent(projectId, api['event-links'].$post({ param, json: { ...line, action } })),
      /** Sets what a person made of a line outright (putting back what an undo remembers). */
      setLink: (line: EventLine, kind: EventLinkKind) => sent(projectId, api['event-links'].$put({ param, json: { ...line, kind } })),
    },
    /** A tag put on or taken off items of one kind. */
    tag: (kind: DraftKind, ids: string[], tagId: string, add: boolean) => sent(projectId, api['knowledge-tags'].$post({ param, json: { kind, ids, tagId, add } })),
    /** Deletes rows of several kinds at once; answers with the token that takes it back (lib/undo.ts), null when nothing was deleted. */
    remove: async (items: KnowledgeDelete[]) => (await sent(projectId, api['knowledge-delete'].$post({ param, json: { items } }))).token,
  };
}

// ── statuses and tags ──────────────────────────────────────────────────────────

export type StatusCreate = InferRequestType<Api['statuses']['$post']>['json'];
export type StatusPatch = InferRequestType<Api['statuses'][':id']['$patch']>['json'];
export type TagCreate = InferRequestType<Api['tags']['$post']>['json'];
export type TagPatch = InferRequestType<Api['tags'][':id']['$patch']>['json'];

/** The project's status and tag writes: each done when the feed has brought the changed rows. */
export function taxonomyWrites(projectId: string) {
  const param = { projectId };
  return {
    createStatus: (json: StatusCreate) => sent(projectId, api.statuses.$post({ param, json })),
    saveStatus: (id: string, json: StatusPatch) => sent(projectId, api.statuses[':id'].$patch({ param: { projectId, id }, json })),
    /** Deletes statuses, moving their lines to another. */
    deleteStatuses: (ids: string[], moveTo: string) => sent(projectId, api.statuses.delete.$post({ param, json: { ids, moveTo } })),
    createTag: (json: TagCreate) => sent(projectId, api.tags.$post({ param, json })),
    saveTag: (id: string, json: TagPatch) => sent(projectId, api.tags[':id'].$patch({ param: { projectId, id }, json })),
    deleteTags: (ids: string[]) => sent(projectId, api.tags.delete.$post({ param, json: { ids } })),
  };
}
