import { z } from 'zod';
import { type AutoMark, DECIDED_BY, decidedBy, type DecidedBy, type KnowledgeStatus, type KnowledgeTagKind, isUnreviewed, KNOWLEDGE_MARK_IDS, knowledgeMarksOf, matchesMarks, type StatusBy } from '@tw/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { withTags } from './knowledge-tags.ts';

/**
 * The filter every knowledge list tool/command takes (documents, characters, relationships,
 * events, speech rules, and the glossary): `status` (the 상태 column), `decidedBy` (정한 쪽), the app's `marks` (all must
 * hold), `unreviewed` (isUnreviewed: candidate or decided by AI), and tags that must all be on the item.
 */
export const knowledgeFilterInput = {
  status: z.array(z.enum(['candidate', 'confirmed'])).optional().describe('Status (the 상태 column): candidate = not yet used as context, confirmed. Several mean either.'),
  decidedBy: z.enum(DECIDED_BY).optional().describe('Who decided it (정한 쪽): ai = confirmed by AI and not checked by a person yet (✦); human = decided by a person. Candidates match neither.'),
  marks: z.array(z.enum(KNOWLEDGE_MARK_IDS as [AutoMark, ...AutoMark[]])).optional().describe('Automatic marks (review, noEvidence); all given must hold.'),
  unreviewed: z.boolean().optional().describe('Items no person has decided yet: status candidate, or decided by AI.'),
  tags: z.array(z.string()).optional().describe('Tag names or ids the item must all carry.'),
};
export type KnowledgeFilter = { status?: ('candidate' | 'confirmed')[]; decidedBy?: DecidedBy; marks?: AutoMark[]; unreviewed?: boolean; tags?: string[] };

/** Whether an item passes the filter's `status`, `decidedBy` and `unreviewed` (marks and tags are checked by the caller). */
export const matchesStatus = (row: { status: KnowledgeStatus; statusBy: StatusBy }, filter: Pick<KnowledgeFilter, 'status' | 'decidedBy' | 'unreviewed'>) =>
  (!filter.status?.length || filter.status.includes(row.status as 'candidate' | 'confirmed')) && (!filter.decidedBy || decidedBy(row, filter.decidedBy)) && (!filter.unreviewed || isUnreviewed(row));

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
  return withTags(db, kind, rows)
    .map(({ tags, ...row }) => ({ ...row, marks: knowledgeMarksOf(row), tags: tags.map((tag) => names.get(tag.id) ?? tag.id), tagIds: tags.map((tag) => tag.id) }))
    .filter((row) => matchesMarks(row.marks, filter.marks) && matchesStatus(row, filter) && wanted.every((id) => row.tagIds.includes(id)))
    .map(({ tagIds: _ids, ...row }) => row);
}
