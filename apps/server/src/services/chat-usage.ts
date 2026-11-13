import { and, desc, eq, isNotNull, like, sql } from 'drizzle-orm';
import { estimateTokens, imageDecision, limitsFor } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { AGENT_SYSTEM } from './agent-tools.ts';
import { toolTokens } from './chat-turn.ts';

/**
 * What the composer shows next to the box (GET /chat/:id): how much of the model's window the last
 * answer's input took ("문맥 N%"), what the conversation has cost so far, and whether the chosen
 * model takes images. The window is only what the connection knows (its model list, a person's
 * entry, or what a call reported); an unknown window gives null and the meter hides. After a /compact
 * and before the next answer, the input is estimated from the summary and the messages after it.
 */
export function chatUsage(db: Db, chat: Pick<typeof s.chatSessions.$inferSelect, 'id' | 'projectId' | 'connectionId' | 'model' | 'messages' | 'compaction'>) {
  const connection = chat.connectionId ? db.select({ modelLimits: s.connections.modelLimits }).from(s.connections).where(eq(s.connections.id, chat.connectionId)).get() : undefined;
  const limits = chat.model ? limitsFor(connection, chat.model) : undefined;
  // The last answer's request (not the summary calls): its input is what the model read.
  const last = db
    .select({ inputTokens: s.aiCalls.inputTokens, startedAt: s.aiCalls.startedAt })
    .from(s.aiCalls)
    .where(and(eq(s.aiCalls.refId, chat.id), eq(s.aiCalls.status, 'ok'), isNotNull(s.aiCalls.inputTokens), like(s.aiCalls.label, '채팅%')))
    .orderBy(desc(s.aiCalls.startedAt))
    .get();
  const total = db
    .select({ calls: sql<number>`count(*)`, tokens: sql<number>`coalesce(sum(${s.aiCalls.inputTokens}), 0) + coalesce(sum(${s.aiCalls.outputTokens}), 0)`, cost: sql<number | null>`sum(${s.aiCalls.costUsd})` })
    .from(s.aiCalls)
    .where(eq(s.aiCalls.refId, chat.id))
    .get();
  const images = chat.model ? connection?.modelLimits[chat.model]?.images : undefined;
  const compaction = chat.compaction;
  const compactedSince = compaction !== null && compaction !== undefined && (!last || compaction.at > last.startedAt.getTime());
  // Every turn also sends the instructions and the tools' definitions: without them the estimate would read as an empty window.
  const lastInputTokens = compactedSince ? estimateTokens(AGENT_SYSTEM) + toolTokens(db, chat.projectId) + estimateTokens(compaction.summary) + estimateTokens((chat.messages as unknown[]).slice(compaction.upTo)) : last?.inputTokens ?? null;
  return {
    lastInputTokens,
    window: limits?.contextWindow ?? null,
    calls: total?.calls ?? 0,
    tokens: total?.tokens ?? 0,
    costUsd: total?.cost ?? null,
    images: imageDecision(images, 1).support,
  };
}
