import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { characterInput, documentInput, eventInput, relationshipInput, speechRuleInput } from '../schemas/knowledge.ts';
import { saveCharacter } from './characters.ts';
import { byPerson } from './status-by.ts';

/**
 * A person's save of one knowledge item — the chat/CLI save_* tools, an accepted proposal (a workflow's
 * 반영 node files them too) and save_knowledge all end here. With `id` only the fields sent change;
 * without it the item is created and checked against the full schema, defaults and all (a shared create
 * schema used to fill an update's missing fields with defaults).
 */
export type SaveResult = { ok: true; id: string } | { ok: false; error: string; hint?: string };

/** Only the fields that were sent. */
export const sent = <T extends Record<string, unknown>>(input: T) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;

export const asNew = <T extends z.ZodType>(schema: T, input: unknown): { ok: true; data: z.output<T> } | { ok: false; error: string } => {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: `새로 만들려면 빠진 값이 있습니다: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}` };
};

export const characterByName = (db: Db, projectId: string, name: string) =>
  db
    .select()
    .from(s.characters)
    .where(eq(s.characters.projectId, projectId))
    .all()
    .find((character) => [character.name, ...character.aliases].some((alias) => alias.toLowerCase() === name.toLowerCase()));

export function saveCharacterItem(db: Db, projectId: string, { id, ...input }: Record<string, unknown> & { id?: string }): SaveResult {
  if (id) {
    const saved = saveCharacter(db, projectId, sent(input), id);
    return saved ? { ok: true, id: saved.id } : { ok: false, error: '없는 인물입니다.' };
  }
  const fresh = asNew(characterInput, input);
  if (!fresh.ok) return fresh;
  const existing = characterByName(db, projectId, fresh.data.name);
  if (existing) return { ok: false, error: '같은 이름의 인물이 이미 있습니다.', hint: `그 인물을 고치려면 id=${existing.id}로 다시 제안하세요.` };
  const saved = saveCharacter(db, projectId, fresh.data);
  return saved ? { ok: true, id: saved.id } : { ok: false, error: '없는 인물입니다.' };
}

export function saveRelationshipItem(db: Db, projectId: string, { id, from, to, ...input }: Record<string, unknown> & { id?: string; from?: string; to?: string }): SaveResult {
  const a = from === undefined ? undefined : characterByName(db, projectId, from);
  const b = to === undefined ? undefined : characterByName(db, projectId, to);
  if ((from !== undefined && !a) || (to !== undefined && !b)) return { ok: false, error: `인물을 먼저 만들어야 합니다: ${from !== undefined && !a ? from : to}` };
  const ends = { ...(a && { fromId: a.id }), ...(b && { toId: b.id }) };
  if (id) {
    const values = { ...sent(input), ...ends };
    if (!db.update(s.relationships).set({ ...values, ...byPerson(db, s.relationships, projectId, id, values) }).where(and(eq(s.relationships.id, id), eq(s.relationships.projectId, projectId))).run().changes) return { ok: false, error: '없는 관계입니다.' };
  } else {
    const fresh = asNew(relationshipInput, { ...input, ...ends });
    if (!fresh.ok) return fresh;
    id = db.insert(s.relationships).values({ ...fresh.data, projectId }).returning().get().id;
  }
  events.changed(projectId, 'knowledge');
  return { ok: true, id };
}

const SAVES = {
  speechRules: { table: s.speechRules, schema: speechRuleInput, missing: '없는 말투 규칙입니다.' },
  events: { table: s.storyEvents, schema: eventInput, missing: '없는 사건입니다.' },
  documents: { table: s.documents, schema: documentInput, missing: '없는 문서입니다.' },
} as const;

/** Speech rules, events and documents: the same create-or-patch, differing only by table and schema. */
export function saveKnowledgeItem(db: Db, projectId: string, kind: keyof typeof SAVES, { id, ...input }: Record<string, unknown> & { id?: string }): SaveResult {
  const { table, schema, missing } = SAVES[kind];
  // One id/projectId column shape across these tables; the cast only picks it.
  const t = table as typeof s.speechRules;
  if (id) {
    // Accepted by a person: like an edit in the app (byPerson also takes 확인 권장 off).
    const values = sent(input);
    if (!db.update(t).set({ ...values, ...byPerson(db, table, projectId, id, values) } as never).where(and(eq(t.id, id), eq(t.projectId, projectId))).run().changes) return { ok: false, error: missing };
  } else {
    const fresh = asNew(schema, input);
    if (!fresh.ok) return fresh;
    id = db.insert(t).values({ ...fresh.data, projectId } as never).returning().get().id;
  }
  events.changed(projectId, 'knowledge');
  return { ok: true, id };
}
