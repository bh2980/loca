import { and, eq, sql, type SQL } from 'drizzle-orm';
import { LISTENER_MIN_CONFIDENCE, type ExcludedFilter, type LineFacts, type LineMark } from '@tw/shared';
import * as s from '../db/schema.ts';

/**
 * Automatic marks: facts read off a line (never stored) that the script list filters by and a run
 * can be scoped by. Each is one SQL condition; a set of marks holds only when every one does.
 */
export type { LineMark };

/** A source as compared for "the same source": lower case, without spaces and punctuation at its ends ("What?" = "WHAT"). */
export const sameSource = (column: SQL) => sql`trim(lower(${column}), ' .,!?…"''-~')`;

/**
 * The listener counts unless it is an unsure guess (by line or by scene): the SQL twin of
 * isUnsureListener / isUnknownListener in shared, nulls included (no origin = not a guess, no
 * confidence = 0). line-marks.test.ts checks the two agree.
 */
export const knownListenerSql = sql`(${s.units.listener} is not null and (coalesce(${s.units.listenerOrigin}, '') not in ('ai') or coalesce(${s.units.listenerConfidence}, 0) >= ${LISTENER_MIN_CONFIDENCE}))`;

/**
 * 번역 제외 (exclusionReason / lineExclusion in shared, through the exclusion_reason SQL function):
 * a person's call on the line, else the project's rules over its source.
 */
export const excludedSql = (projectId: string) =>
  sql`exclusion_reason(${s.units.source}, ${s.units.translate}, (select ${s.projects.formatRules} from ${s.projects} where ${s.projects.id} = ${projectId}), (select ${s.projects.exclusionRules} from ${s.projects} where ${s.projects.id} = ${projectId}), (select ${s.projects.sourceLanguage} from ${s.projects} where ${s.projects.id} = ${projectId})) is not null`;
/** Lines for translation: what progress, the remaining lines, the review inbox, runs, exports and checks count. */
export const translatableSql = (projectId: string) => sql`not (${excludedSql(projectId)})`;

/** 청자 모름 (needsListener / isUnknownListener in shared): dialogue said to someone, with a speaker and text besides the project's format tokens, whose listener is unknown or an unsure guess. */
export const unknownListenerSql = (projectId: string) =>
  and(eq(s.units.kind, 'dialogue'), sql`not ${knownListenerSql}`, sql`needs_listener(${s.units.kind}, ${s.units.speaker}, ${s.units.source}, (select ${s.projects.formatRules} from ${s.projects} where ${s.projects.id} = ${projectId}))`)!;

/** 최종 아님: the line's status is not a final one, and it is for translation (the work left; 번역 제외 lines are not work). */
export const unfinishedSql = (projectId: string) =>
  sql`${s.units.statusId} in (select id from ${s.statuses} where ${s.statuses.projectId} = ${projectId} and ${s.statuses.kind} != 'final') and ${translatableSql(projectId)}`;
const finalSql = (projectId: string) => sql`${s.units.statusId} in (select id from ${s.statuses} where ${s.statuses.projectId} = ${projectId} and ${s.statuses.kind} = 'final')`;

/** The facts a line row shows, as filters (LineFacts in shared): 최종 아님, 정한 쪽, 메모, and 번역 제외. */
export function lineFactConditions(projectId: string, facts: LineFacts & { excluded?: ExcludedFilter }): SQL[] {
  return [
    ...(facts.unfinished === undefined ? [] : [facts.unfinished ? unfinishedSql(projectId) : finalSql(projectId)]),
    ...(facts.decidedBy ? [eq(s.units.statusBy, facts.decidedBy)] : []),
    ...(facts.noted === undefined ? [] : [facts.noted ? sql`trim(${s.units.note}) != ''` : sql`trim(${s.units.note}) = ''`]),
    ...(facts.excluded === 'hide' ? [translatableSql(projectId)] : facts.excluded === 'only' ? [excludedSql(projectId)] : []),
  ];
}

function markCondition(projectId: string, mark: LineMark): SQL {
  switch (mark) {
    case 'diverged':
      return sql`${s.units.translation} is not null and ${sameSource(sql`${s.units.source}`)} in (select ${sameSource(sql`u.source`)} from ${s.units} u where u.project_id = ${projectId} and u.translation is not null and u.translation != '' and ${sameSource(sql`u.source`)} != '' group by 1 having count(distinct trim(u.translation)) > 1)`;
    case 'aiSuggestion':
      return sql`exists (select 1 from ${s.candidates} c where c.unit_id = ${s.units.id} and c.state = 'pending')`;
  }
}

/** 숨기기: lines carrying any of these marks are left out (one condition). */
export function hiddenMarkConditions(projectId: string, marks: readonly LineMark[] | undefined): SQL[] {
  return [...new Set(marks ?? [])].map((mark) => sql`not (${markCondition(projectId, mark)})`);
}

/** One condition per mark, to be ANDed with the rest of a line query over `units`. */
export function markConditions(projectId: string, marks: readonly LineMark[] | undefined): SQL[] {
  return [...new Set(marks ?? [])].map((mark) => markCondition(projectId, mark));
}
