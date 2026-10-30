import { and, count, eq } from 'drizzle-orm';
import { AUTO_MARK_IDS, AUTO_MARKS, type AutoMark, knowledgeMarksOf, LINE_MARK_IDS, markColor, TAG_SCOPE_LABELS, termMarksOf, withDuplicateTargets } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { markConditions } from './line-marks.ts';
import { projectTags } from './tag-scope.ts';
import { fillTermUsage } from './term-usage.ts';

/** How many knowledge items and glossary terms carry each automatic mark (read off the items, as the lists do). */
function itemMarkCounts(db: Db, projectId: string) {
  const counts = new Map<AutoMark, number>();
  const add = (marks: AutoMark[]) => marks.forEach((mark) => counts.set(mark, (counts.get(mark) ?? 0) + 1));
  const visible = (table: typeof s.documents | typeof s.characters | typeof s.relationships | typeof s.storyEvents | typeof s.speechRules) => db.select().from(table).where(eq(table.projectId, projectId)).all().filter((row) => row.status !== 'rejected');
  for (const table of [s.documents, s.characters, s.relationships, s.storyEvents, s.speechRules] as const) for (const row of visible(table)) add(knowledgeMarksOf(row));
  fillTermUsage(db, projectId);
  for (const term of withDuplicateTargets(db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all()).filter((row) => row.status !== 'rejected')) add(termMarksOf(term));
  return counts;
}

/**
 * What `loca tags` and the 상태·태그 page list: the project's tags and the built-in automatic marks,
 * each with where it can be put (붙는 곳) and how many lines / items carry it.
 */
export function tagOverview(db: Db, projectId: string) {
  const colors = db.select({ markColors: s.projects.markColors }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.markColors;
  const items = itemMarkCounts(db, projectId);
  return {
    tags: projectTags(db, projectId).map(({ units, ...tag }) => ({ ...tag, builtin: tag.role !== null, places: tag.scope.map((place) => TAG_SCOPE_LABELS[place]), lines: units })),
    marks: AUTO_MARK_IDS.map((id) => ({
      id,
      name: AUTO_MARKS[id].name,
      builtin: true,
      scope: [...AUTO_MARKS[id].on],
      places: AUTO_MARKS[id].on.map((place) => TAG_SCOPE_LABELS[place]),
      color: markColor(id, colors),
      description: AUTO_MARKS[id].description,
      lines: (LINE_MARK_IDS as readonly string[]).includes(id)
        ? db.select({ n: count() }).from(s.units).where(and(eq(s.units.projectId, projectId), ...markConditions(projectId, [id as (typeof LINE_MARK_IDS)[number]]))).get()!.n
        : 0,
      items: items.get(id) ?? 0,
    })),
  };
}
