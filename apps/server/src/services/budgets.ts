import { eq, inArray } from 'drizzle-orm';
import { autoBudgets, batchConfigSchema, contextConfigSchema, type AiNode, type ModelChoice, type ModelLimits, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/**
 * What a call through this connection may take in and give out: the connection's own 입력·출력 토큰
 * when a person set them, else what the model list said about the chosen model; undefined when neither is known.
 */
export function limitsFor(connection: { inputTokens: number | null; outputTokens: number | null; modelLimits: Record<string, ModelLimits> } | undefined, model: string): ModelLimits | undefined {
  if (!connection) return undefined;
  const listed = connection.modelLimits[model];
  const contextWindow = connection.inputTokens ?? listed?.contextWindow;
  const maxOutput = connection.outputTokens ?? listed?.maxOutput;
  return contextWindow || maxOutput ? { contextWindow, maxOutput, by: connection.inputTokens || connection.outputTokens ? 'human' : 'api' } : undefined;
}

const connectionLimits = { inputTokens: s.connections.inputTokens, outputTokens: s.connections.outputTokens, modelLimits: s.connections.modelLimits };

/** What the chosen model's calls may take and give (limitsFor), or undefined when unknown. */
export function modelLimitsOf(db: Db, choice: ModelChoice | undefined): ModelLimits | undefined {
  if (!choice?.connectionId || !choice.model) return undefined;
  return limitsFor(db.select(connectionLimits).from(s.connections).where(eq(s.connections.id, choice.connectionId)).get(), choice.model);
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
  const connections = new Map(ids.length ? db.select({ id: s.connections.id, ...connectionLimits }).from(s.connections).where(inArray(s.connections.id, ids)).all().map((row) => [row.id, row]) : []);
  return { ...definition, nodes: definition.nodes.map((node) => (node.type === 'ai' ? resolveNodeBudgets(node, limitsFor(connections.get(node.config.model.connectionId), node.config.model.model)) : node)) };
}
