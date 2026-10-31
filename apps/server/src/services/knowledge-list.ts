import { z } from 'zod';
import { type AutoMark, DECIDED_BY, type DecidedBy, type KnowledgeItem, type KnowledgeTagKind, KNOWLEDGE_MARK_IDS, knowledgeMarksOf, knowledgeMatches } from '@tw/shared';
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
/** knowledgeFilterInput as a tool receives it: tags by name or id (tagIdsOf turns them into ids for knowledgeMatches). */
export type KnowledgeFilterInput = { status?: ('candidate' | 'confirmed')[]; decidedBy?: DecidedBy; marks?: AutoMark[]; unreviewed?: boolean; tags?: string[] };

/** Tag names or ids (an optional leading #) as the project's tag ids; a name nobody has stays as typed so nothing matches. */
export function tagIdsOf(db: Db, projectId: string, wanted: readonly string[] | undefined) {
  if (!wanted?.length) return [];
  const tags = db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all();
  return wanted.map((value) => tags.find((tag) => tag.id === value || tag.name === value.replace(/^#/, ''))?.id ?? value);
}

/** Rows of one knowledge kind with `marks` and `tags` (names) added, filtered as the app's lists filter them (knowledgeMatches). */
export function annotateKnowledge<T extends KnowledgeItem & { evidence?: string[] }>(db: Db, projectId: string, kind: KnowledgeTagKind, rows: T[], filter: KnowledgeFilterInput = {}) {
  const names = new Map(db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.id, tag.name]));
  const shared = { ...filter, tags: tagIdsOf(db, projectId, filter.tags) };
  return withTags(db, kind, rows)
    .filter((row) => knowledgeMatches(row, shared))
    .map(({ tags, ...row }) => ({ ...row, marks: knowledgeMarksOf(row), tags: tags.map((tag) => names.get(tag.id) ?? tag.id) }));
}
