import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { connectionName, connectionNames } from './run-detail.ts';

/**
 * Model requests from the AI log as their lists show them: without what was sent or printed (that can be
 * a whole script and is read one call at a time), with whether each was kept and the connection's name.
 * A project's calls by `projectId`, or (null) those outside any project: model tests. By id.
 */
export function aiCallRows(db: Db, projectId: string | null, ids: readonly string[]) {
  const { request: _request, response: _response, ...listed } = getTableColumns(s.aiCalls);
  const calls = db
    .select({ ...listed, hasRequest: sql<boolean>`${s.aiCalls.request} is not null`, hasResponse: sql<boolean>`${s.aiCalls.response} is not null` })
    .from(s.aiCalls)
    .where(and(projectId === null ? isNull(s.aiCalls.projectId) : eq(s.aiCalls.projectId, projectId), inList(s.aiCalls.id, ids)))
    .all();
  const names = connectionNames(db);
  return calls.map((call) => ({ ...call, hasRequest: Boolean(call.hasRequest), hasResponse: Boolean(call.hasResponse), connectionName: connectionName(names, call.connectionId, call.connectionKind) }));
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
