import { and, eq, inArray, ne } from 'drizzle-orm';
import { KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, nodeName, someOf, withRunModels, workflowInput, type RunCardPlan, type RunModels, type RunScope, type RunScopeInput, type RunTerms, type RunTermsInput, type WorkflowDefinition, type Subject, SUBJECTS, INPUT_TYPES } from '@tw/shared';
import { z } from 'zod';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { tagIdsOf } from './knowledge-list.ts';
import { preflight } from './preflight.ts';
import { findTerm } from './term-usage.ts';
import { resolveLineFilter, unknownMessage } from './line-filter.ts';

/** What plan_run is given: a workflow by id or name, the scope as asked (names), and this run's models. */
export interface PlanInput extends Omit<RunScopeInput, 'changeHuman'> {
  workflow: string;
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
export function resolveRunModels(db: Db, projectId: string, definition: WorkflowDefinition, input: RunModelInput | undefined) {
  const models: RunModels = {};
  const unknown: string[] = [];
  if (!input) return { models, unknown };
  // API-key (http) connections are for tools, not AI nodes: the run refuses them, so the preview does too.
  const connections = db.select({ id: s.connections.id, name: s.connections.name }).from(s.connections).where(and(eq(s.connections.projectId, projectId), ne(s.connections.kind, 'http'))).all();
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

const SCOPE_MISMATCH: Record<Subject, string> = {
  terms: '용어 입력 워크플로에는 대사 필터(filter)를 쓸 수 없습니다. 용어·상태·정한 쪽·번역 비어 있음·표시·태그로 범위를 정하세요(terms).',
  lines: '대사 입력 워크플로에는 용어 범위(terms)를 쓸 수 없습니다. 대사 필터(filter)로 범위를 정하세요.',
};

/** Why a scope does not fit the workflow's input (a line filter for a terms workflow, terms for a lines workflow), or null. Asked or resolved: both name their parts alike. */
export function scopeMismatch(input: Subject, scope: { filter?: object; terms?: object }): string | null {
  // The part of a scope each input picks by (InputType.scope); naming another input's part is the mismatch.
  const foreign = SUBJECTS.find((other) => other !== input && Object.keys(scope[INPUT_TYPES[other].scope] ?? {}).length);
  return foreign ? SCOPE_MISMATCH[input] : null;
}

/** The terms of a scope from what was asked: terms by id or source, statuses by label or id, tags by name or id. */
function resolveRunTerms(db: Db, projectId: string, input: RunTermsInput): { terms: RunTerms; unknown: string[] } {
  const unknown: string[] = [];
  const terms: RunTerms = {};
  if (input.terms?.length) {
    const found = input.terms.map((term) => ({ term, row: findTerm(db, projectId, term) }));
    unknown.push(...found.filter((entry) => !entry.row).map((entry) => `용어 ${entry.term}`));
    const ids = someOf(found.flatMap((entry) => (entry.row ? [entry.row.id] : [])));
    if (ids) terms.ids = ids;
  }
  if (input.statuses?.length) {
    const found = input.statuses.map((value) => ({ value, id: KNOWLEDGE_STATUSES.find((id) => id === value || KNOWLEDGE_STATUS_LABELS[id] === value) }));
    unknown.push(...found.filter((entry) => !entry.id).map((entry) => `상태 ${entry.value}`));
    const statuses = someOf(found.flatMap((entry) => (entry.id ? [entry.id] : [])));
    if (statuses) terms.statuses = statuses;
  }
  if (input.tags?.length) {
    const known = new Set(db.select({ id: s.tags.id }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => tag.id));
    const ids = tagIdsOf(db, projectId, input.tags);
    unknown.push(...input.tags.filter((_, index) => !known.has(ids[index]!)).map((tag) => `태그 ${tag}`));
    const tagIds = someOf(ids.filter((id) => known.has(id)));
    if (tagIds) terms.tagIds = tagIds;
  }
  const marks = someOf(input.marks ?? []);
  if (marks) terms.marks = marks;
  if (input.decidedBy) terms.decidedBy = input.decidedBy;
  if (input.emptyTarget !== undefined) terms.emptyTarget = input.emptyTarget;
  // As in resolveLineFilter: a name that was not found never widens the scope, even for a caller that ignores `unknown`.
  if (unknown.length) terms.nothing = true;
  return { terms, unknown };
}

/** The scope a run stores, from the scope as asked: the line filter resolved (resolveLineFilter) or the terms; whatever the project does not have is returned as `unknown`. */
export function resolveRunScope(db: Db, projectId: string, input: RunScopeInput): { scope: RunScope; unknown: string[] } {
  const lines = input.filter && Object.keys(input.filter).length ? resolveLineFilter(db, projectId, input.filter) : null;
  const terms = input.terms && Object.keys(input.terms).length ? resolveRunTerms(db, projectId, input.terms) : null;
  return {
    scope: { ...(lines && { filter: lines.filter }), ...(terms && { terms: terms.terms }), ...(input.changeHuman && { changeHuman: true }) },
    unknown: [...(lines?.unknown ?? []), ...(terms?.unknown ?? [])],
  };
}

/** The scope asked of a workflow, resolved, or why it cannot be: it does not fit the workflow's input, or it names what the project does not have. The same answer wherever a run is planned or started. */
export function askedScope(db: Db, projectId: string, subject: Subject, input: RunScopeInput): { ok: true; scope: RunScope } | { ok: false; error: string } {
  const mismatch = scopeMismatch(subject, input);
  if (mismatch) return { ok: false, error: mismatch };
  const { scope, unknown } = resolveRunScope(db, projectId, input);
  if (unknown.length) return { ok: false, error: unknownMessage(unknown) };
  return { ok: true, scope };
}

/** The part of a preflight a person decides on: a run card and the card of a proposed run keep it, so they say what they said when they were made. */
export const planOf = (full: RunCardPlan): RunCardPlan => ({ lines: { total: full.lines.total, excluded: full.lines.excluded }, totals: { calls: full.totals.calls }, pace: full.pace, ...(full.suggestedLimits && { suggestedLimits: { maxCalls: full.suggestedLimits.maxCalls, maxInputTokens: full.suggestedLimits.maxInputTokens } }) });

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
  const resolved = askedScope(db, projectId, workflowInput(workflow.definition), { filter: input.filter, terms: input.terms });
  if (!resolved.ok) return resolved;
  const { scope } = resolved;
  const picked = resolveRunModels(db, projectId, workflow.definition, input.models);
  if (picked.unknown.length) return { ok: false as const, error: `찾지 못함: ${picked.unknown.join(', ')}` };
  let planned;
  try {
    planned = await preflight(db, { ...workflow, definition: withRunModels(workflow.definition, picked.models) }, scope);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
  const { plan, readiness, ...rest } = planned;
  const termNames = inChunks(readiness.candidateTerms.ids, (ids) => db.select({ id: s.terms.id, source: s.terms.source }).from(s.terms).where(inArray(s.terms.id, ids)).all());
  const ruleNames = inChunks(readiness.candidateRules.ids, (ids) => db.select({ id: s.speechRules.id, from: s.speechRules.fromName, to: s.speechRules.toName }).from(s.speechRules).where(inArray(s.speechRules.id, ids)).all());
  return {
    ok: true as const,
    workflow: { id: workflow.id, name: workflow.name },
    subject: workflowInput(workflow.definition),
    scope,
    ...rest,
    plan: { batches: plan.batches, linesPerBatch: plan.linesPerBatch },
    readiness: {
      ...readiness,
      candidateRules: { ...readiness.candidateRules, names: ruleNames.map((rule) => `${rule.from} → ${rule.to}`) },
      candidateTerms: { ...readiness.candidateTerms, names: termNames.map((term) => term.source) },
    },
  };
}
