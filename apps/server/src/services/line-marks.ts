import { and, eq, sql, type SQL } from 'drizzle-orm';
import { LISTENER_MIN_CONFIDENCE, type LineMark } from '@tw/shared';
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
export const knownListenerSql = sql`(${s.units.listener} is not null and (coalesce(${s.units.listenerOrigin}, '') not in ('ai', 'scene') or coalesce(${s.units.listenerConfidence}, 0) >= ${LISTENER_MIN_CONFIDENCE}))`;

function markCondition(projectId: string, mark: LineMark): SQL {
  switch (mark) {
    case 'remaining':
      return sql`${s.units.statusId} in (select id from ${s.statuses} where ${s.statuses.projectId} = ${projectId} and ${s.statuses.kind} != 'final')`;
    case 'ai':
      return eq(s.units.statusBy, 'ai');
    // needsListener in shared: dialogue with a speaker and text besides the project's format tokens.
    case 'unknownListener':
      return and(eq(s.units.kind, 'dialogue'), sql`trim(coalesce(${s.units.speaker}, '')) != ''`, sql`not ${knownListenerSql}`, sql`has_text(${s.units.source}, (select ${s.projects.formatRules} from ${s.projects} where ${s.projects.id} = ${projectId}))`)!;
    case 'diverged':
      return sql`${s.units.translation} is not null and ${sameSource(sql`${s.units.source}`)} in (select ${sameSource(sql`u.source`)} from ${s.units} u where u.project_id = ${projectId} and u.translation is not null and u.translation != '' and ${sameSource(sql`u.source`)} != '' group by 1 having count(distinct trim(u.translation)) > 1)`;
    case 'noted':
      return sql`${s.units.note} != ''`;
  }
}

/** One condition per mark, to be ANDed with the rest of a line query over `units`. */
export function markConditions(projectId: string, marks: readonly LineMark[] | undefined): SQL[] {
  return [...new Set(marks ?? [])].map((mark) => markCondition(projectId, mark));
}
