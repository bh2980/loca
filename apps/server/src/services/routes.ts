import { eq, inArray } from 'drizzle-orm';
import type { ResolvedRoute } from '@tw/ai';
import type { ConnectionKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { connections, profiles, type ProfileSnapshot } from '../db/schema.ts';
import type { SecretStore } from './secrets.ts';

/** Freezes a profile and its connections so a run keeps using what it started with. */
export function snapshotProfiles(db: Db, ids: string[]): Record<string, ProfileSnapshot> {
  if (!ids.length) return {};
  const rows = db.select().from(profiles).where(inArray(profiles.id, ids)).all();
  const connectionIds = rows.flatMap((row) => [row.connectionId, ...row.fallbacks.map((route) => route.connectionId)]);
  const byId = new Map(db.select().from(connections).where(inArray(connections.id, connectionIds)).all().map((row) => [row.id, row]));
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        instructions: row.instructions,
        temperature: row.temperature,
        maxOutputTokens: row.maxOutputTokens,
        timeoutSeconds: row.timeoutSeconds,
        maxAttempts: row.maxAttempts,
        routes: [{ connectionId: row.connectionId, model: row.model, effort: row.effort }, ...row.fallbacks].flatMap((route) => {
          const connection = byId.get(route.connectionId);
          return connection
            ? [{ connectionId: connection.id, kind: connection.kind, baseUrl: connection.baseUrl, executable: connection.executable, model: route.model, effort: route.effort ?? null }]
            : [];
        }),
      },
    ]),
  );
}

export function resolveRoutes(snapshot: ProfileSnapshot, secrets: SecretStore): ResolvedRoute[] {
  return snapshot.routes.map((route) => ({
    kind: route.kind as ConnectionKind,
    baseUrl: route.baseUrl ?? undefined,
    executable: route.executable ?? undefined,
    model: route.model,
    effort: route.effort ?? undefined,
    apiKey: secrets.get(route.connectionId) ?? undefined,
  }));
}

export function liveProfileRoutes(db: Db, profileId: string, secrets: SecretStore) {
  const snapshot = snapshotProfiles(db, [profileId])[profileId];
  return snapshot ? { snapshot, routes: resolveRoutes(snapshot, secrets) } : undefined;
}

export function connectionRoute(db: Db, connectionId: string, secrets: SecretStore) {
  const connection = db.select().from(connections).where(eq(connections.id, connectionId)).get();
  if (!connection) return undefined;
  return {
    kind: connection.kind,
    baseUrl: connection.baseUrl ?? undefined,
    executable: connection.executable ?? undefined,
    apiKey: secrets.get(connection.id) ?? undefined,
  };
}
