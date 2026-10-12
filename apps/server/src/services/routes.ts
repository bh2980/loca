import { eq, inArray } from 'drizzle-orm';
import type { ResolvedRoute } from '@tw/ai';
import { choiceKey, CONNECTION_KIND_INFO, nodeModels, type Capability, type ConnectionKind, type ModelChoice, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { connections, type AiSnapshot, type RouteSnapshot } from '../db/schema.ts';
import type { SecretStore } from './secrets.ts';

/** Fallbacks followed after the picked connection (each connection's own "막히면", in turn). */
const MAX_FALLBACKS = 3;

type Connection = typeof connections.$inferSelect;

export const choiceLabel = (name: string, choice: { model: string; effort?: string | null }) => [name, choice.model, choice.effort].filter(Boolean).join(' · ');

/**
 * Freezes a model choice with its connection, so work keeps using what it started with: the
 * picked route, then the connection's fallback chain, with the picked connection's call settings.
 */
export function snapshotChoice(db: Db, choice: ModelChoice, byId = new Map<string, Connection>()): AiSnapshot | undefined {
  const get = (id: string) => {
    if (!byId.has(id)) {
      const row = db.select().from(connections).where(eq(connections.id, id)).get();
      if (row) byId.set(id, row);
    }
    return byId.get(id);
  };
  const primary = get(choice.connectionId);
  if (!primary) return undefined;
  const route = (connection: Connection, model: string, effort: string | null | undefined): RouteSnapshot => ({
    connectionId: connection.id,
    name: connection.name,
    kind: connection.kind,
    baseUrl: connection.baseUrl,
    executable: connection.executable,
    model,
    effort: effort || null,
    piOptions: connection.options ?? null,
  });
  const routes = [route(primary, choice.model, choice.effort)];
  const seen = new Set([choiceKey(choice)]);
  let next = primary.fallback;
  while (next && routes.length <= MAX_FALLBACKS && !seen.has(choiceKey(next))) {
    seen.add(choiceKey(next));
    const connection = get(next.connectionId);
    if (!connection) break;
    routes.push(route(connection, next.model, next.effort));
    next = connection.fallback;
  }
  return { label: choiceLabel(primary.name, choice), maxOutputTokens: primary.maxOutputTokens, timeoutSeconds: primary.timeoutSeconds, maxAttempts: primary.maxAttempts, routes };
}

/** Snapshots of several choices, keyed by choiceKey (a run's AI nodes). Choices whose connection is gone are left out. */
export function snapshotChoices(db: Db, choices: ModelChoice[]): Record<string, AiSnapshot> {
  if (!choices.length) return {};
  const byId = new Map(db.select().from(connections).where(inArray(connections.id, [...new Set(choices.map((choice) => choice.connectionId))])).all().map((row) => [row.id, row]));
  return Object.fromEntries(choices.flatMap((choice) => {
    const snapshot = snapshotChoice(db, choice, byId);
    return snapshot ? [[choiceKey(choice), snapshot]] : [];
  }));
}

/** Every model a workflow's AI nodes may call, frozen for a run. */
export const snapshotWorkflowModels = (db: Db, definition: WorkflowDefinition) => snapshotChoices(db, definition.nodes.flatMap((node) => (node.type === 'ai' ? nodeModels(node) : [])));

export function resolveRoutes(snapshot: AiSnapshot, secrets: SecretStore): ResolvedRoute[] {
  return snapshot.routes.map((route) => ({
    connectionId: route.connectionId,
    kind: route.kind as ConnectionKind,
    baseUrl: route.baseUrl ?? undefined,
    executable: route.executable ?? undefined,
    model: route.model,
    effort: route.effort ?? undefined,
    apiKey: secrets.get(route.connectionId) ?? undefined,
    piOptions: route.piOptions ?? undefined,
  }));
}

/**
 * A choice made now (chat, analysis, glossary fill, a test), resolved for use; throws a message
 * for people when the connection is gone or cannot do `need`.
 */
export function liveChoice(db: Db, choice: ModelChoice, secrets: SecretStore, need: Capability) {
  const snapshot = snapshotChoice(db, choice);
  if (!snapshot) throw new Error('고른 AI 연결이 없습니다. 다시 고르세요.');
  const kind = snapshot.routes[0]!.kind as ConnectionKind;
  if (!CONNECTION_KIND_INFO[kind].capabilities.includes(need))
    throw new Error(need === 'chat' ? `${CONNECTION_KIND_INFO[kind].label} 연결은 채팅에 쓸 수 없습니다.` : `${CONNECTION_KIND_INFO[kind].label} 연결은 판정 전용이라 여기에 쓸 수 없습니다.`);
  return { snapshot, routes: resolveRoutes(snapshot, secrets) };
}

export function connectionRoute(db: Db, connectionId: string, secrets: SecretStore) {
  const connection = db.select().from(connections).where(eq(connections.id, connectionId)).get();
  if (!connection) return undefined;
  return {
    connectionId: connection.id,
    kind: connection.kind,
    baseUrl: connection.baseUrl ?? undefined,
    executable: connection.executable ?? undefined,
    apiKey: secrets.get(connection.id) ?? undefined,
    piOptions: connection.options ?? undefined,
  };
}

/** What templates and imported workflows start with: the first AI connection (by name) that has a default model. */
export function defaultModelChoice(db: Db): { connectionId: string; model: string; effort?: string } {
  const connection = db
    .select()
    .from(connections)
    .all()
    .filter((row) => row.defaultModel && CONNECTION_KIND_INFO[row.kind].capabilities.includes('generate'))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return connection ? { connectionId: connection.id, model: connection.defaultModel!, ...(connection.defaultEffort && { effort: connection.defaultEffort }) } : { connectionId: '', model: '' };
}
