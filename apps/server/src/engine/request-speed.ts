import { and, desc, eq, gt, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** The latest calls looked at: a model's speed now, not its history. */
const LATEST = 10;

/**
 * How long a request that writes `outputTokens` takes on this model of this connection: the wait for the answer plus
 * its tokens at the model's output speed, read off its latest calls (모델 시험 writes a few hundred tokens for this; runs,
 * the editor and the chat count too). Calls of several answer lengths give both (seconds = wait + tokens / speed); one
 * length gives the speed alone. Reading the prompt is far quicker than writing the answer and is left out. null when the
 * model has made no call that wrote anything.
 */
export function requestSeconds(db: Db, connectionId: string, model: string, outputTokens: number): number | null {
  const calls = db
    .select({ started: s.aiCalls.startedAt, finished: s.aiCalls.finishedAt, tokens: s.aiCalls.outputTokens })
    .from(s.aiCalls)
    .where(and(eq(s.aiCalls.connectionId, connectionId), eq(s.aiCalls.model, model), eq(s.aiCalls.status, 'ok'), isNotNull(s.aiCalls.finishedAt), gt(s.aiCalls.outputTokens, 0)))
    .orderBy(desc(s.aiCalls.startedAt))
    .limit(LATEST)
    .all()
    .map((call) => ({ tokens: call.tokens!, seconds: (call.finished!.getTime() - call.started.getTime()) / 1000 }))
    .filter((call) => call.seconds > 0);
  if (!calls.length) return null;
  const sizes = calls.map((call) => call.tokens);
  if (Math.max(...sizes) >= 2 * Math.min(...sizes)) {
    const n = calls.length;
    const mx = sizes.reduce((sum, x) => sum + x, 0) / n;
    const my = calls.reduce((sum, call) => sum + call.seconds, 0) / n;
    const slope = calls.reduce((sum, call) => sum + (call.tokens - mx) * (call.seconds - my), 0) / calls.reduce((sum, call) => sum + (call.tokens - mx) ** 2, 0);
    if (slope > 0) return Math.max(0, my - slope * mx) + slope * outputTokens;
  }
  const perToken = calls.map((call) => call.seconds / call.tokens).sort((a, b) => a - b);
  return perToken[Math.floor(perToken.length / 2)] * outputTokens;
}
