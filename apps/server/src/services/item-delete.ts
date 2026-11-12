import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { eachChunk, inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { aliasNote } from './terms.ts';
import { recorder, type UndoRecorder, type UndoTable } from './undo-records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Deleting project items, for the app's delete buttons, its graphs and the agent's delete_items (#45): one
 * place, so all refuse the same things and all are undone the same way. Rows that point at a deleted item
 * (a character's relationships, a tag's links) go with it through the database's cascades, and are recorded
 * with it (undo-records.ts) so the undo brings them back too.
 */
export const DELETABLE = {
  characters: { table: s.characters, what: '인물' },
  relationships: { table: s.relationships, what: '관계' },
  speechRules: { table: s.speechRules, what: '말투 규칙' },
  events: { table: s.storyEvents, what: '사건' },
  eventLinks: { table: s.eventLinks, what: '사건 연결' },
  documents: { table: s.documents, what: '노트' },
  terms: { table: s.terms, what: '용어' },
  tags: { table: s.tags, what: '태그' },
} as const;
export type DeletableKind = keyof typeof DELETABLE;
export const DELETABLE_KINDS = Object.keys(DELETABLE) as [DeletableKind, ...DeletableKind[]];

/** Which of the ids exist in the project. */
export function deletable(db: Pick<Db, 'select'>, projectId: string, kind: DeletableKind, ids: string[]) {
  const { table } = DELETABLE[kind];
  const rows = inChunks(ids, (slice) => db.select({ id: table.id }).from(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).all());
  const found = new Set(rows.map((row) => row.id));
  return { ids: ids.filter((id) => found.has(id)), missing: ids.filter((id) => !found.has(id)) };
}

/**
 * A character's name terms nobody has touched: the candidates saving it wrote (addNameTerms: its name
 * and aliases, note "인물 이름" / "X의 별칭"), still without a translation and with that note, whose
 * spelling no remaining character has. They go with the character (and come back with it).
 */
function untouchedNameTerms(db: Pick<Db, 'select'>, projectId: string, characterIds: string[]) {
  if (!characterIds.length) return [];
  const all = db.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  const gone = new Set(characterIds);
  const kept = new Set(all.filter((row) => !gone.has(row.id)).flatMap((row) => [row.name, ...row.aliases]).map((name) => name.trim().toLowerCase()));
  const notes = new Map<string, Set<string>>();
  for (const row of all.filter((item) => gone.has(item.id)))
    for (const name of [row.name, ...row.aliases]) {
      const spelling = name.trim().toLowerCase();
      if (!spelling || kept.has(spelling)) continue;
      (notes.get(spelling) ?? notes.set(spelling, new Set()).get(spelling)!).add(name.trim().toLowerCase() === row.name.trim().toLowerCase() ? '인물 이름' : aliasNote(row.name.trim()));
    }
  if (!notes.size) return [];
  return db
    .select()
    .from(s.terms)
    .where(and(eq(s.terms.projectId, projectId), eq(s.terms.origin, 'script'), eq(s.terms.status, 'candidate'), eq(s.terms.target, '')))
    .all()
    .filter((term) => notes.get(term.source.trim().toLowerCase())?.has(term.note.trim()));
}

/** The SQL table of each kind, and the tables whose rows go with one of its rows through the database's cascades (by these columns). */
const STORED: Record<DeletableKind, { table: UndoTable; cascades?: { table: UndoTable; columns: string[]; kind?: DeletableKind }[] }> = {
  characters: { table: 'characters', cascades: [{ table: 'relationships', columns: ['from_id', 'to_id'], kind: 'relationships' }] },
  relationships: { table: 'relationships' },
  speechRules: { table: 'speech_rules' },
  events: { table: 'story_events', cascades: [{ table: 'event_links', columns: ['from_id', 'to_id'], kind: 'eventLinks' }] },
  eventLinks: { table: 'event_links' },
  documents: { table: 'documents' },
  terms: { table: 'terms' },
  tags: { table: 'tags', cascades: [{ table: 'unit_tags', columns: ['tag_id'] }, { table: 'knowledge_tags', columns: ['tag_id'] }] },
};
/** The kinds whose items carry tags (knowledge_tags.kind). */
const TAGGED: readonly DeletableKind[] = ['characters', 'relationships', 'speechRules', 'events', 'documents', 'terms'];

/**
 * Inside the delete's transaction: removes the items of one kind with everything that goes with them, each recorded
 * first so the undo brings it back: a character's relationships and its untouched name terms, an event's lines, the
 * tags on any of them, a term's run items, a tag's links. Returns how many items went (those that went with them too).
 */
function removeItems(tx: Tx, record: UndoRecorder, projectId: string, kind: DeletableKind, ids: string[]): number {
  if (!ids.length) return 0;
  const { table } = DELETABLE[kind];
  const stored = STORED[kind];
  let removed = ids.length;
  // A deleted character's untouched name candidates go with it (untouchedNameTerms).
  if (kind === 'characters') removed += removeItems(tx, record, projectId, 'terms', untouchedNameTerms(tx, projectId, ids).map((term) => term.id));
  record.removed(stored.table, 'id', ids);
  // The tags on the items (taken off by triggers when their item is deleted).
  if (TAGGED.includes(kind)) record.removed('knowledge_tags', 'item_id', ids, { kind });
  for (const cascade of stored.cascades ?? []) {
    const within = sql.join(cascade.columns.map((column) => sql`${sql.identifier(column)} in (select value from json_each(${JSON.stringify(ids)}))`), sql` or `);
    for (const column of cascade.columns) record.removed(cascade.table, column, ids);
    if (!cascade.kind) continue;
    // Items of another kind that go with these (a character's relationships): counted, and their tags go too.
    const going = tx.all<{ id: string }>(sql`select id from ${sql.identifier(cascade.table)} where ${within}`).map((row) => row.id);
    removed += going.length;
    if (TAGGED.includes(cascade.kind)) record.removed('knowledge_tags', 'item_id', going, { kind: cascade.kind });
  }
  // A term's run items name it without a foreign key (run_items.subject_id): they go with it.
  if (kind === 'terms') {
    record.removed('run_items', 'subject_id', ids);
    eachChunk(ids, (slice) => tx.delete(s.runItems).where(inArray(s.runItems.subjectId, slice)).run());
  }
  eachChunk(ids, (slice) => tx.delete(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).run());
  return removed;
}

/**
 * Deletes items of several kinds at once (a graph's selection: people, relationships, speech rules), the one delete
 * of project items for every surface. Ids the project does not have are left out and named (`missing`). Answers with
 * the id of the undo record (`token`, null when nothing went): undoRecorded puts everything back, dependents and all.
 */
export function deleteItemGroups(db: Db, projectId: string, groups: { kind: DeletableKind; ids: string[] }[]) {
  return db.transaction((tx) => {
    const record = recorder(tx, projectId);
    let deleted = 0;
    const missing: string[] = [];
    for (const { kind, ids } of groups) {
      const known = deletable(tx, projectId, kind, ids);
      missing.push(...known.missing);
      deleted += removeItems(tx, record, projectId, kind, known.ids);
    }
    return { ok: true as const, deleted, missing, token: record.save(groups[0]?.kind ?? 'characters') };
  });
}

/** Deletes items of one kind (see deleteItemGroups). */
export const deleteItems = (db: Db, projectId: string, kind: DeletableKind, ids: string[]) => deleteItemGroups(db, projectId, [{ kind, ids }]);
