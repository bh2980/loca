import { asc, eq } from 'drizzle-orm';
import { normalizeTagScopes, SPECIAL_LISTENERS, SPEECH_LEVEL_LABELS, type ChoiceConfig } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { knowledgeOf } from './speech.ts';

/**
 * The options a `choice` AI node may answer with, read when a request is built: typed values, or a
 * project list (confirmed cast names plus the special listeners, names of tags that go on lines,
 * status names). The prompt spells the same list out, so the node's preview shows it.
 */
export function resolveChoiceOptions(db: Db, projectId: string, choice: Pick<ChoiceConfig, 'source' | 'values'>): string[] {
  const names = (() => {
    switch (choice.source) {
      case 'custom':
        return choice.values;
      case 'characters':
        return [...knowledgeOf(db, projectId).characters().rows.map((character) => character.name), ...Object.keys(SPECIAL_LISTENERS)];
      case 'lineTags':
        return db.select({ name: s.tags.name, scope: s.tags.scope }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().filter((tag) => normalizeTagScopes(tag.scope).includes('lines')).map((tag) => tag.name);
      case 'statuses':
        return db.select({ name: s.statuses.name }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all().map((status) => status.name);
      case 'speechLevels':
        // As the condition data names a line's rule (unit.speechLevel), so the two compare.
        return Object.values(SPEECH_LEVEL_LABELS);
    }
  })();
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}
