import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { isSpecialListener } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { describeRule, speechRuleIndex } from './speech.ts';

/**
 * What a line's detail shows beyond its row: its scene, the lines before and after it, its graph nodes, the speech rule it
 * falls under and the names it may address (the scene's speakers and the listeners people typed there, nearest first).
 * One line (GET units/:id) or a page of them at once (the list asks for its page before a line is picked), in the order
 * asked; ids of another project or gone are left out. The speech rules and each scene's lines are read once per call.
 */
export function lineContexts(db: Db, projectId: string | undefined, unitIds: readonly string[]) {
  const units = inChunks(unitIds, (slice) => db.select().from(s.units).where(and(inArray(s.units.id, slice), ...(projectId ? [eq(s.units.projectId, projectId)] : []))).all());
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const groupIds = [...new Set(units.map((unit) => unit.groupId))];
  const groups = new Map(inChunks(groupIds, (slice) => db.select({ id: s.groups.id, title: s.groups.title, key: s.groups.key }).from(s.groups).where(inArray(s.groups.id, slice)).all()).map((group) => [group.id, group]));
  const tags = Map.groupBy(inChunks(unitIds, (slice) => db.select({ unitId: s.unitTags.unitId, tagId: s.unitTags.tagId }).from(s.unitTags).where(inArray(s.unitTags.unitId, slice)).all()), (row) => row.unitId);
  const sceneLines = new Map<string, { seq: number; speaker: string | null; listener: string | null; origin: string | null }[]>();
  const sceneOf = (groupId: string) => {
    let lines = sceneLines.get(groupId);
    if (!lines) sceneLines.set(groupId, (lines = db.select({ seq: s.units.seq, speaker: s.units.speaker, listener: s.units.listener, origin: s.units.listenerOrigin }).from(s.units).where(eq(s.units.groupId, groupId)).all()));
    return lines;
  };
  const rules = new Map<string, ReturnType<typeof speechRuleIndex>>();
  const rulesOf = (id: string) => {
    let index = rules.get(id);
    if (!index) rules.set(id, (index = speechRuleIndex(db, id)));
    return index;
  };
  const neighborFields = { id: s.units.id, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation };
  return unitIds.flatMap((unitId) => {
    const unit = byId.get(unitId);
    if (!unit) return [];
    const neighbors = {
      previous: db.select(neighborFields).from(s.units).where(and(eq(s.units.groupId, unit.groupId), lt(s.units.seq, unit.seq))).orderBy(desc(s.units.seq)).limit(1).get(),
      next: db.select(neighborFields).from(s.units).where(and(eq(s.units.groupId, unit.groupId), gt(s.units.seq, unit.seq))).orderBy(asc(s.units.seq)).limit(1).get(),
    };
    const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key }).from(s.graphNodes).where(sql`exists (select 1 from json_each(${s.graphNodes.unitIds}) where value = ${unitId})`).all();
    const resolved = rulesOf(unit.projectId).resolve([unit]).get(unit.key);
    const speech = resolved ? { listener: resolved.listener, ruleId: resolved.rule.id, rule: describeRule(resolved.rule), level: resolved.rule.level, byOrder: resolved.byOrder, routeDependent: !!resolved.routeDependent, others: !!resolved.others } : null;
    const distance = new Map<string, number>();
    for (const other of sceneOf(unit.groupId)) {
      for (const name of [other.speaker, other.origin === 'human' ? other.listener : null]) {
        if (!name || name === unit.speaker || isSpecialListener(name)) continue;
        const far = Math.abs(other.seq - unit.seq);
        if (far < (distance.get(name) ?? Infinity)) distance.set(name, far);
      }
    }
    const sceneNames = [...distance].sort((a, b) => a[1] - b[1]).map(([name]) => name);
    // Its candidates and run history are POST units/extras: the browser holds them apart and reads them again when the feed names the line.
    return [{ ...unit, group: groups.get(unit.groupId)!, neighbors, tagIds: (tags.get(unitId) ?? []).map((row) => row.tagId), graphNodes: nodes, speech, sceneNames }];
  });
}
