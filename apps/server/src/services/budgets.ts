import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { autoBudgets, batchConfigSchema, contextConfigSchema, estimateTokens, limitsFor, lineCostIn, type AiNode, type BudgetHistory, type ModelChoice, type ModelLimits, type WorkflowDefinition } from '@tw/shared';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { outputCutOff } from './whole-script-limits.ts';

const connectionLimits = { inputTokens: s.connections.inputTokens, outputTokens: s.connections.outputTokens, modelLimits: s.connections.modelLimits };

/** What the chosen model's calls may take and give (limitsFor), or undefined when unknown. */
export function modelLimitsOf(db: Db, choice: ModelChoice | undefined): ModelLimits | undefined {
  if (!choice?.connectionId || !choice.model) return undefined;
  return limitsFor(db.select(connectionLimits).from(s.connections).where(eq(s.connections.id, choice.connectionId)).get(), choice.model);
}

/** What sizing reads of an AI node: enough to size one that is only being edited. */
export type SizedNode = Pick<AiNode, 'id'> & { config: Pick<AiNode['config'], 'model' | 'output'> & { batch?: unknown } };

/** Past requests read for one node and model: enough for a stable percentile, recent enough to follow a changed prompt. */
const HISTORY_REQUESTS = 50;

/**
 * What the latest HISTORY_REQUESTS requests of this workflow's AI node to this model say about its
 * answers (BudgetHistory). Sizes are line text as a request counts it (lineCostIn of the node's
 * batch mode). An answered request gives its answer tokens per line-text token, a partly answered
 * one counting only the lines it answered; a request that was answered in full also sets the largest
 * success; a cut-off answer (outputCutOff on the stored error) sets the smallest cut-off. Other
 * failures (rate limit, network, auth, refused, timeout) and rows with no token count say nothing
 * about length and are skipped, as are requests whose lines have since gone. undefined without a saved workflow.
 */
export function budgetHistory(db: Db, workflowId: string | null | undefined, node: SizedNode): BudgetHistory | undefined {
  const model = node.config.model.model;
  if (!workflowId || !model) return undefined;
  const steps = db
    .select({ subjectIds: s.runSteps.subjectIds, ok: s.runSteps.ok, error: s.runSteps.error, outputTokens: s.runSteps.outputTokens, returnedItems: s.runSteps.returnedItems, subject: s.runs.subject })
    .from(s.runSteps)
    .innerJoin(s.runs, eq(s.runs.id, s.runSteps.runId))
    .where(and(eq(s.runs.workflowId, workflowId), eq(s.runSteps.nodeId, node.id), eq(s.runSteps.model, model)))
    .orderBy(desc(s.runSteps.startedAt))
    .limit(HISTORY_REQUESTS)
    .all();
  if (!steps.length) return undefined;
  // Lines' tokens as the batches count them: units by their source text, terms by their source plus the entry around it.
  const idsOf = (subject: string) => steps.filter((step) => step.subject === subject).flatMap((step) => step.subjectIds);
  const tokens = new Map<string, number>();
  for (const row of inChunks(idsOf('lines'), (chunk) => db.select({ id: s.units.id, tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4` }).from(s.units).where(inArray(s.units.id, chunk)).all())) tokens.set(row.id, row.tokens);
  for (const row of inChunks(idsOf('terms'), (chunk) => db.select({ id: s.terms.id, source: s.terms.source }).from(s.terms).where(inArray(s.terms.id, chunk)).all())) tokens.set(row.id, estimateTokens(row.source) + 40);
  const cost = lineCostIn(batchConfigSchema.parse(node.config.batch ?? {}).mode);
  const history: BudgetHistory = { ratios: [], largestOk: null, smallestCutOff: null };
  for (const step of steps) {
    if (!step.subjectIds.length || step.subjectIds.some((id) => !tokens.has(id))) continue;
    const size = step.subjectIds.reduce((sum, id) => sum + cost({ tokens: tokens.get(id)! }), 0);
    if (!step.ok) {
      if (outputCutOff(step.error ?? '')) history.smallestCutOff = Math.min(history.smallestCutOff ?? size, size);
      continue;
    }
    const answered = step.returnedItems ?? step.subjectIds.length;
    if (step.outputTokens === null || !answered) continue;
    if (answered >= step.subjectIds.length) history.largestOk = Math.max(history.largestOk ?? 0, size);
    const answeredSize = (size * Math.min(answered, step.subjectIds.length)) / step.subjectIds.length;
    history.ratios.push(step.outputTokens / answeredSize);
  }
  return history;
}

/** The "auto" budgets (and what decided them) of an AI node: its model's limits and its own past requests. */
export function autoOf(db: Db, workflowId: string | null | undefined, node: SizedNode, limits: ModelLimits | undefined) {
  const batch = batchConfigSchema.parse(node.config.batch ?? {});
  return autoBudgets(limits, node.config.output, batch.mode, budgetHistory(db, workflowId, node));
}

/** An AI node with its "auto" budgets (null) filled from `auto` (autoOf); numbers a person set stay. */
export function resolveNodeBudgets(node: AiNode, auto: Pick<ReturnType<typeof autoBudgets>, 'lines' | 'context'>): AiNode {
  const batch = batchConfigSchema.parse(node.config.batch ?? {});
  const context = contextConfigSchema.parse(node.config.context ?? {});
  if (batch.maxTokens !== null && context.maxTokens !== null) return node;
  return { ...node, config: { ...node.config, batch: { ...batch, maxTokens: batch.maxTokens ?? auto.lines }, context: { ...context, maxTokens: context.maxTokens ?? auto.context } } };
}

/**
 * Every AI node's "auto" budgets for the models it will call (run models already applied), by node
 * id, with what decided them. `workflowId` is where past requests are found (null: a workflow not saved yet has none).
 */
export function autoBudgetsOf(db: Db, workflowId: string | null | undefined, definition: WorkflowDefinition) {
  const ai = definition.nodes.filter((node): node is AiNode => node.type === 'ai');
  const ids = [...new Set(ai.map((node) => node.config.model.connectionId).filter(Boolean))];
  const connections = new Map(ids.length ? db.select({ id: s.connections.id, ...connectionLimits }).from(s.connections).where(inArray(s.connections.id, ids)).all().map((row) => [row.id, row]) : []);
  return new Map(ai.map((node) => [node.id, autoOf(db, workflowId, node, limitsFor(connections.get(node.config.model.connectionId), node.config.model.model))] as const));
}

/** A definition with every AI node's "auto" budgets filled from `autos` (autoBudgetsOf): what a run stores and plans with, and what its preview counts. */
export function withBudgets(definition: WorkflowDefinition, autos: ReturnType<typeof autoBudgetsOf>): WorkflowDefinition {
  return { ...definition, nodes: definition.nodes.map((node) => (node.type === 'ai' ? resolveNodeBudgets(node, autos.get(node.id)!) : node)) };
}

export const resolveBudgets = (db: Db, workflowId: string | null | undefined, definition: WorkflowDefinition) => withBudgets(definition, autoBudgetsOf(db, workflowId, definition));
