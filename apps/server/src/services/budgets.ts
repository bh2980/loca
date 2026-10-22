import { eq, inArray } from 'drizzle-orm';
import { autoBudgets, batchConfigSchema, contextConfigSchema, limitsFor, type AiNode, type ModelChoice, type ModelLimits, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

const connectionLimits = { modelLimits: s.connections.modelLimits };

/** What the chosen model's calls may take and give (limitsFor), or undefined when unknown. */
export function modelLimitsOf(db: Db, choice: ModelChoice | undefined): ModelLimits | undefined {
  if (!choice?.connectionId || !choice.model) return undefined;
  return limitsFor(db.select(connectionLimits).from(s.connections).where(eq(s.connections.id, choice.connectionId)).get(), choice.model);
}

/** What sizing reads of an AI node: enough to size one that is only being edited. */
export type SizedNode = Pick<AiNode, 'id'> & { config: Pick<AiNode['config'], 'model' | 'output'> & { batch?: unknown } };

/** The "auto" budgets of an AI node from its model's limits. */
export function autoOf(node: SizedNode, limits: ModelLimits | undefined) {
  const batch = batchConfigSchema.parse(node.config.batch ?? {});
  return autoBudgets(limits, node.config.output, batch.mode);
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
 * id.
 */
export function autoBudgetsOf(db: Db, definition: WorkflowDefinition) {
  const ai = definition.nodes.filter((node): node is AiNode => node.type === 'ai');
  const ids = [...new Set(ai.map((node) => node.config.model.connectionId).filter(Boolean))];
  const connections = new Map(ids.length ? db.select({ id: s.connections.id, ...connectionLimits }).from(s.connections).where(inArray(s.connections.id, ids)).all().map((row) => [row.id, row]) : []);
  return new Map(ai.map((node) => [node.id, autoOf(node, limitsFor(connections.get(node.config.model.connectionId), node.config.model.model))] as const));
}

/** A definition with every AI node's "auto" budgets filled from `autos` (autoBudgetsOf): what a run stores and plans with, and what its preview counts. */
export function withBudgets(definition: WorkflowDefinition, autos: ReturnType<typeof autoBudgetsOf>): WorkflowDefinition {
  return { ...definition, nodes: definition.nodes.map((node) => (node.type === 'ai' ? resolveNodeBudgets(node, autos.get(node.id)!) : node)) };
}

export const resolveBudgets = (db: Db, definition: WorkflowDefinition) => withBudgets(definition, autoBudgetsOf(db, definition));
