import { and, eq, inArray, or } from 'drizzle-orm';
import type { LineMark } from '@tw/shared';
import { inChunks, inList } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { tagIdsOf } from './knowledge-list.ts';
import { preflight } from './preflight.ts';

export interface PlanInput {
  /** Workflow id or name. */
  workflow: string;
  /** Scenes/groups by key, id or title. */
  groups?: string[];
  /** Line keys. */
  keys?: string[];
  /** Tag names or ids; a line must carry all of them. */
  tags?: string[];
  marks?: LineMark[];
  ignoreStatus?: boolean;
}

/** The run dialog's scope (groupIds, unitIds, tagIds, marks) from names, keys and tag names; whatever did not resolve is returned as `unknown`. */
export function resolveRunScope(db: Db, projectId: string, input: Omit<PlanInput, 'workflow'>) {
  const unknown: string[] = [];
  const scope: s.RunScope = {};
  if (input.groups?.length) {
    const rows = inChunks(input.groups, (slice) => db.select({ id: s.groups.id, key: s.groups.key, title: s.groups.title }).from(s.groups).where(and(eq(s.groups.projectId, projectId), or(inList(s.groups.key, slice), inList(s.groups.id, slice), inList(s.groups.title, slice)))).all());
    const seen = new Set(rows.flatMap((row) => [row.key, row.id, row.title]));
    unknown.push(...input.groups.filter((value) => !seen.has(value)).map((value) => `묶음 ${value}`));
    scope.groupIds = rows.map((row) => row.id);
  }
  if (input.keys?.length) {
    const rows = inChunks(input.keys, (slice) => db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, slice))).all());
    const seen = new Set(rows.map((row) => row.key));
    unknown.push(...input.keys.filter((key) => !seen.has(key)).map((key) => `대사 ${key}`));
    scope.unitIds = rows.map((row) => row.id);
  }
  if (input.tags?.length) {
    const ids = tagIdsOf(db, projectId, input.tags);
    const known = new Set(db.select({ id: s.tags.id }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => tag.id));
    unknown.push(...input.tags.filter((_, index) => !known.has(ids[index]!)).map((tag) => `태그 ${tag}`));
    scope.tagIds = ids.filter((id) => known.has(id));
  }
  if (input.marks?.length) scope.marks = input.marks;
  if (input.ignoreStatus) scope.ignoreStatus = true;
  return { scope, unknown };
}

/**
 * The run dialog's preflight for a scope, read-only (no run is made, no model called): lines,
 * batches, requests per AI node and the readiness findings, with the names of the unreviewed
 * speech rules and terms the dialog only links to.
 */
export async function planRun(db: Db, projectId: string, input: PlanInput) {
  const workflows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all();
  const wanted = input.workflow.toLowerCase();
  const workflow = workflows.find((row) => row.id === input.workflow) ?? workflows.find((row) => row.name.toLowerCase() === wanted) ?? workflows.filter((row) => row.name.toLowerCase().includes(wanted))[0];
  if (!workflow) return { ok: false as const, error: `워크플로를 찾을 수 없습니다: ${input.workflow}. 있는 것: ${workflows.map((row) => row.name).join(', ') || '(없음)'}` };
  const { scope, unknown } = resolveRunScope(db, projectId, input);
  if (unknown.length) return { ok: false as const, error: `찾지 못함: ${unknown.slice(0, 10).join(', ')}` };
  const { plan, readiness, ...rest } = await preflight(db, workflow, scope);
  const termNames = inChunks(readiness.unreviewedTerms.ids, (ids) => db.select({ id: s.terms.id, source: s.terms.source }).from(s.terms).where(inArray(s.terms.id, ids)).all());
  const ruleNames = inChunks(readiness.unreviewedRules.ids, (ids) => db.select({ id: s.speechRules.id, from: s.speechRules.fromName, to: s.speechRules.toName }).from(s.speechRules).where(inArray(s.speechRules.id, ids)).all());
  return {
    ok: true as const,
    workflow: { id: workflow.id, name: workflow.name },
    scope,
    ...rest,
    plan: { batches: plan.batches, linesPerBatch: plan.linesPerBatch },
    readiness: {
      ...readiness,
      unreviewedRules: { ...readiness.unreviewedRules, names: ruleNames.map((rule) => `${rule.from} → ${rule.to}`) },
      unreviewedTerms: { ...readiness.unreviewedTerms, names: termNames.map((term) => term.source) },
    },
  };
}
