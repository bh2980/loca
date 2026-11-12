import { eq, inArray } from 'drizzle-orm';
import { badRequest } from '../refusal.ts';
import type { ConnectionTarget, ModelTarget } from '@loca/ai';
import { choiceKey, CONNECTION_KIND_INFO, connectionCan, definitionModels, type Capability, type ConnectionKind, type ModelChoice, type WorkflowDefinition } from '@loca/shared';
import type { Db } from '../db/index.ts';
import { connections, type AiSnapshot, type TargetSnapshot } from '../db/schema.ts';
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
  const target: TargetSnapshot = {
    connectionId: connection.id,
    name: connection.name,
    kind: connection.kind,
    baseUrl: connection.baseUrl,
    executable: connection.executable,
    model: choice.model,
    effort: choice.effort || null,
  };
  return { label: choiceLabel(connection.name, choice), maxOutputTokens: connection.modelLimits[choice.model]?.maxOutput, target };
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

/** Every model a workflow may call (its AI nodes' and what their retry rules send lines back on), frozen for a run. */
export const snapshotWorkflowModels = (db: Db, definition: WorkflowDefinition) => snapshotChoices(db, definitionModels(definition));

/** Where a frozen choice's calls go: its connection as it was, with the key read now. */
export function resolveTarget(db: Db, snapshot: AiSnapshot, secrets: SecretStore): ModelTarget {
  const { target } = snapshot;
  return {
    connectionId: target.connectionId,
    kind: target.kind as ConnectionKind,
    baseUrl: target.baseUrl ?? undefined,
    executable: target.executable ?? undefined,
    model: target.model,
    effort: target.effort ?? undefined,
    apiKey: connectionKey(db, secrets, target.connectionId) ?? undefined,
  };
}

/** What a person is told when the connection they picked cannot do what it was picked for. */
const CANNOT: Record<Capability, (label: string) => string> = {
  generate: (label) => `${label} 연결은 글을 쓰지 못해 여기에 쓸 수 없습니다.`,
  judge: (label) => `${label} 연결은 판정 연결이 아닙니다.`,
  chat: (label) => `${label} 연결은 채팅에 쓸 수 없습니다.`,
  complete: () => '편집기 자동완성은 API 연결(OpenAI 호환)만 쓸 수 있습니다.',
  tool: (label) => `${label} 연결은 HTTP 호출의 API 키가 아닙니다.`,
};

/**
 * A choice made now (chat, analysis, glossary fill, a test), resolved for use; throws a message
 * for people when the connection is gone or cannot do `need`.
 */
export function liveChoice(db: Db, choice: ModelChoice, secrets: SecretStore, need: Capability) {
  const snapshot = snapshotChoice(db, choice);
  if (!snapshot) badRequest('고른 AI 연결이 없습니다. 다시 고르세요.');
  const kind = snapshot.target.kind as ConnectionKind;
  if (!connectionCan(kind, need)) badRequest(CANNOT[need](CONNECTION_KIND_INFO[kind].label));
  return { snapshot, target: resolveTarget(db, snapshot, secrets) };
}

/** A stored connection as a target with no model picked (its model list, a reachability check, its login). */
export function connectionTarget(db: Db, connectionId: string, secrets: SecretStore): ConnectionTarget | undefined {
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
