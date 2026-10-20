import { and, eq } from 'drizzle-orm';
import type { KnowledgeTagKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { clearReview } from './knowledge-tags.ts';

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
 * What a person's save adds to an item of the project: they set its status now, and when they rewrote
 * any of its content (not just its status) the content is theirs too, so 출처 becomes 사람. They have
 * looked at it, so 확인 권장 comes off (a write here, made before the caller's update).
 */
export function byPerson(db: Pick<Db, 'select' | 'insert' | 'delete'>, table: DecidedTable, projectId: string, id: string, body: Record<string, unknown>) {
  // One id column shape across these tables; the cast only picks it.
  const t = table as typeof s.terms;
  const row = db.select().from(t).where(and(eq(t.id, id), eq(t.projectId, projectId))).get() as Record<string, unknown> | undefined;
  if (row) clearReview(db, projectId, KIND_OF.get(table)!, [id]);
  const rewrote = Boolean(row) && Object.entries(body).some(([key, value]) => key !== 'status' && value !== undefined && JSON.stringify(row![key]) !== JSON.stringify(value));
  return { statusBy: 'human' as const, ...(rewrote ? { origin: 'human' as const } : {}) };
}

/** The project's AI 문맥 switch (설정 › 프로젝트): whether AI results that are knowledge or terms are confirmed right away. Read when they are saved. */
export const aiAutoConfirmOf = (db: Db, projectId: string): boolean =>
  db.select({ on: s.projects.aiAutoConfirm }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.on ?? true;
