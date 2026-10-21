import type * as ai from '@tw/ai';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';

export interface CallMeta {
  projectId: string | null;
  kind: (typeof s.AI_CALL_KINDS)[number];
  refId?: string | null;
  label: string;
  /** What was sent, kept so the record can show it (glossary fills). */
  request?: string;
}

const usageOf = (usage: ai.Usage | undefined) => ({
  inputTokens: usage?.inputTokens ?? null,
  cachedInputTokens: usage?.cachedInputTokens ?? null,
  outputTokens: usage?.outputTokens ?? null,
  costUsd: usage?.costUsd ?? null,
});

/**
 * What a call reported about its model's limits (Claude Code does) is kept in the connection's
 * modelLimits under the model id the user picked, for "auto" budgets; a person's numbers stay.
 */
export function learnLimits(db: Db, connectionId: string | undefined, model: string, learned: ai.Usage['limits']) {
  if (!connectionId || (!learned?.contextWindow && !learned?.maxOutput)) return;
  const current = db.select({ limits: s.connections.modelLimits }).from(s.connections).where(eq(s.connections.id, connectionId)).get()?.limits;
  if (!current || current[model]?.by === 'human') return;
  const entry = { ...current[model], ...(learned.contextWindow && { contextWindow: learned.contextWindow }), ...(learned.maxOutput && { maxOutput: learned.maxOutput }), by: 'api' as const };
  if (JSON.stringify(entry) === JSON.stringify(current[model])) return;
  db.update(s.connections).set({ modelLimits: { ...current, [model]: entry } }).where(eq(s.connections.id, connectionId)).run();
  events.changed(undefined, 'connections');
}

/** Starts a log row for a request going out to `route`; finish it with the returned function. */
export function startCall(db: Db, meta: CallMeta, route: Pick<ai.ResolvedRoute, 'kind' | 'model' | 'connectionId'>) {
  const id = crypto.randomUUID();
  db.insert(s.aiCalls)
    .values({ id, projectId: meta.projectId, kind: meta.kind, refId: meta.refId ?? null, label: meta.label, connectionId: route.connectionId ?? null, connectionKind: route.kind, model: route.model, request: meta.request ?? null, startedAt: new Date() })
    .run();
  // A chat's panel shows its turn's current step (see GET /chat/:sessionId).
  const topics = meta.kind === 'chat' ? (['calls', 'chat'] as const) : (['calls'] as const);
  events.changed(meta.projectId ?? undefined, ...topics);
  let done = false;
  // Idempotent: a stream can report an error and then an abort for the same request.
  return (outcome: { usage?: ai.Usage; error?: unknown }) => {
    if (done) return;
    done = true;
    const error = outcome.error === undefined ? null : outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    db.update(s.aiCalls)
      .set({ status: error === null ? 'ok' : 'failed', error, response: (outcome.error as { output?: string } | undefined)?.output ?? null, ...usageOf(outcome.usage ?? (outcome.error as { usage?: ai.Usage } | undefined)?.usage), finishedAt: new Date() })
      .where(eq(s.aiCalls.id, id))
      .run();
    events.changed(meta.projectId ?? undefined, ...topics);
    learnLimits(db, route.connectionId, route.model, outcome.usage?.limits);
  };
}

/** One logged model request: `call` is the request itself (one attempt on one route). */
export async function logged<T extends { usage?: ai.Usage }>(db: Db, meta: CallMeta, route: Pick<ai.ResolvedRoute, 'kind' | 'model' | 'connectionId'>, call: () => Promise<T>): Promise<T> {
  const finish = startCall(db, meta, route);
  try {
    const result = await call();
    finish({ usage: result.usage });
    return result;
  } catch (error) {
    finish({ error });
    throw error;
  }
}

/** Calls left 'running' by a server that stopped mid-request never finish: mark them at startup. */
export function closeStaleCalls(db: Db) {
  db.update(s.aiCalls).set({ status: 'failed', error: '서버가 다시 시작되어 응답을 받지 못했습니다.', finishedAt: new Date() }).where(eq(s.aiCalls.status, 'running')).run();
}
