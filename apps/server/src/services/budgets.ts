import { eq, inArray } from 'drizzle-orm';
import { autoBudgets, batchConfigSchema, contextConfigSchema, type AiNode, type ModelChoice, type ModelLimits, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** What the chosen model takes and gives (its connection's stored limits), or undefined when unknown. */
export function modelLimitsOf(db: Db, choice: ModelChoice | undefined): ModelLimits | undefined {
  if (!choice?.connectionId || !choice.model) return undefined;
  return db.select({ limits: s.connections.modelLimits }).from(s.connections).where(eq(s.connections.id, choice.connectionId)).get()?.limits[choice.model];
}

/** An AI node with its "auto" budgets (null) filled from its model's limits; numbers a person set stay. */
export function resolveNodeBudgets(node: AiNode, limits: ModelLimits | undefined): AiNode {
  const batch = batchConfigSchema.parse(node.config.batch ?? {});
  const context = contextConfigSchema.parse(node.config.context ?? {});
  if (batch.maxTokens !== null && context.maxTokens !== null) return node;
  const auto = autoBudgets(limits, node.config.output, batch.mode);
  return { ...node, config: { ...node.config, batch: { ...batch, maxTokens: batch.maxTokens ?? auto.lines }, context: { ...context, maxTokens: context.maxTokens ?? auto.context } } };
}

/**
 * A definition with every AI node's "auto" budgets filled for the models it will call (run models
 * already applied): what a run stores and plans with, and what its preview counts.
 */
export function resolveBudgets(db: Db, definition: WorkflowDefinition): WorkflowDefinition {
  const ai = definition.nodes.filter((node): node is AiNode => node.type === 'ai');
  if (!ai.length) return definition;
  const ids = [...new Set(ai.map((node) => node.config.model.connectionId).filter(Boolean))];
  const limits = new Map(ids.length ? db.select({ id: s.connections.id, limits: s.connections.modelLimits }).from(s.connections).where(inArray(s.connections.id, ids)).all().map((row) => [row.id, row.limits]) : []);
  return { ...definition, nodes: definition.nodes.map((node) => (node.type === 'ai' ? resolveNodeBudgets(node, limits.get(node.config.model.connectionId)?.[node.config.model.model]) : node)) };
}
