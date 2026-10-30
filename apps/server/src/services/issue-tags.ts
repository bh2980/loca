import { and, eq, inArray } from 'drizzle-orm';
import { ISSUE_KIND_IDS, ISSUE_KINDS, type IssueKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { knowledgeOf } from './speech.ts';

type Tx = Pick<Db, 'select' | 'insert' | 'delete'>;
export interface IssueTagChange {
  add?: IssueKind[];
  /** Kinds this check covers and found fine; 'all' when the line's translation itself changed. */
  clear?: IssueKind[] | 'all';
}

/**
 * Puts problem-type tags on a line or takes them off (see ISSUE_KINDS). A project gets each kind's
 * tag the first time a check finds that kind, so only kinds that ever came up show in its filters.
 */
export function applyIssueTags(tx: Tx, projectId: string, unitId: string, change: IssueTagChange) {
  const clear = change.clear === 'all' ? ISSUE_KIND_IDS : (change.clear ?? []).filter((kind) => !change.add?.includes(kind));
  const idOf = new Map(knowledgeOf(tx as Db, projectId).tags().flatMap((tag) => (tag.role && (ISSUE_KIND_IDS as readonly string[]).includes(tag.role) ? [[tag.role, tag.id] as const] : [])));
  const clearIds = clear.flatMap((kind) => (idOf.has(kind) ? [idOf.get(kind)!] : []));
  if (clearIds.length) tx.delete(s.unitTags).where(and(eq(s.unitTags.unitId, unitId), inArray(s.unitTags.tagId, clearIds))).run();
  for (const kind of change.add ?? []) {
    let id = idOf.get(kind);
    if (!id) {
      id = tx.insert(s.tags).values({ projectId, name: ISSUE_KINDS[kind].name, color: ISSUE_KINDS[kind].color, role: kind }).returning({ id: s.tags.id }).get().id;
      idOf.set(kind, id);
    }
    tx.insert(s.unitTags).values({ unitId, tagId: id }).onConflictDoNothing().run();
  }
}
