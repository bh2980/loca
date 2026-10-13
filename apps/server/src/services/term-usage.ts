import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { termMatcher } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** Keys of a term's first lines kept for the glossary and the AI fill. */
const EXAMPLES = 5;

/**
 * Counts the script lines that use each term not counted yet (lines is null: new, or its source
 * changed) and keeps the first few keys, whole word and in any script language, the same match
 * the editor and the run dialog use. Called before the glossary is read, so every way a term
 * comes in (analysis, a person, a chat, a workflow) gets counted without each one doing it.
 */
export function fillTermUsage(db: Db, projectId: string) {
  const pending = db
    .select({ id: s.terms.id, source: s.terms.source })
    .from(s.terms)
    .where(and(eq(s.terms.projectId, projectId), isNull(s.terms.lines), ne(s.terms.status, 'rejected')))
    .all()
    .filter((term) => term.source.trim());
  if (!pending.length) return;
  const matcher = termMatcher(pending, (term) => term.source);
  const usage = new Map(pending.map((term) => [term.id, { lines: 0, examples: [] as string[] }]));
  for (const unit of db.select({ key: s.units.key, source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all()) {
    for (const term of matcher.find(unit.source)) {
      const entry = usage.get(term.id)!;
      entry.lines++;
      if (entry.examples.length < EXAMPLES) entry.examples.push(unit.key);
    }
  }
  db.transaction((tx) => {
    for (const [id, entry] of usage) tx.update(s.terms).set(entry).where(eq(s.terms.id, id)).run();
  });
}

/** A term by id, or by source in any case (the unique index's rule), among the project's visible terms. */
export function findTerm(db: Db, projectId: string, idOrSource: string) {
  const terms = db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'))).all();
  const wanted = idOrSource.trim().toLowerCase();
  return terms.find((term) => term.id === idOrSource) ?? terms.find((term) => term.source.toLowerCase() === wanted);
}

/** Every line whose source mentions the term, in script order: what to re-run after changing it. The same matcher as fillTermUsage (so the list matches 나온 줄 in any script); the glossary pane, `loca terms usage` and the chat share this. */
export function termUsage(db: Db, projectId: string, term: { source: string }) {
  const matcher = termMatcher([term], (item) => item.source);
  return db
    .select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, groupTitle: s.groups.title, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .where(eq(s.units.projectId, projectId))
    .orderBy(asc(s.units.seq))
    .all()
    .filter((row) => matcher.has(row.source));
}
