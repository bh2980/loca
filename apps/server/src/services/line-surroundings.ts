import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { isSpecialListener } from '@loca/shared';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { describeRule, speechRuleIndex } from '../domain/speech.ts';

/**
 * A line's surroundings: what its detail shows that is not on its own row and is worked out from other rows. The lines
 * before and after it in its scene (by id: the browser reads them from its lines), its graph nodes, the speech rule it
 * falls under and the names it may address (the scene's speakers and the listeners people typed there, nearest first).
 * Nothing of the line's own row is repeated here, so the browser's row is the only copy of it.
 * One line (GET units/:id/surroundings) or a page of them at once (the list asks for its page before a line is picked),
 * in the order asked; ids of another project or gone are left out. The speech rules and each scene's lines are read
 * once per call. (Not the "context" of an AI request: that is what a node sends to a model, engine/ai-context.ts.)
 */
export function lineSurroundings(db: Db, projectId: string | undefined, unitIds: readonly string[]) {
  const units = inChunks(unitIds, (slice) => db.select().from(s.units).where(and(inArray(s.units.id, slice), ...(projectId ? [eq(s.units.projectId, projectId)] : []))).all());
  const byId = new Map(units.map((unit) => [unit.id, unit]));
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
  return unitIds.flatMap((unitId) => {
    const unit = byId.get(unitId);
    if (!unit) return [];
    const neighbors = {
      previous: db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.groupId, unit.groupId), lt(s.units.seq, unit.seq))).orderBy(desc(s.units.seq)).limit(1).get()?.id ?? null,
      next: db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.groupId, unit.groupId), gt(s.units.seq, unit.seq))).orderBy(asc(s.units.seq)).limit(1).get()?.id ?? null,
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
    return [{ id: unit.id, neighbors, graphNodes: nodes, speech, sceneNames }];
  });
}
