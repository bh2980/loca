import { and, asc, eq, inArray, like, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiStatus, matchesMarks, termMarksOf, TERM_MARK_IDS, type AutoMark } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { fillTermUsage } from './term-usage.ts';
import { annotateKnowledge, knowledgeFilterInput, matchesStatus, type KnowledgeFilter } from './knowledge-list.ts';
import { byPerson } from './status-by.ts';
import { discoverTerms } from './term-discovery.ts';

type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

/** The project's term whose source equals `source` in any case (the unique index's rule), if any. */
const termBySource = (tx: Pick<Db, 'select'>, projectId: string, source: string) =>
  tx.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), sql`lower(${s.terms.source}) = lower(${source})`)).get();

export interface TermSave {
  source?: string;
  target?: string;
  note?: string;
  status?: 'candidate' | 'confirmed' | 'rejected';
}

/**
 * A person's term (the glossary page, a pane, the chat): created, or with `id` changed. One source
 * is one term whatever its case; a term already there is refused. A rejected term (hidden, kept so
 * it is not proposed again) does not block: it is revived by a create and dropped by a rename onto it.
 * A new source is counted again (fillTermUsage).
 */
export function saveTerm(tx: Tx, projectId: string, term: TermSave, options: { id?: string; by: 'person' }) {
  const source = term.source?.trim();
  const mine = options.id ? tx.select().from(s.terms).where(and(eq(s.terms.id, options.id), eq(s.terms.projectId, projectId))).get() : undefined;
  if (options.id && !mine) return { ok: false as const, reason: 'missing' as const, error: '용어를 찾을 수 없습니다.' };
  const same = source ? termBySource(tx, projectId, source) : undefined;
  if (same && same.id !== mine?.id && same.status !== 'rejected') return { ok: false as const, reason: 'duplicate' as const, error: `이미 있는 용어입니다: ${same.source}${same.target ? ` → ${same.target}` : ''}` };
  const values = { ...term, ...(source !== undefined && { source }) };
  if (!mine) {
    // Revive a rejected term of the same source instead of adding a second.
    if (same) {
      const row = tx.update(s.terms).set({ ...values, status: term.status ?? 'confirmed', lines: null, origin: 'human', statusBy: 'human', runId: null }).where(eq(s.terms.id, same.id)).returning().get();
      return { ok: true as const, row };
    }
    return { ok: true as const, row: tx.insert(s.terms).values({ ...values, source: source ?? '', projectId }).returning().get() };
  }
  if (same && same.id !== mine.id) tx.delete(s.terms).where(eq(s.terms.id, same.id)).run();
  const changesSource = source !== undefined && source !== mine.source;
  const row = tx.update(s.terms).set({ ...values, ...(changesSource && { lines: null }), ...byPerson(tx, s.terms, projectId, mine.id, values) }).where(eq(s.terms.id, mine.id)).returning().get();
  return { ok: true as const, row };
}

/**
 * A term an AI found (the work analysis, an addTerms node). A source already in the glossary keeps
 * what it has: only an empty translation, note or examples are filled, and a rejected one stays as
 * the person left it. A new one lands as AI › 사용 방식 says (without a Korean form: a candidate).
 */
export function upsertAiTerm(
  tx: Tx,
  projectId: string,
  term: { source: string; target?: string; note?: string; examples?: string[] },
  options: { autoConfirm: boolean; runId?: string },
): 'added' | 'filled' | 'unchanged' {
  const source = term.source.trim();
  const target = term.target?.trim() ?? '';
  const note = term.note?.trim() ?? '';
  const examples = term.examples ?? [];
  const known = termBySource(tx, projectId, source);
  if (known) {
    if (known.status === 'rejected') return 'unchanged';
    const fill = { ...(!known.target.trim() && target && { target }), ...(!known.note.trim() && note && { note }), ...(!known.examples.length && examples.length && { examples }) };
    if (!Object.keys(fill).length) return 'unchanged';
    tx.update(s.terms).set(fill).where(eq(s.terms.id, known.id)).run();
    return 'filled';
  }
  tx.insert(s.terms).values({ projectId, source, target, note, examples, status: target ? aiStatus(options.autoConfirm) : 'candidate', statusBy: 'ai', origin: 'ai', runId: options.runId ?? null }).run();
  return 'added';
}

/**
 * The note on an alias's glossary term. Only terms a line mentions reach a translation prompt, so
 * this is how "Anderson" in a line is known to be Hank, without putting character profiles in
 * (experiments: whole profiles made translations worse).
 */
export const aliasNote = (name: string) => `${name}의 별칭`;

/**
 * A character's names and aliases as glossary candidates (origin script), written with the character
 * (services/characters.ts) so a new alias needs no rediscovery. One spelling is one term whatever its
 * case (the unique index's rule): known terms keep what they have; an alias term with no note gets
 * "X의 별칭". Returns how many terms it wrote; the caller announces them once committed.
 */
export function addNameTerms(tx: Tx, projectId: string, character: { name: string; aliases: string[] }) {
  const names = [character.name, ...character.aliases].map((name) => name.trim()).filter((name) => name && !/^[A-Z0-9_]+$/.test(name));
  if (!names.length) return 0;
  const existing = new Map(tx.select({ id: s.terms.id, source: s.terms.source, note: s.terms.note }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((term) => [term.source.toLowerCase(), term]));
  let written = 0;
  for (const name of names) {
    const alias = name.toLowerCase() !== character.name.trim().toLowerCase();
    const note = alias ? aliasNote(character.name.trim()) : '인물 이름';
    const known = existing.get(name.toLowerCase());
    if (known) {
      if (alias && !known.note.trim()) {
        tx.update(s.terms).set({ note }).where(eq(s.terms.id, known.id)).run();
        known.note = note;
        written++;
      }
      continue;
    }
    // Remembered at once: "Mira" and "mira" in one save are one term.
    existing.set(name.toLowerCase(), tx.insert(s.terms).values({ projectId, source: name, status: 'candidate', origin: 'script', note }).returning({ id: s.terms.id, source: s.terms.source, note: s.terms.note }).get());
    written++;
  }
  return written;
}

/**
 * "대본에서 찾기": Language-agnostic glossary candidates found by code across the script
 * (bracketed terms, katakana, capitalized phrases, repeated n-grams).
 */
export function discoverAndSave(db: Db, projectId: string) {
  const project = db.select({ sourceLanguage: s.projects.sourceLanguage }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  const units = db.select({ key: s.units.key, source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
  const characters = db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(and(eq(s.characters.projectId, projectId), inArray(s.characters.status, ['candidate', 'confirmed']))).all();
  const found = discoverTerms(units, characters, { sourceLanguage: project?.sourceLanguage });
  const existing = new Map(db.select({ id: s.terms.id, source: s.terms.source, note: s.terms.note }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((term) => [term.source.toLowerCase(), term]));
  let added = 0;
  let updated = 0;
  db.transaction((tx) => {
    for (const term of found) {
      const known = existing.get(term.source.toLowerCase());
      if (known) {
        tx.update(s.terms).set({ lines: term.lines, examples: term.examples, ...(term.aliasOf && !known.note.trim() && { note: aliasNote(term.aliasOf) }) }).where(eq(s.terms.id, known.id)).run();
        updated++;
        continue;
      }
      tx.insert(s.terms).values({
        projectId,
        source: term.source,
        status: 'candidate',
        origin: 'script',
        note: term.aliasOf ? aliasNote(term.aliasOf) : term.kind === 'character' ? '인물 이름' : '',
        lines: term.lines,
        examples: term.examples,
      }).run();
      added++;
    }
  });
  events.changed(projectId, 'terms');
  return { found: found.length, added, updated };
}

/** Filter of the glossary list: the knowledge filter, with the term marks (ai, emptyTarget, unused). */
export const termFilterInput = {
  ...knowledgeFilterInput,
  marks: z.array(z.enum(TERM_MARK_IDS as [AutoMark, ...AutoMark[]])).optional().describe('Term marks: ai, emptyTarget (no Korean form), unused (not in the script); all given must hold.'),
  q: z.string().optional().describe('Text in the source or the translation.'),
};

/**
 * The glossary as the glossary page lists it (not rejected terms, source order) with what the page
 * shows: lines (나온 줄, counted first), examples, marks and tag names. `total` counts every match.
 */
export function listTerms(db: Db, projectId: string, input: KnowledgeFilter & { q?: string; offset?: number; limit?: number }) {
  fillTermUsage(db, projectId);
  const where = and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'), input.q ? or(like(s.terms.source, `%${input.q}%`), like(s.terms.target, `%${input.q}%`)) : undefined);
  const rows = db.select().from(s.terms).where(where).orderBy(asc(s.terms.source)).all();
  const matched = annotateKnowledge(db, projectId, 'terms', rows, { tags: input.tags })
    .map(({ marks: _marks, ...row }) => ({ ...row, marks: termMarksOf(row) }))
    .filter((row) => matchesMarks(row.marks, input.marks) && matchesStatus(row, input));
  const offset = input.offset ?? 0;
  const page = input.limit === undefined ? matched.slice(offset) : matched.slice(offset, offset + input.limit);
  return {
    total: matched.length,
    terms: page.map(({ id, source, target, note, status, statusBy, lines, examples, marks, tags }) => ({ id, source, target, note, status, statusBy, lines, examples, marks, tags })),
  };
}
