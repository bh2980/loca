import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { nodeName, withRunModels, workflowInput, type LineMark, type RunModels, type WorkflowDefinition, type WorkflowSubject } from '@tw/shared';
import { z } from 'zod';
import { inChunks, inList } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { tagIdsOf } from './knowledge-list.ts';
import { preflight } from './preflight.ts';
import { findTerm } from './term-usage.ts';

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
  /** Terms by id or source: the scope of a terms workflow (none = the entry's term statuses and marks). */
  terms?: string[];
  ignoreStatus?: boolean;
  /** Models for this run instead of the nodes' own (see runModelInput). */
  models?: RunModelInput;
}

/**
 * A run's models by name, for the CLI and the chat: AI node (id or name; '*' = every AI node) →
 * connection (id or name), model and effort.
 */
export const runModelInput = z.record(z.string(), z.object({ connection: z.string().min(1), model: z.string().min(1), effort: z.string().optional() }));
export type RunModelInput = z.infer<typeof runModelInput>;

/** `runModelInput` as the run takes it (by node id and connection id); what did not resolve is returned as `unknown`. */
export function resolveRunModels(db: Db, definition: WorkflowDefinition, input: RunModelInput | undefined) {
  const models: RunModels = {};
  const unknown: string[] = [];
  if (!input) return { models, unknown };
  // API-key (http) connections are for tools, not AI nodes: the run refuses them, so the preview does too.
  const connections = db.select({ id: s.connections.id, name: s.connections.name }).from(s.connections).where(ne(s.connections.kind, 'http')).all();
  const ai = definition.nodes.filter((node) => node.type === 'ai');
  for (const [key, pick] of Object.entries(input)) {
    const connection = connections.find((row) => row.id === pick.connection) ?? connections.find((row) => row.name.toLowerCase() === pick.connection.toLowerCase());
    if (!connection) unknown.push(`연결 ${pick.connection}`);
    const nodes = key === '*' ? ai : ai.filter((node) => node.id === key || nodeName(node).toLowerCase() === key.toLowerCase());
    if (!nodes.length) unknown.push(`AI 노드 ${key}`);
    if (connection) for (const node of nodes) models[node.id] = { connectionId: connection.id, model: pick.model, ...(pick.effort && { effort: pick.effort }) };
  }
  return { models, unknown };
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
  if (input.terms?.length) {
    const found = input.terms.map((term) => ({ term, row: findTerm(db, projectId, term) }));
    unknown.push(...found.filter((entry) => !entry.row).map((entry) => `용어 ${entry.term}`));
    scope.termIds = [...new Set(found.flatMap((entry) => (entry.row ? [entry.row.id] : [])))];
  }
  if (input.ignoreStatus) scope.ignoreStatus = true;
  return { scope, unknown };
}

/** Why a scope does not fit the workflow's input (line conditions for a terms workflow, terms for a lines workflow), or null. */
export function scopeMismatch(input: WorkflowSubject, scope: s.RunScope): string | null {
  const lineScope = Boolean(scope.groupIds?.length || scope.unitIds?.length || scope.tagIds?.length || scope.marks?.length || scope.statusIds?.length);
  if (input === 'terms' && lineScope) return '용어 입력 워크플로에는 대사 범위(묶음·대사 키·태그·표시·상태)를 쓸 수 없습니다. 용어로 범위를 정하세요.';
  if (input === 'lines' && scope.termIds?.length) return '대사 입력 워크플로에는 용어를 고를 수 없습니다.';
  return null;
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
  const mismatch = scopeMismatch(workflowInput(workflow.definition), scope);
  if (mismatch) return { ok: false as const, error: mismatch };
  if (unknown.length) return { ok: false as const, error: `찾지 못함: ${unknown.slice(0, 10).join(', ')}` };
  const picked = resolveRunModels(db, workflow.definition, input.models);
  if (picked.unknown.length) return { ok: false as const, error: `찾지 못함: ${picked.unknown.join(', ')}` };
  const { plan, readiness, ...rest } = await preflight(db, { ...workflow, definition: withRunModels(workflow.definition, picked.models) }, scope);
  const termNames = inChunks(readiness.unreviewedTerms.ids, (ids) => db.select({ id: s.terms.id, source: s.terms.source }).from(s.terms).where(inArray(s.terms.id, ids)).all());
  const ruleNames = inChunks(readiness.unreviewedRules.ids, (ids) => db.select({ id: s.speechRules.id, from: s.speechRules.fromName, to: s.speechRules.toName }).from(s.speechRules).where(inArray(s.speechRules.id, ids)).all());
  return {
    ok: true as const,
    workflow: { id: workflow.id, name: workflow.name },
    subject: workflowInput(workflow.definition),
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
