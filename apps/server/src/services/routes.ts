import { eq, inArray } from 'drizzle-orm';
import type { ResolvedRoute } from '@tw/ai';
import { choiceKey, CONNECTION_KIND_INFO, definitionModels, type Capability, type ConnectionKind, type ModelChoice, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { connections, type AiSnapshot, type RouteSnapshot } from '../db/schema.ts';
import { connectionKey } from './app-defaults.ts';
import type { SecretStore } from './secrets.ts';

type Connection = typeof connections.$inferSelect;

export const choiceLabel = (name: string, choice: { model: string; effort?: string | null }) => [name, choice.model, choice.effort].filter(Boolean).join(' · ');

/** Freezes a model choice with its connection, so work keeps using what it started with. */
export function snapshotChoice(db: Db, choice: ModelChoice, byId = new Map<string, Connection>()): AiSnapshot | undefined {
  if (!byId.has(choice.connectionId)) {
    const row = db.select().from(connections).where(eq(connections.id, choice.connectionId)).get();
    if (row) byId.set(row.id, row);
  }
  const connection = byId.get(choice.connectionId);
  if (!connection) return undefined;
  const route: RouteSnapshot = {
    connectionId: connection.id,
    name: connection.name,
    kind: connection.kind,
    baseUrl: connection.baseUrl,
    executable: connection.executable,
    model: choice.model,
    effort: choice.effort || null,
  };
  return { label: choiceLabel(connection.name, choice), maxOutputTokens: connection.modelLimits[choice.model]?.maxOutput, route };
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

/** Every model a workflow may call (its AI nodes' and what its 재요청 nodes send lines back on), frozen for a run. */
export const snapshotWorkflowModels = (db: Db, definition: WorkflowDefinition) => snapshotChoices(db, definitionModels(definition));

export function resolveRoute(db: Db, snapshot: AiSnapshot, secrets: SecretStore): ResolvedRoute {
  const { route } = snapshot;
  return {
    connectionId: route.connectionId,
    kind: route.kind as ConnectionKind,
    baseUrl: route.baseUrl ?? undefined,
    executable: route.executable ?? undefined,
    model: route.model,
    effort: route.effort ?? undefined,
    apiKey: connectionKey(db, secrets, route.connectionId) ?? undefined,
  };
}

/**
 * A choice made now (chat, analysis, glossary fill, a test), resolved for use; throws a message
 * for people when the connection is gone or cannot do `need`.
 */
export function liveChoice(db: Db, choice: ModelChoice, secrets: SecretStore, need: Capability) {
  const snapshot = snapshotChoice(db, choice);
  if (!snapshot) throw new Error('고른 AI 연결이 없습니다. 다시 고르세요.');
  const kind = snapshot.route.kind as ConnectionKind;
  if (!CONNECTION_KIND_INFO[kind].capabilities.includes(need))
    throw new Error(need === 'chat' ? `${CONNECTION_KIND_INFO[kind].label} 연결은 채팅에 쓸 수 없습니다.` : `${CONNECTION_KIND_INFO[kind].label} 연결은 판정 전용이라 여기에 쓸 수 없습니다.`);
  return { snapshot, route: resolveRoute(db, snapshot, secrets) };
}

export function connectionRoute(db: Db, connectionId: string, secrets: SecretStore) {
  const connection = db.select().from(connections).where(eq(connections.id, connectionId)).get();
  if (!connection) return undefined;
  return {
    connectionId: connection.id,
    kind: connection.kind,
    baseUrl: connection.baseUrl ?? undefined,
    executable: connection.executable ?? undefined,
    apiKey: connectionKey(db, secrets, connection.id) ?? undefined,
  };
}
