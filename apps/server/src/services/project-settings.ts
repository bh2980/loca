import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { aiConfirmSchema, editorAiSchema, exclusionRulesSchema, formatRulesSchema, markColorsSchema, type AgentSettings } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';

/**
 * The project's settings a person or the agent may change: name, description, format rules, AI
 * confirmation, editor AI, mark colours. The agent's own settings (which tools it has, its
 * permission mode) are left out of the agent's tool on purpose: a script or web page that talks
 * the agent into a change must not be able to widen what it may do (#45).
 */
export const projectSettingsInput = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  formatRules: formatRulesSchema.optional(),
  exclusionRules: exclusionRulesSchema.optional(),
  aiConfirm: aiConfirmSchema.optional(),
  editorAi: editorAiSchema.optional(),
  markColors: markColorsSchema.optional(),
});

/** Null when there is no such project. */
export function updateProjectSettings(db: Db, projectId: string, patch: z.infer<typeof projectSettingsInput> & { agentSettings?: AgentSettings }) {
  const row = db.update(s.projects).set(patch).where(eq(s.projects.id, projectId)).returning().get();
  if (row) events.changed(projectId, 'projects');
  return row ?? null;
}

export function readProjectSettings(db: Db, projectId: string) {
  const row = db.select({ name: s.projects.name, description: s.projects.description, formatRules: s.projects.formatRules, exclusionRules: s.projects.exclusionRules, aiConfirm: s.projects.aiConfirm, editorAi: s.projects.editorAi, markColors: s.projects.markColors, agentSettings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  return row ? { ...row, exclusionRules: exclusionRulesSchema.parse(row.exclusionRules), aiConfirm: aiConfirmSchema.parse(row.aiConfirm), editorAi: editorAiSchema.parse(row.editorAi) } : null;
}
