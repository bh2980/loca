import { eq } from 'drizzle-orm';
import { agentSettingsSchema, savedPromptsSchema, type SavedPrompt } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';

/** The project's 저장한 지시, in the order the person keeps them. Null when there is no such project. */
export function readSavedPrompts(db: Db, projectId: string): SavedPrompt[] | null {
  const row = db.select({ settings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  return row ? agentSettingsSchema.parse(row.settings ?? {}).prompts : null;
}

/** Replaces the list (the settings page edits it inline and saves it whole). Throws a ZodError on a bad list; null when there is no project. */
export function writeSavedPrompts(db: Db, projectId: string, input: unknown): SavedPrompt[] | null {
  const prompts = savedPromptsSchema.parse(input);
  const row = db.select({ settings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!row) return null;
  const settings = agentSettingsSchema.parse(row.settings ?? {});
  db.update(s.projects).set({ agentSettings: { ...settings, prompts } }).where(eq(s.projects.id, projectId)).run();
  events.changed(projectId, 'projects');
  return prompts;
}
