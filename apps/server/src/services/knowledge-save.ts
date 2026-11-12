import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { eachChunk, inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { characterInput, documentInput, eventInput, relationshipInput, speechRuleInput } from '../schemas/knowledge.ts';
import { saveCharacter } from './characters.ts';
import { bySaver, PERSON, type Saver } from './status-by.ts';
import { clearReview } from './knowledge-tags.ts';

/**
 * The save of one knowledge item, for every surface: the app's forms and graphs (a person), the chat/CLI save_* tools
 * and save_knowledge through an accepted proposal (the saver the gate names). With `id` only the fields sent change;
 * without it the item is created and checked against the full schema, defaults and all. The rules of each kind live
 * here, so no surface can save what another refuses.
 */
/** `missing`: the item to change is not in the project. */
export type SaveResult = { ok: true; id: string } | { ok: false; error: string; hint?: string; missing?: true };

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

export function saveCharacterItem(db: Db, projectId: string, { id, ...input }: Record<string, unknown> & { id?: string }, saver: Saver = PERSON): SaveResult {
  if (id) {
    const saved = saveCharacter(db, projectId, sent(input), id, saver);
    return saved ? { ok: true, id: saved.id } : { ok: false, error: '없는 인물입니다.', missing: true };
  }
  const fresh = asNew(characterInput, input);
  if (!fresh.ok) return fresh;
  const existing = characterByName(db, projectId, fresh.data.name);
  if (existing) return { ok: false, error: '같은 이름의 인물이 이미 있습니다.', hint: `그 인물을 고치려면 id=${existing.id}로 다시 제안하세요.` };
  const saved = saveCharacter(db, projectId, fresh.data, undefined, saver);
  return saved ? { ok: true, id: saved.id } : { ok: false, error: '없는 인물입니다.' };
}

/** A character of the project by id. */
const characterById = (db: Pick<Db, 'select'>, projectId: string, id: string) => db.select({ id: s.characters.id }).from(s.characters).where(and(eq(s.characters.id, id), eq(s.characters.projectId, projectId))).get();

/**
 * A confirmed relationship needs confirmed people at both ends: those of these relationships that are confirmed get
 * their people confirmed too, decided by whoever confirmed the relationship. A person already confirmed stays as it is.
 */
export function confirmEnds(db: Pick<Db, 'select' | 'update'>, projectId: string, relationshipIds: readonly string[], saver: Saver) {
  const ends = inChunks(relationshipIds, (slice) => db.select({ fromId: s.relationships.fromId, toId: s.relationships.toId }).from(s.relationships).where(and(eq(s.relationships.projectId, projectId), eq(s.relationships.status, 'confirmed'), inArray(s.relationships.id, slice))).all()).flatMap((row) => [row.fromId, row.toId]);
  eachChunk(ends, (people) => {
    db.update(s.characters).set({ status: 'confirmed', statusBy: saver.statusBy }).where(and(eq(s.characters.projectId, projectId), ne(s.characters.status, 'confirmed'), inArray(s.characters.id, people))).run();
  });
}

/**
 * A relationship between two people of the project. Its ends are named (`from`, `to`: a name or alias, as the agent
 * knows them) or given by id (`fromId`, `toId`, as the app holds them); either way each must be a character of this
 * project. Saved confirmed, it confirms its people (confirmEnds).
 */
export function saveRelationshipItem(db: Db, projectId: string, { id, from, to, fromId, toId, ...input }: Record<string, unknown> & { id?: string; from?: string; to?: string; fromId?: string; toId?: string }, saver: Saver = PERSON): SaveResult {
  const end = (name: string | undefined, endId: string | undefined): { id?: string; error?: string } => {
    if (name !== undefined) return characterByName(db, projectId, name) ?? { error: `인물을 먼저 만들어야 합니다: ${name}` };
    if (endId !== undefined) return characterById(db, projectId, endId) ?? { error: '이 프로젝트에 없는 인물입니다.' };
    return {};
  };
  const [a, b] = [end(from, fromId), end(to, toId)];
  const unknown = a.error ?? b.error;
  if (unknown) return { ok: false, error: unknown };
  const ends = { ...(a.id && { fromId: a.id }), ...(b.id && { toId: b.id }) };
  return db.transaction((tx): SaveResult => {
    if (id) {
      const values = { ...sent(input), ...ends };
      if (!tx.update(s.relationships).set({ ...values, ...bySaver(tx, s.relationships, projectId, id, values, saver) }).where(and(eq(s.relationships.id, id), eq(s.relationships.projectId, projectId))).run().changes) return { ok: false, error: '없는 관계입니다.', missing: true };
    } else {
      const fresh = asNew(relationshipInput, { ...input, ...ends });
      if (!fresh.ok) return fresh;
      id = tx.insert(s.relationships).values({ ...fresh.data, projectId, origin: saver.origin, statusBy: saver.statusBy }).returning().get().id;
    }
    confirmEnds(tx, projectId, [id], saver);
    return { ok: true, id };
  });
}

/**
 * A relationship's changes alone (관계 변화: one confirmed, fixed, dropped or added): its own status and content stay, so
 * deciding a change is not deciding the relationship. False when the project has no such relationship.
 */
export function setRelationshipChanges(db: Db, projectId: string, id: string, changes: (typeof s.relationships.$inferSelect)['changes']) {
  return db.update(s.relationships).set({ changes }).where(and(eq(s.relationships.id, id), eq(s.relationships.projectId, projectId))).run().changes > 0;
}

const SAVES = {
  speechRules: { table: s.speechRules, schema: speechRuleInput, missing: '없는 말투 규칙입니다.' },
  events: { table: s.storyEvents, schema: eventInput, missing: '없는 사건입니다.' },
  documents: { table: s.documents, schema: documentInput, missing: '없는 노트입니다.' },
} as const;

/** Speech rules, events and documents: the same create-or-patch, differing only by table and schema. */
export function saveKnowledgeItem(db: Db, projectId: string, kind: keyof typeof SAVES, { id, ...input }: Record<string, unknown> & { id?: string }, saver: Saver = PERSON): SaveResult {
  const { table, schema, missing } = SAVES[kind];
  // One id/projectId column shape across these tables; the cast only picks it.
  const t = table as typeof s.speechRules;
  if (id) {
    // Like an edit in the app, by whoever saved it (a person's save also takes 확인 권장 off).
    const values = sent(input);
    if (!db.update(t).set({ ...values, ...bySaver(db, table, projectId, id, values, saver) } as never).where(and(eq(t.id, id), eq(t.projectId, projectId))).run().changes) return { ok: false, error: missing, missing: true };
  } else {
    const fresh = asNew(schema, input);
    if (!fresh.ok) return fresh;
    id = db.insert(t).values({ ...fresh.data, projectId, origin: saver.origin, statusBy: saver.statusBy } as never).returning().get().id;
  }
  return { ok: true, id };
}

/** Tables whose rows a person confirms or discards as drafts. */
const DRAFT_TABLES = { documents: s.documents, characters: s.characters, relationships: s.relationships, events: s.storyEvents, speechRules: s.speechRules, terms: s.terms } as const;
export type DraftKind = keyof typeof DRAFT_TABLES;
export const DRAFT_KINDS = Object.keys(DRAFT_TABLES) as [DraftKind, ...DraftKind[]];

/**
 * A person decides several items at once: confirm (a candidate becomes 확정; an AI-confirmed one is marked 확인함) or
 * discard (kept as rejected, so a later analysis does not propose it again). Either way a person set the status now;
 * items a person already decided are skipped. Returns how many changed.
 */
export function decideDrafts(db: Db, projectId: string, kind: DraftKind, ids: readonly string[], action: 'confirm' | 'discard') {
  const table = DRAFT_TABLES[kind];
  // Anything a person has not decided: candidates and items AI confirmed.
  const undecided = (slice: string[]) => and(eq(table.projectId, projectId), inArray(table.id, slice), or(eq(table.status, 'candidate'), eq(table.statusBy, 'ai')));
  // Chunked inside the one transaction: a bulk action can cover thousands of drafts.
  return db.transaction((tx) => {
    let changed = 0;
    eachChunk(ids, (slice) => {
      const deciding = tx.select({ id: table.id }).from(table).where(undecided(slice)).all().map((row) => row.id);
      changed += tx.update(table).set({ status: action === 'confirm' ? 'confirmed' : 'rejected', statusBy: PERSON.statusBy }).where(undecided(slice)).run().changes;
      if (action === 'confirm' && kind === 'relationships') confirmEnds(tx, projectId, deciding, PERSON);
      clearReview(tx, projectId, kind, slice);
    }, 2_000);
    return changed;
  });
}
