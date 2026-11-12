import { randomUUID } from 'node:crypto';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { createGroupSchema, updateGroupSchema, updateUnitSchema } from '@tw/shared';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { badRequest, found } from '../http-errors.ts';
import { computeLayouts, cancelViewLayouts } from './layout.ts';
import { forgetProjectContext } from './context.ts';
import { namedListener } from './listeners.ts';
import { setLineStatus } from './line-save.ts';
import { PERSON, type Saver } from './status-by.ts';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select' | 'get'>;
const groupOf = (db: Reader, projectId: string, id: string) => found(db.select().from(s.groups).where(and(eq(s.groups.id, id), eq(s.groups.projectId, projectId))).get(), '묶음');
const unitOf = (db: Reader, projectId: string, id: string) => found(db.select().from(s.units).where(and(eq(s.units.id, id), eq(s.units.projectId, projectId))).get(), '원문 항목');
export const initialStatus = (db: Reader, projectId: string) => found(db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'initial'))).orderBy(asc(s.statuses.sort)).get(), '초기 상태').id;

function uniqueKey(db: Reader, projectId: string, table: typeof s.units | typeof s.groups, key: string, except?: string) {
  const row = db.select({ id: table.id }).from(table).where(and(eq(table.projectId, projectId), eq(table.key, key))).get();
  if (row && row.id !== except) badRequest(`이미 사용 중인 키입니다: ${key}`);
}

/** Active and paused jobs must keep their input stable; a run still storing its lines (preparing) may yet take any of them. */
export function refuseBusy(db: Reader, projectId: string, ids: string[]) {
  if (!ids.length) return;
  const busy = db.get<{ n: number }>(sql`select count(*) n from ${s.runs} r where r.project_id = ${projectId}
    and (r.status = 'preparing' or (r.status in ('running', 'paused')
      and exists (select 1 from ${s.runItems} i where i.run_id = r.id and i.subject_id in (select value from json_each(${JSON.stringify(ids)})))))`);
  if (busy?.n) badRequest('실행 중이거나 일시 정지된 워크플로에서 사용하는 원문입니다. 실행을 종료한 뒤 변경하거나 삭제하세요.');
}

/** Keep script order dense without touching content revisions on unrelated rows. */
export function resequence(tx: Tx, projectId: string) {
  tx.run(sql`with ordered as materialized (
    select u.id, row_number() over (order by g.sort, g.key, u.sort, u.key) - 1 as position
    from ${s.units} u join ${s.groups} g on g.id = u.group_id where u.project_id = ${projectId}
  ) update ${s.units} set seq = (select position from ordered where ordered.id = units.id)
    where project_id = ${projectId} and seq <> (select position from ordered where ordered.id = units.id)`);
}

/** Nodes retain their imported edges; their grouping always follows their first surviving unit. */
export function refreshNodeGroups(tx: Tx, projectId: string) {
  tx.run(sql`update ${s.graphNodes} set group_id = (
    select u.group_id from ${s.units} u where u.id = json_extract(graph_nodes.unit_ids, '$[0]')
  ) where project_id = ${projectId} and json_array_length(unit_ids) > 0`);
}

/**
 * The stored layouts are out of date: they stay (the graph keeps showing the last one, marked as
 * being laid out again) until computeLayouts replaces them. Views are laid out on demand, so theirs go.
 */
export function invalidate(tx: Tx, projectId: string) {
  cancelViewLayouts(projectId);
  tx.delete(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), like(s.graphLayouts.section, 'view:%'))).run();
  tx.update(s.graphLayouts).set({ status: 'pending', error: null }).where(eq(s.graphLayouts.projectId, projectId)).run();
}
export function changed(db: Db, projectId: string) {
  // The dialogue graph the AI context and exports walk back along is cached per project.
  forgetProjectContext(projectId);
  // Every orientation that has a stored layout is laid out again (one after another, see computeLayouts).
  const directions = db.selectDistinct({ direction: s.graphLayouts.direction }).from(s.graphLayouts).where(eq(s.graphLayouts.projectId, projectId)).all().map((row) => row.direction);
  for (const direction of directions.length ? directions : ['vertical' as const]) void computeLayouts(db, projectId, { direction });
}

export function createGroup(db: Db, projectId: string, raw: z.input<typeof createGroupSchema>) {
  const input = createGroupSchema.parse(raw);
  found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
  const key = input.key ?? `group-${randomUUID()}`;
  uniqueKey(db, projectId, s.groups, key);
  const row = db.transaction((tx) => {
    const sort = tx.get<{ n: number }>(sql`select coalesce(max(sort), -1) + 1 n from ${s.groups} where project_id = ${projectId}`)!.n;
    const result = tx.insert(s.groups).values({ ...input, key, projectId, section: input.section || null, sort }).returning().get();
    invalidate(tx, projectId);
    return result;
  });
  changed(db, projectId);
  return row;
}

export function updateGroup(db: Db, projectId: string, groupId: string, raw: z.input<typeof updateGroupSchema>) {
  const input = updateGroupSchema.parse(raw);
  groupOf(db, projectId, groupId);
  if (input.key) uniqueKey(db, projectId, s.groups, input.key, groupId);
  const row = db.transaction((tx) => {
    const result = Object.keys(input).length ? tx.update(s.groups).set({ ...input, ...(input.section !== undefined && { section: input.section || null }) }).where(eq(s.groups.id, groupId)).returning().get()! : groupOf(tx, projectId, groupId);
    resequence(tx, projectId);
    invalidate(tx, projectId);
    return result;
  });
  changed(db, projectId);
  return row;
}

export function updateUnit(db: Db, projectId: string, unitId: string, raw: z.input<typeof updateUnitSchema>, saver: Saver = PERSON) {
  const input = updateUnitSchema.parse(raw);
  const unit = unitOf(db, projectId, unitId);
  // Only a person replaces a listener a person set or the import brought (as for an AI's guess, setAiListener).
  if (input.listener !== undefined && saver.statusBy !== 'human' && (unit.listenerOrigin === 'human' || (unit.listenerOrigin === 'import' && unit.listener))) badRequest('사람이 정했거나 가져온 청자가 있어 바꾸지 않았습니다. 청자를 빼고 다시 보내세요.');
  refuseBusy(db, projectId, [unitId]);
  const group = groupOf(db, projectId, input.groupId ?? unit.groupId);
  if ((group.kind === 'scene' ? 'dialogue' : group.kind) !== unit.kind) badRequest('같은 종류의 묶음으로 이동하세요.');
  if (unit.kind !== 'dialogue' && (input.speaker || input.listener)) badRequest('문서와 UI 항목에는 화자·청자를 지정하지 않습니다.');
  if (input.key) uniqueKey(db, projectId, s.units, input.key, unitId);
  const row = db.transaction((tx) => {
    const moved = group.id !== unit.groupId;
    const sort = moved ? tx.get<{ n: number }>(sql`select coalesce(max(sort), -1) + 1 n from ${s.units} where group_id = ${group.id}`)!.n : unit.sort;
    const sourceChanged = input.source !== undefined && input.source !== unit.source;
    if (Object.keys(input).length) tx.update(s.units).set({ ...input, sort, ...(input.listener !== undefined && namedListener(saver)) }).where(eq(s.units.id, unitId)).run();
    // A changed source is not translated yet: the line starts over, set so by whoever changed it.
    if (sourceChanged) setLineStatus(tx, projectId, [unitId], initialStatus(tx, projectId), { statusBy: saver.statusBy });
    if (input.key && input.key !== unit.key) {
      for (const table of [s.characters, s.relationships, s.documents, s.storyEvents, s.speechRules]) {
        for (const item of tx.select({ id: table.id, evidence: table.evidence }).from(table).where(eq(table.projectId, projectId)).all()) {
          if (item.evidence.includes(unit.key)) tx.update(table).set({ evidence: item.evidence.map((key) => key === unit.key ? input.key! : key) }).where(eq(table.id, item.id)).run();
        }
      }
    }
    refreshNodeGroups(tx, projectId);
    resequence(tx, projectId);
    invalidate(tx, projectId);
    return unitOf(tx, projectId, unitId);
  });
  changed(db, projectId);
  return row;
}
