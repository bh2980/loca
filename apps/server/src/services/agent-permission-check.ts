import { eq } from 'drizzle-orm';
import { agentPermissionError, agentSettingsSchema } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

export function projectAgentSettings(db: Db, projectId: string) {
  return agentSettingsSchema.parse(db.select({ settings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.settings ?? {});
}

/**
 * Why the project's agent permissions, as they are now, do not allow this call, by what its spec says it needs
 * (TOOL_SPECS); null when they do. What a call needs beyond its spec is the tool's own to say (its `permit`):
 * checkAgentPermission (agent-catalog.ts) asks both.
 */
export const specPermissionError = (db: Db, projectId: string, name: string, input: Record<string, unknown>): string | null => agentPermissionError(projectAgentSettings(db, projectId), name, input);
