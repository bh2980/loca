import { and, asc, count, eq, inArray, like, lt, or, sql, type SQL } from 'drizzle-orm';
import { someOf, type LineFilter, type ResolvedLineFilter, type UnpagedLineFilter } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { badRequest, isRefusal } from '../refusal.ts';
import { hiddenMarkConditions, knownListenerSql, lineFactConditions, markConditions, translatableSql, unknownListenerSql } from './line-marks.ts';
import { lineTextFilter } from './line-text.ts';
import { viewUnitIds } from './view-flow.ts';
import { revOf } from './line-save.ts';

/**
 * The line filter, from what is asked to SQL, for every surface: the script list, `loca lines` / export / check, the
 * chat's tools, result files and a run's scope. Two steps, each written once:
 *   resolveLineFilter  names → ids and spellings, reporting every name the project does not have
 *   lineConditions     the resolved filter → SQL conditions over `units`
 * Nothing else turns a filter into SQL, so the same filter picks the same lines wherever it is used
 * (cli-parity.test.ts checks it field by field).
 */

/** 청자 모름 in a listener filter. */
const UNKNOWN_LISTENER = '-';

/** Every spelling a person goes by, for a name as someone wrote it: the stored name, the aliases, and the text itself. */
export function personNames(db: Db, projectId: string) {
  const characters = db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  const spellings = (character: (typeof characters)[number]) => [character.name, ...character.aliases];
  return (name: string) => {
    const wanted = name.trim().toLowerCase();
    let found = characters.filter((character) => spellings(character).some((alias) => alias.toLowerCase() === wanted));
    // "Alice" finds "Alice Grey" / CHAR_ALICE: a whole word of a name or alias, when nothing matches exactly.
    if (!found.length) {
      const word = new RegExp(`(^|[^\\p{L}\\p{N}])${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
      found = characters.filter((character) => spellings(character).some((alias) => word.test(alias.replace(/_/g, ' '))));
    }
    return [...new Set([name.trim(), ...found.flatMap(spellings)])];
  };
}

/**
 * The filter with its names resolved, and the names the project does not have (`unknown`, as "상태 X", "태그 Y",
 * "묶음 Z", "구역 …", "대사 …", "보기 …"): a caller answers with an error naming them instead of running a filter
 * that lost a condition. People are not looked up as ids: a speaker, listener or mention is every spelling of whoever
 * goes by that name, and a name nobody goes by is its own spelling (no line has it).
 */
export function resolveLineFilter(db: Db, projectId: string, filter: UnpagedLineFilter): { filter: ResolvedLineFilter; unknown: string[] } {
  const unknown: string[] = [];
  const resolved: ResolvedLineFilter = {};
  // A field is set only when it holds something, so the stored scope says only what narrows it.
  const put = <Key extends keyof ResolvedLineFilter>(key: Key, value: ResolvedLineFilter[Key] | undefined) => {
    if (value !== undefined) resolved[key] = value;
  };
  let names: ReturnType<typeof personNames> | undefined;
  const people = (list: readonly string[]) => someOf(list.flatMap((names ??= personNames(db, projectId))));

  put('q', filter.q);
  put('speakers', people(filter.speakers ?? []));
  put('listeners', people((filter.listeners ?? []).filter((name) => name !== UNKNOWN_LISTENER)));
  if (filter.listeners?.includes(UNKNOWN_LISTENER)) resolved.unknownListener = true;
  put('mentions', people(filter.mentions ?? []));
  put('hideSpeakers', people(filter.hideSpeakers ?? []));

  if (filter.groups?.length) {
    const byName = new Map<string, string[]>();
    for (const group of db.select({ id: s.groups.id, key: s.groups.key, title: s.groups.title }).from(s.groups).where(eq(s.groups.projectId, projectId)).all())
      for (const name of new Set([group.id, group.key, group.title])) byName.set(name, [...(byName.get(name) ?? []), group.id]);
    unknown.push(...filter.groups.filter((value) => !byName.has(value)).map((value) => `묶음 ${value}`));
    put('groupIds', someOf(filter.groups.flatMap((value) => byName.get(value) ?? [])));
  }
  if (filter.sections?.length) {
    const known = new Set(db.selectDistinct({ section: s.groups.section }).from(s.groups).where(eq(s.groups.projectId, projectId)).all().map((row) => row.section));
    unknown.push(...filter.sections.filter((value) => !known.has(value)).map((value) => `구역 ${value}`));
    put('sections', someOf(filter.sections.filter((value) => known.has(value))));
  }
  put('groupKind', filter.groupKind);
  put('kind', filter.kind);

  if (filter.statuses?.length || filter.hideStatuses?.length) {
    const statuses = db.select({ id: s.statuses.id, name: s.statuses.name }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const ids = (values: readonly string[] | undefined) =>
      someOf(
        (values ?? []).flatMap((value) => {
          const status = statuses.find((row) => row.id === value || row.name === value);
          if (!status) unknown.push(`상태 ${value}`);
          return status ? [status.id] : [];
        }),
      );
    put('statusIds', ids(filter.statuses));
    put('hideStatusIds', ids(filter.hideStatuses));
  }
  if (filter.tags?.length || filter.hideTags?.length) {
    const tags = db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all();
    const ids = (values: readonly string[] | undefined) =>
      someOf(
        (values ?? []).flatMap((value) => {
          const tag = tags.find((row) => row.id === value || row.name === value.replace(/^#/, ''));
          if (!tag) unknown.push(`태그 ${value}`);
          return tag ? [tag.id] : [];
        }),
      );
    put('tagIds', ids(filter.tags));
    put('hideTagIds', ids(filter.hideTags));
  }
  put('marks', someOf(filter.marks ?? []));
  put('hideMarks', someOf(filter.hideMarks ?? []));
  put('unfinished', filter.unfinished);
  put('decidedBy', filter.decidedBy);
  put('noted', filter.noted);
  put('excluded', filter.excluded);
  put('review', filter.review);
  put('translated', filter.translated);

  // Lines named one by one, three ways; given several, a line must be in all of them.
  const named: (readonly string[])[] = [];
  if (filter.keys?.length) {
    const rows = inChunks(filter.keys, (slice) => db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, slice))).all());
    const found = new Set(rows.map((row) => row.key));
    unknown.push(...filter.keys.filter((key) => !found.has(key)).map((key) => `대사 ${key}`));
    named.push(rows.map((row) => row.id));
  }
  // Ids are not names: one that is no line of this project (deleted since it was picked) matches nothing.
  if (filter.ids?.length) named.push(filter.ids);
  if (filter.view) {
    try {
      named.push(viewUnitIds(db, projectId, filter.view));
    } catch (error) {
      if (!isRefusal(error, 'missing')) throw error;
      unknown.push(`보기 ${filter.view}`);
    }
  }
  if (named.length) {
    const [first, ...rest] = named.sort((a, b) => a.length - b.length);
    const others = rest.map((list) => new Set(list));
    const lineIds = someOf(first!.filter((id) => others.every((list) => list.has(id))));
    if (lineIds) resolved.lineIds = lineIds;
    else resolved.nothing = true;
  }
  // A caller must answer `unknown` with an error; should one run the filter anyway, a lost condition matches no line, not more lines.
  if (unknown.length) resolved.nothing = true;
  return { filter: resolved, unknown: [...new Set(unknown)] };
}

/** How every surface names what a filter did not find. */
export const unknownMessage = (unknown: readonly string[]) => `찾지 못함: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ` 외 ${unknown.length - 10}개` : ''}`;

/** The resolved filter, or a 400 naming what the project does not have (a route, a tool and the CLI all answer with it). */
export function requireLineFilter(db: Db, projectId: string, filter: UnpagedLineFilter): ResolvedLineFilter {
  const { filter: resolved, unknown } = resolveLineFilter(db, projectId, filter);
  if (unknown.length) badRequest(unknownMessage(unknown));
  return resolved;
}

/**
 * The conditions a resolved filter puts on `units`, to be ANDed (the project's own included). They name no other table
 * to join: groups, tags and statuses are asked through subqueries, so any query over units can take them as they are.
 */
export function lineConditions(projectId: string, filter: ResolvedLineFilter): SQL[] {
  const where: SQL[] = [eq(s.units.projectId, projectId)];
  if (filter.nothing) where.push(sql`0`);
  if (filter.q) where.push(lineTextFilter(filter.q));
  // A scope can name every line of a large project; long lists travel as one JSON parameter (inList).
  if (filter.lineIds) where.push(inList(s.units.id, filter.lineIds));
  if (filter.speakers) where.push(inList(s.units.speaker, filter.speakers));
  // The app's rules (line-marks.ts): a name must be a known listener, 청자 모름 is dialogue said to someone unknown.
  if (filter.listeners || filter.unknownListener)
    where.push(or(filter.listeners ? and(inList(s.units.listener, filter.listeners), knownListenerSql) : undefined, filter.unknownListener ? unknownListenerSql(projectId) : undefined)!);
  // A mention is a whole word or a {NAME} placeholder (mentions_any, db/index.ts); LIKE narrows what it has to read.
  if (filter.mentions) where.push(and(or(...filter.mentions.map((name) => like(s.units.source, `%${name}%`))), sql`mentions_any(${s.units.source}, ${JSON.stringify(filter.mentions)})`)!);
  if (filter.groupIds) where.push(inList(s.units.groupId, filter.groupIds));
  if (filter.sections || filter.groupKind)
    where.push(sql`${s.units.groupId} in (select ${s.groups.id} from ${s.groups} where ${and(eq(s.groups.projectId, projectId), filter.sections ? inList(s.groups.section, filter.sections) : undefined, filter.groupKind ? eq(s.groups.kind, filter.groupKind) : undefined)})`);
  if (filter.kind) where.push(eq(s.units.kind, filter.kind));
  if (filter.statusIds) where.push(inList(s.units.statusId, filter.statusIds));
  if (filter.review) where.push(sql`${s.units.statusId} in (select ${s.statuses.id} from ${s.statuses} where ${s.statuses.projectId} = ${projectId} and ${s.statuses.inReview} = 1)`);
  // Several tags: lines carrying every one of them.
  for (const tagId of filter.tagIds ?? []) where.push(sql`${s.units.id} in (select unit_id from ${s.unitTags} where tag_id = ${tagId})`);
  where.push(...markConditions(projectId, filter.marks), ...lineFactConditions(projectId, filter));
  // 숨기기: any one of these leaves a line out.
  if (filter.hideSpeakers) where.push(sql`coalesce(${s.units.speaker}, '') not in (select value from json_each(${JSON.stringify(filter.hideSpeakers)}))`);
  if (filter.hideStatusIds) where.push(sql`${s.units.statusId} not in (select value from json_each(${JSON.stringify(filter.hideStatusIds)}))`);
  for (const tagId of filter.hideTagIds ?? []) where.push(sql`${s.units.id} not in (select unit_id from ${s.unitTags} where tag_id = ${tagId})`);
  where.push(...hiddenMarkConditions(projectId, filter.hideMarks));
  // Asking for translated or untranslated lines (exports, checks) asks for lines to translate: 번역 제외 lines stay out.
  if (filter.translated !== undefined) where.push(filter.translated ? sql`${s.units.translation} is not null and ${s.units.translation} != ''` : sql`(${s.units.translation} is null or ${s.units.translation} = '')`, translatableSql(projectId));
  return where;
}

/**
 * One page of a filter as ids (script order) with the filter's total and, for the scenes on the page, how many of
 * their lines the filter matches (their checkboxes): the script list's rows come from the browser's units collection.
 * `focus`: a line to show; the page is then the one holding it, and the answer says which offset that is.
 */
export function linePage(db: Db, projectId: string, filter: LineFilter, focus?: string) {
  const where = and(...lineConditions(projectId, requireLineFilter(db, projectId, filter)))!;
  const total = db.select({ count: count() }).from(s.units).where(where).get()!.count;
  let offset = filter.offset;
  if (focus) {
    const target = db.select({ seq: s.units.seq }).from(s.units).where(and(eq(s.units.id, focus), eq(s.units.projectId, projectId))).get();
    if (target) offset = Math.floor(db.select({ count: count() }).from(s.units).where(and(where, lt(s.units.seq, target.seq))).get()!.count / filter.limit) * filter.limit;
  }
  const page = db.select({ id: s.units.id, groupId: s.units.groupId }).from(s.units).where(where).orderBy(asc(s.units.seq)).limit(filter.limit).offset(offset).all();
  const shown = [...new Set(page.map((row) => row.groupId))];
  const scenes = shown.length ? db.select({ groupId: s.units.groupId, count: count() }).from(s.units).where(and(where, inArray(s.units.groupId, shown))).groupBy(s.units.groupId).all() : [];
  return { total, offset, ids: page.map((row) => row.id), scenes };
}

/**
 * Every line a filter matches, in script order, with its scene, who decided it, its tags and its rev: the translation
 * screen walks them one by one inside their scenes (찾아가기), and a scene's checkbox picks its whole filtered result
 * (a bulk change made from those picks sends the revs back).
 */
export function lineMatchRows(db: Db, projectId: string, filter: UnpagedLineFilter) {
  const rows = db.select({ id: s.units.id, groupId: s.units.groupId, statusBy: s.units.statusBy, updatedAt: s.units.updatedAt }).from(s.units).where(and(...lineConditions(projectId, requireLineFilter(db, projectId, filter)))).orderBy(asc(s.units.seq)).all();
  const tagsByUnit = new Map<string, string[]>();
  for (const tag of inChunks(rows.map((row) => row.id), (ids) => db.select({ unitId: s.unitTags.unitId, tagId: s.unitTags.tagId }).from(s.unitTags).where(inArray(s.unitTags.unitId, ids)).all())) tagsByUnit.set(tag.unitId, [...(tagsByUnit.get(tag.unitId) ?? []), tag.tagId]);
  return rows.map(({ updatedAt, ...row }) => ({ ...row, rev: revOf({ updatedAt }), tagIds: tagsByUnit.get(row.id) ?? [] }));
}
