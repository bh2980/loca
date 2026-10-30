import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { bySaver, PERSON, type Saver } from './status-by.ts';
import { addNameTerms } from './terms.ts';

type Character = typeof s.characters.$inferSelect;
type CharacterValues = Omit<typeof s.characters.$inferInsert, 'id' | 'projectId'>;

/**
 * A person's save of a character — the app's form and an accepted chat/CLI proposal alike: created,
 * or with `id` changed (undefined when there is no such character). The character and the glossary
 * candidates for its names (addNameTerms) are written in one transaction, so a failure leaves
 * neither; the change is announced only once committed. Whether a second character may share a
 * name is the caller's rule: the app allows it (a person chose to), the chat refuses it.
 */
export function saveCharacter(db: Db, projectId: string, values: CharacterValues, id?: undefined, saver?: Saver): Character;
export function saveCharacter(db: Db, projectId: string, values: Partial<CharacterValues>, id: string, saver?: Saver): Character | undefined;
export function saveCharacter(db: Db, projectId: string, values: Partial<CharacterValues>, id?: string, saver: Saver = PERSON): Character | undefined {
  const saved = db.transaction((tx) => {
    const row = id
      ? tx.update(s.characters).set({ ...values, ...bySaver(tx, s.characters, projectId, id, values, saver) }).where(and(eq(s.characters.id, id), eq(s.characters.projectId, projectId))).returning().get()
      : tx.insert(s.characters).values({ ...(values as CharacterValues), projectId, origin: saver.origin, statusBy: saver.statusBy }).returning().get();
    if (!row) return undefined;
    const names = !id || values.name !== undefined || values.aliases !== undefined;
    return { row, terms: names ? addNameTerms(tx, projectId, row) : 0 };
  });
  if (!saved) return undefined;
  events.changed(projectId, 'knowledge', ...(saved.terms ? (['terms'] as const) : []));
  return saved.row;
}
