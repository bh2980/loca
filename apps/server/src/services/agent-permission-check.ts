import { and, eq, inArray, or } from 'drizzle-orm';
import { agentPermissionError, agentSettingsSchema, effectiveAgentPermissions } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

export function projectAgentSettings(db: Db, projectId: string) {
  return agentSettingsSchema.parse(db.select({ settings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.settings ?? {});
}

/** Checked both before proposing and immediately before execution, including old pending proposals. */
export function checkAgentPermission(db: Db, projectId: string, name: string, input: Record<string, unknown>): string | null {
  const settings = projectAgentSettings(db, projectId);
  const denied = agentPermissionError(settings, name, input);
  if (denied) return denied;
  // Deleting a character also deletes its relationships through FK cascades.
  if (name === 'delete_items' && input.kind === 'characters' && effectiveAgentPermissions(settings).relationships?.delete === false) {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string') : [];
    if (ids.length && db.select({ id: s.relationships.id }).from(s.relationships).where(and(eq(s.relationships.projectId, projectId), or(inArray(s.relationships.fromId, ids), inArray(s.relationships.toId, ids)))).limit(1).get()) {
      return '이 인물의 연결된 관계도 삭제됩니다. 관계 삭제 권한이 없어 요청을 적용하지 않았습니다.';
    }
  }
  return null;
}
