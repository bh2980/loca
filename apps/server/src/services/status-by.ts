import { eq } from 'drizzle-orm';
import { aiConfirmSchema, type AiConfirm } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** Knowledge tables and the glossary: rows a person or AI confirms (docs/DESIGN.md 3.5). */
export type DecidedTable = typeof s.documents | typeof s.characters | typeof s.relationships | typeof s.storyEvents | typeof s.speechRules | typeof s.terms;

/**
 * What a person's save adds to an item: they set its status now, and when they rewrote any of its
 * content (not just its status) the content is theirs too, so 출처 becomes 사람.
 */
export function byPerson(db: Db, table: DecidedTable, id: string, body: Record<string, unknown>) {
  // One id column shape across these tables; the cast only picks it.
  const t = table as typeof s.terms;
  const row = db.select().from(t).where(eq(t.id, id)).get() as Record<string, unknown> | undefined;
  const rewrote = Boolean(row) && Object.entries(body).some(([key, value]) => key !== 'status' && value !== undefined && JSON.stringify(row![key]) !== JSON.stringify(value));
  return { statusBy: 'human' as const, ...(rewrote ? { origin: 'human' as const } : {}) };
}

/** The project's AI › 사용 방식, every kind filled (absent kinds: auto). Read when AI results are saved. */
export const aiConfirmOf = (db: Db, projectId: string): AiConfirm =>
  aiConfirmSchema.parse(db.select({ aiConfirm: s.projects.aiConfirm }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.aiConfirm ?? {});
