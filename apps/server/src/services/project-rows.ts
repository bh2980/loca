import { and, asc, count, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { editorAiSchema, exclusionRulesSchema } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { knownListenerSql } from './line-marks.ts';

/**
 * The project's own row (its settings) as the browser's project collection holds it: one row, read
 * again when the project changes. Its counts are not here: they come from the scene rows and the
 * other collections, which the feed keeps current row by row.
 */
export function projectRows(db: Db, projectId: string) {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  return project ? [{ ...project, exclusionRules: exclusionRulesSchema.parse(project.exclusionRules), editorAi: editorAiSchema.parse(project.editorAi) }] : [];
}

/** The projects list (home, sidebar): newest first, with how many lines each has. Only `ids` when given. */
export function projectListRows(db: Db, ids?: readonly string[]) {
  return db
    .select({
      id: s.projects.id,
      name: s.projects.name,
      description: s.projects.description,
      sourceLanguage: s.projects.sourceLanguage,
      targetLanguage: s.projects.targetLanguage,
      updatedAt: s.projects.updatedAt,
      units: sql<number>`(select count(*) from units u where u.project_id = "projects"."id")`,
    })
    .from(s.projects)
    .where(ids ? inList(s.projects.id, ids) : undefined)
    .orderBy(desc(s.projects.updatedAt))
    .all();
}

/**
 * Each speaker key with its lines and the character it names (by name or alias), most lines first.
 * A line without a speaker counts under id ''. Only `ids` (speaker keys) when given.
 */
export function speakerRows(db: Db, projectId: string, ids?: readonly string[]) {
  const named = ids?.filter(Boolean);
  const wanted: SQL | undefined = ids ? or(named?.length ? inList(s.units.speaker, named) : undefined, ids.includes('') ? isNull(s.units.speaker) : undefined) : undefined;
  if (ids && !wanted) return [];
  const rows = db.select({ speaker: s.units.speaker, lines: count() }).from(s.units).where(and(eq(s.units.projectId, projectId), wanted)).groupBy(s.units.speaker).orderBy(desc(count())).all();
  const characters = db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  return rows.map((row) => ({ id: row.speaker ?? '', ...row, character: row.speaker ? (characters.find((character) => [character.name, ...character.aliases].includes(row.speaker!))?.name ?? null) : null }));
}

/** Each known listener (a person's, an import's or a sure AI guess) with its lines, most first. Only `ids` (names) when given. */
export function listenerRows(db: Db, projectId: string, ids?: readonly string[]) {
  return db
    .select({ name: s.units.listener, lines: count() })
    .from(s.units)
    .where(and(eq(s.units.projectId, projectId), knownListenerSql, ne(s.units.listener, ''), ids ? inList(s.units.listener, ids) : undefined))
    .groupBy(s.units.listener)
    .orderBy(desc(count()), asc(s.units.listener))
    .all()
    .flatMap((row) => (row.name ? [{ id: row.name, name: row.name, lines: row.lines }] : []));
}
