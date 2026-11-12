import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

/** A project's conversations, last changed first, each with its model use (its turns in the AI log). Only `ids` when given. */
export function chatSessionRows(db: Db, projectId: string, ids?: readonly string[]) {
  return db
    .select({
      id: s.chatSessions.id,
      title: s.chatSessions.title,
      connectionId: s.chatSessions.connectionId,
      model: s.chatSessions.model,
      effort: s.chatSessions.effort,
      permissionMode: s.chatSessions.permissionMode,
      updatedAt: s.chatSessions.updatedAt,
      calls: sql<number>`count(${s.aiCalls.id})`,
      tokens: sql<number>`coalesce(sum(${s.aiCalls.inputTokens}), 0) + coalesce(sum(${s.aiCalls.outputTokens}), 0)`,
    })
    .from(s.chatSessions)
    .leftJoin(s.aiCalls, eq(s.aiCalls.refId, s.chatSessions.id))
    .where(and(eq(s.chatSessions.projectId, projectId), ids ? inList(s.chatSessions.id, ids) : undefined))
    .groupBy(s.chatSessions.id)
    .orderBy(desc(s.chatSessions.updatedAt))
    .all();
}
