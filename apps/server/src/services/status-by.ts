import { and, eq } from 'drizzle-orm';
import type { KnowledgeTagKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { clearReview } from './knowledge-tags.ts';
import { knowledgeOf } from './speech.ts';

/** Knowledge tables and the glossary: rows a person or AI confirms. */
export type DecidedTable = typeof s.documents | typeof s.characters | typeof s.relationships | typeof s.storyEvents | typeof s.speechRules | typeof s.terms;

const KIND_OF = new Map<DecidedTable, KnowledgeTagKind>([
  [s.documents, 'documents'],
  [s.characters, 'characters'],
  [s.relationships, 'relationships'],
  [s.storyEvents, 'events'],
  [s.speechRules, 'speechRules'],
  [s.terms, 'terms'],
]);

/**
 * Who a save comes from: who wrote the content (출처) and who decided its status. A person in the app
 * did both. An agent's change (chat, terminal) was written by AI; a person who accepted the proposal
 * decided it, while one the terminal's permission mode applied (auto, bypass) was decided by AI too.
 */
export interface Saver {
  origin: 'human' | 'ai';
  statusBy: 'human' | 'ai';
}
export const PERSON: Saver = { origin: 'human', statusBy: 'human' };
export const proposalSaver = (decidedBy: 'person' | 'auto' | 'bypass'): Saver => ({ origin: 'ai', statusBy: decidedBy === 'person' ? 'human' : 'ai' });

/**
 * What a save adds to an item of the project: the saver set its status now, and when it rewrote any of
 * its content (not just its status) the content is the saver's too. A person has looked at it, so
 * 확인 권장 comes off (a write here, made before the caller's update).
 */
export function bySaver(db: Pick<Db, 'select' | 'update'>, table: DecidedTable, projectId: string, id: string, body: Record<string, unknown>, saver: Saver = PERSON) {
  // One id column shape across these tables; the cast only picks it.
  const t = table as typeof s.terms;
  const row = db.select().from(t).where(and(eq(t.id, id), eq(t.projectId, projectId))).get() as Record<string, unknown> | undefined;
  if (row && saver.statusBy === 'human') clearReview(db, projectId, KIND_OF.get(table)!, [id]);
  const rewrote = Boolean(row) && Object.entries(body).some(([key, value]) => key !== 'status' && value !== undefined && JSON.stringify(row![key]) !== JSON.stringify(value));
  return { statusBy: saver.statusBy, ...(rewrote ? { origin: saver.origin } : {}) };
}

/** A person's save in the app. */
export const byPerson = (db: Pick<Db, 'select' | 'update'>, table: DecidedTable, projectId: string, id: string, body: Record<string, unknown>) => bySaver(db, table, projectId, id, body, PERSON);

/** The project's AI 문맥 switch (설정 › 프로젝트): whether AI results that are knowledge or terms are confirmed right away. Read when they are saved. */
export const aiAutoConfirmOf = (db: Db, projectId: string): boolean => knowledgeOf(db, projectId).settings()?.aiAutoConfirm ?? true;
