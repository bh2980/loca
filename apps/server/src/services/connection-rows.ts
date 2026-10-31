import { asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import type { SecretStore } from './secrets.ts';

/**
 * Connections as the settings and model pickers list them: a project's own (`projectId`) or the home's
 * (null, the ones a new project copies), by name, with whether a key is stored (the key itself stays in
 * the OS keyring) and whether a copied key still waits to be applied. Only `ids` when given.
 */
export function connectionRows(db: Db, secrets: SecretStore, projectId: string | null, ids?: readonly string[]) {
  const scope = projectId === null ? isNull(s.connections.projectId) : eq(s.connections.projectId, projectId);
  const rows = db.select().from(s.connections).where(ids ? inList(s.connections.id, ids) : scope).orderBy(asc(s.connections.name)).all()
    .filter((row) => row.projectId === projectId);
  const copying = new Set(db.select({ id: s.connectionKeyCopies.targetId }).from(s.connectionKeyCopies).where(inList(s.connectionKeyCopies.targetId, rows.map((row) => row.id))).all().map((row) => row.id));
  return rows.map((row) => ({ ...row, hasKey: secrets.get(row.id) !== null, keyCopyPending: copying.has(row.id) }));
}
