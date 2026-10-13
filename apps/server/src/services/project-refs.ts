import { and, eq, inArray } from 'drizzle-orm';
import { badRequest } from '../context.ts';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

type Reader = Pick<Db, 'select'>;

/** Ids from `ids` that are not among `found`. */
const missing = (ids: readonly string[], found: readonly string[]) => {
  const have = new Set(found);
  return [...new Set(ids)].filter((id) => !have.has(id));
};

/**
 * Refuses (400) ids a client sent that are not this project's: a status, tags, a candidate (of one of
 * its lines) or lines. Every write that takes such ids from outside calls this first, so nothing
 * crosses into another project.
 */
export function assertProjectRefs(db: Reader, projectId: string, refs: { statusId?: string; tagIds?: readonly string[]; candidateId?: string; unitIds?: readonly string[] }) {
  if (refs.statusId && !db.select({ id: s.statuses.id }).from(s.statuses).where(and(eq(s.statuses.id, refs.statusId), eq(s.statuses.projectId, projectId))).get()) badRequest('이 프로젝트에 없는 상태입니다.');
  if (refs.tagIds?.length) {
    const found = inChunks(refs.tagIds, (slice) => db.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.projectId, projectId), inArray(s.tags.id, slice))).all()).map((row) => row.id);
    if (missing(refs.tagIds, found).length) badRequest('이 프로젝트에 없는 태그입니다.');
  }
  if (refs.candidateId && !db.select({ id: s.candidates.id }).from(s.candidates).innerJoin(s.units, eq(s.units.id, s.candidates.unitId)).where(and(eq(s.candidates.id, refs.candidateId), eq(s.units.projectId, projectId))).get()) badRequest('이 프로젝트에 없는 후보입니다.');
  if (refs.unitIds?.length) {
    const found = inChunks(refs.unitIds, (slice) => db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).all()).map((row) => row.id);
    if (missing(refs.unitIds, found).length) badRequest('이 프로젝트에 없는 대사가 있습니다.');
  }
}
