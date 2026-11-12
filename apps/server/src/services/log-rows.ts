import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

/**
 * Model requests from the AI log as their lists show them: without what was sent or printed (that can be
 * a whole script and is read one call at a time), with whether each was kept. Its connection is named by id
 * and kind: the name is the connections collection's. A project's calls by `projectId`, or (null) those
 * outside any project: model tests. By id.
 */
export function aiCallRows(db: Db, projectId: string | null, ids: readonly string[]) {
  if (!ids.length) return [];
  const { request: _request, response: _response, ...listed } = getTableColumns(s.aiCalls);
  return db
    .select({ ...listed, hasRequest: sql`${s.aiCalls.request} is not null`.mapWith(Boolean), hasResponse: sql`${s.aiCalls.response} is not null`.mapWith(Boolean) })
    .from(s.aiCalls)
    .where(and(projectId === null ? isNull(s.aiCalls.projectId) : eq(s.aiCalls.projectId, projectId), inList(s.aiCalls.id, ids)))
    .all();
}

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
