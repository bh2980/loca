import { z } from 'zod';
import { type AutoMark, type KnowledgeStatus, type KnowledgeTagKind, KNOWLEDGE_MARK_IDS, knowledgeMarksOf, matchesMarks, type StatusBy, UNREVIEWED_MARKS } from '@tw/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { withTags } from './knowledge-tags.ts';

/**
 * The filter every knowledge list tool/command takes (documents, characters, relationships,
 * events, speech rules, and the glossary): the app's `marks` rules (matchesMarks), `unreviewed`
 * (= UNREVIEWED_MARKS: candidate or decided by AI), and tags that must all be on the item.
 */
export const knowledgeFilterInput = {
  marks: z.array(z.enum(KNOWLEDGE_MARK_IDS as [AutoMark, ...AutoMark[]])).optional().describe('Automatic marks (candidate, ai, noEvidence); candidate + ai together mean either one, as in the app.'),
  unreviewed: z.boolean().optional().describe('Shortcut for marks candidate + ai: items no person has decided yet.'),
  tags: z.array(z.string()).optional().describe('Tag names or ids the item must all carry.'),
};
export type KnowledgeFilter = { marks?: AutoMark[]; unreviewed?: boolean; tags?: string[] };

/** The marks a filter asks for (`unreviewed` adds UNREVIEWED_MARKS). */
export const pickedMarks = (filter: Pick<KnowledgeFilter, 'marks' | 'unreviewed'>): AutoMark[] => [...(filter.marks ?? []), ...(filter.unreviewed ? UNREVIEWED_MARKS : [])];

/** Tag names or ids (an optional leading #) as the project's tag ids; a name nobody has stays as typed so nothing matches. */
export function tagIdsOf(db: Db, projectId: string, wanted: readonly string[] | undefined) {
  if (!wanted?.length) return [];
  const tags = db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all();
  return wanted.map((value) => tags.find((tag) => tag.id === value || tag.name === value.replace(/^#/, ''))?.id ?? value);
}

/** Rows of one knowledge kind with `marks` and `tags` (names) added, filtered like the app's lists. */
export function annotateKnowledge<T extends { id: string; status: KnowledgeStatus; statusBy: StatusBy; evidence?: string[] }>(db: Db, projectId: string, kind: KnowledgeTagKind, rows: T[], filter: KnowledgeFilter = {}) {
  const names = new Map(db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.id, tag.name]));
  const wanted = tagIdsOf(db, projectId, filter.tags);
  const picked = pickedMarks(filter);
  return withTags(db, kind, rows)
    .map(({ tags, ...row }) => ({ ...row, marks: knowledgeMarksOf(row), tags: tags.map((tag) => names.get(tag.id) ?? tag.id), tagIds: tags.map((tag) => tag.id) }))
    .filter((row) => matchesMarks(row.marks, picked) && wanted.every((id) => row.tagIds.includes(id)))
    .map(({ tagIds: _ids, ...row }) => row);
}
