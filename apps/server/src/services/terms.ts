import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiStatus, appliesEverywhere, duplicateTargets, termMarksOf, termMatches, termText, TERM_MARK_IDS, withMainTarget, withTargetCandidate, type AutoMark, type TermScope } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { fillTermUsage } from './term-usage.ts';
import { knowledgeFilterInput, tagIdsOf, type KnowledgeFilterInput } from './knowledge-list.ts';
import { withTags } from './knowledge-tags.ts';
import { bySaver, PERSON, type Saver } from './status-by.ts';
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
  scope?: TermScope;
  matchCase?: boolean;
}

/**
 * A term saved by a person (the glossary page, a pane) or an agent's accepted change (`saver`): created, or with `id` changed. One source
 * is one term whatever its case; a term already there is refused. A rejected term (hidden, kept so
 * it is not proposed again) does not block: it is revived by a create and dropped by a rename onto it.
 * A new source is counted again (fillTermUsage).
 */
export function saveTerm(tx: Tx, projectId: string, term: TermSave, options: { id?: string; saver?: Saver }) {
  const saver = options.saver ?? PERSON;
  const source = term.source === undefined ? undefined : termText(term.source);
  const mine = options.id ? tx.select().from(s.terms).where(and(eq(s.terms.id, options.id), eq(s.terms.projectId, projectId))).get() : undefined;
  if (options.id && !mine) return { ok: false as const, reason: 'missing' as const, error: '용어를 찾을 수 없습니다.' };
  const same = source ? termBySource(tx, projectId, source) : undefined;
  if (same && same.id !== mine?.id && same.status !== 'rejected') return { ok: false as const, reason: 'duplicate' as const, error: `이미 있는 용어입니다: ${same.source}${same.target ? ` → ${same.target}` : ''}` };
  const values = { ...term, ...(source !== undefined && { source }), ...(term.target !== undefined && { target: termText(term.target) }) };
  if (!mine) {
    // Revive a rejected term of the same source instead of adding a second.
    if (same) {
      const row = tx.update(s.terms).set({ ...values, status: term.status ?? 'confirmed', lines: null, origin: saver.origin, statusBy: saver.statusBy, runId: null }).where(eq(s.terms.id, same.id)).returning().get();
      return { ok: true as const, row };
    }
    return { ok: true as const, row: tx.insert(s.terms).values({ ...values, source: source ?? '', projectId, origin: saver.origin, statusBy: saver.statusBy }).returning().get() };
  }
  if (same && same.id !== mine.id) tx.delete(s.terms).where(eq(s.terms.id, same.id)).run();
  // A new source, scope or case rule matches other lines: counted again.
  const changesSource = (source !== undefined && source !== mine.source) || (term.scope !== undefined && JSON.stringify(term.scope) !== JSON.stringify(mine.scope)) || (term.matchCase !== undefined && term.matchCase !== mine.matchCase);
  // A new main form keeps the former one among the candidates (the pane's 메인으로 sends a candidate here).
  const forms = term.target !== undefined && term.target.trim() !== mine.target.trim() ? withMainTarget(mine, term.target) : {};
  const row = tx.update(s.terms).set({ ...values, ...forms, ...(changesSource && { lines: null }), ...bySaver(tx, s.terms, projectId, mine.id, values, saver) }).where(eq(s.terms.id, mine.id)).returning().get();
  return { ok: true as const, row };
}

/**
 * A term an AI found (the work analysis, an addTerms node). A source already in the glossary keeps
 * its note and examples (only empty ones are filled), and a rejected one stays as the person left it.
 * A Korean form other than its main one becomes the main one when AI results are confirmed right away
 * and no person chose the current one (the former main stays a candidate); otherwise it is kept as a
 * candidate. A new term lands as AI › 사용 방식 says (without a Korean form: a candidate). A scope the
 * AI gives (a UI word: UI lines only) replaces only the default, all lines, of a term no person decided.
 */
export function upsertAiTerm(
  tx: Tx,
  projectId: string,
  term: { source: string; target?: string; note?: string; examples?: string[]; scope?: TermScope },
  options: { autoConfirm: boolean; runId?: string },
): 'added' | 'filled' | 'unchanged' {
  const source = termText(term.source);
  const target = termText(term.target ?? '');
  const note = term.note?.trim() ?? '';
  const examples = term.examples ?? [];
  const known = termBySource(tx, projectId, source);
  if (known) {
    if (known.status === 'rejected') return 'unchanged';
    const takesMain = target && target !== known.target.trim() && (!known.target.trim() || (options.autoConfirm && known.statusBy !== 'human'));
    const offered = target && !takesMain ? withTargetCandidate(known, target) : known.targetCandidates;
    const fill = {
      // Filling an empty form keeps whoever decided the term; replacing a form makes it the AI's.
      ...(takesMain && withMainTarget(known, target)),
      ...(takesMain && known.target.trim() && { statusBy: 'ai' as const, origin: 'ai' as const, runId: options.runId ?? null }),
      ...(offered.length !== known.targetCandidates.length && { targetCandidates: offered }),
      ...(!known.note.trim() && note && { note }),
      ...(!known.examples.length && examples.length && { examples }),
      ...(term.scope && appliesEverywhere(known.scope) && !appliesEverywhere(term.scope) && known.statusBy !== 'human' && { scope: term.scope }),
    };
    if (!Object.keys(fill).length) return 'unchanged';
    tx.update(s.terms).set(fill).where(eq(s.terms.id, known.id)).run();
    return 'filled';
  }
  tx.insert(s.terms).values({ projectId, source, target, note, examples, ...(term.scope && { scope: term.scope }), status: target ? aiStatus(options.autoConfirm) : 'candidate', statusBy: 'ai', origin: 'ai', runId: options.runId ?? null }).run();
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

/** Filter of the glossary list: the knowledge filter, with the term marks (unused, duplicateTarget) and an empty Korean form. */
export const termFilterInput = {
  ...knowledgeFilterInput,
  marks: z.array(z.enum(TERM_MARK_IDS as [AutoMark, ...AutoMark[]])).optional().describe('Term marks: unused (not in the script), duplicateTarget (another source has the same Korean form); all given must hold.'),
  emptyTarget: z.boolean().optional().describe('true: terms with no Korean form yet (번역 비어 있음); false: terms that have one.'),
  q: z.string().optional().describe('Text in the source, the translation or the memo (case aside).'),
};

/**
 * The glossary as the glossary page lists it (not rejected terms, source order) with what the page
 * shows: lines (나온 줄, counted first), examples, marks and tag names. `total` counts every match.
 */
export function listTerms(db: Db, projectId: string, input: KnowledgeFilterInput & { q?: string; emptyTarget?: boolean; offset?: number; limit?: number }) {
  fillTermUsage(db, projectId);
  const rows = withTags(db, 'terms', db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'))).orderBy(asc(s.terms.source)).all());
  // Duplicates are read across the whole glossary, not just the rows the filter keeps.
  const duplicate = duplicateTargets(rows);
  const names = new Map(db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.id, tag.name]));
  // The glossary page's filter (termMatches), with tags named as list_tags names them.
  const filter = { text: input.q, status: input.status, decidedBy: input.decidedBy, emptyTarget: input.emptyTarget, marks: input.marks, unreviewed: input.unreviewed, tags: tagIdsOf(db, projectId, input.tags) };
  const matched = rows
    .filter((row) => termMatches(row, filter, duplicate.has(row)))
    .map((row) => ({ ...row, marks: termMarksOf({ lines: row.lines, duplicateTarget: duplicate.has(row) }), tags: row.tags.map((tag) => names.get(tag.id) ?? tag.id) }));
  const offset = input.offset ?? 0;
  const page = input.limit === undefined ? matched.slice(offset) : matched.slice(offset, offset + input.limit);
  return {
    total: matched.length,
    terms: page.map(({ id, source, target, targetCandidates, scope, matchCase, note, status, statusBy, lines, examples, marks, tags }) => ({ id, source, target, ...(targetCandidates.length && { targetCandidates }), ...(!appliesEverywhere(scope) && { scope }), ...(matchCase && { matchCase }), note, status, statusBy, lines, examples, marks, tags })),
  };
}
