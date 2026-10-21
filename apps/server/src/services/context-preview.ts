import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { batchConfigSchema, contextConfigSchema, estimateTokens, nodeName, type AiNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { planBatches } from '../engine/batches.ts';
import { buildPrompt, promptLineId } from '../engine/prompts.ts';
import { wholeScriptRequest } from '../engine/whole-script.ts';
import { resolveChoiceOptions } from './choice-options.ts';
import { buildContext } from './context.ts';
import { autoOf, modelLimitsOf, resolveNodeBudgets } from './budgets.ts';

/**
 * What an AI node would send for a line, built exactly as a run builds it but without calling a
 * model. The batch is the one the runner forms when the whole script is in scope; a run's scope,
 * entry statuses and the lines still waiting at the node change which lines share it.
 */
export function previewContext(db: Db, projectId: string, unitKey: string, pick: { workflowId?: string; nodeId?: string }) {
  const unit = db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, unitKey))).get();
  if (!unit) return null;
  const workflows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).orderBy(asc(s.workflows.name)).all();
  const choices = workflows.flatMap((workflow) =>
    workflow.definition.nodes
      .filter((node): node is AiNode => node.type === 'ai')
      .map((node) => ({ workflowId: workflow.id, workflowName: workflow.name, nodeId: node.id, nodeName: nodeName(node), output: node.config.output, node })),
  );
  const picked = choices.find((choice) => (!pick.workflowId || choice.workflowId === pick.workflowId) && choice.nodeId === pick.nodeId) ?? choices.find((choice) => choice.output === 'text') ?? choices[0];
  const list = choices.map(({ node: _node, ...choice }) => choice);
  if (!picked) return { unitKey, choices: list, picked: null };
  // Its "auto" budgets as a run with its own model would fix them.
  const node = resolveNodeBudgets(picked.node, autoOf(db, picked.workflowId, picked.node, modelLimitsOf(db, picked.node.config.model)));

  // The batch the runner would form when the whole script is in scope (same planning rule).
  const config = batchConfigSchema.parse(node.config.batch ?? {});
  const all = db
    .select({ id: s.units.id, groupId: s.units.groupId, seq: s.units.seq, kind: s.units.kind, speaker: s.units.speaker, tokens: sql<number>`(length(cast(${s.units.source} as blob)) + 3) / 4` })
    .from(s.units)
    .where(eq(s.units.projectId, projectId))
    .all();
  const ids = planBatches(all, config).find((batch) => batch.some((row) => row.id === unit.id))?.map((row) => row.id) ?? [unit.id];
  const rows = new Map(db.select().from(s.units).where(inArray(s.units.id, ids)).all().map((row) => [row.id, row]));
  const batch = ids.map((id) => rows.get(id)!);
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  const languages = { source: project.sourceLanguage, target: project.targetLanguage };
  const choiceOptions = node.config.output === 'choice' ? resolveChoiceOptions(db, projectId, node.config.choice) : undefined;
  // A node reading the script whole sends the script text with the project-wide context only.
  const whole = config.mode === 'whole' ? wholeScriptRequest(db, projectId, node, languages, batch, choiceOptions) : null;
  const context = whole?.context ?? buildContext(db, projectId, batch, node.config.context);
  const lines = batch.map((row, index) => ({ id: promptLineId(index), unitId: row.id, groupId: row.groupId, key: row.key, kind: row.kind, speaker: row.speaker, source: row.source, candidate: row.translation ?? undefined }));
  const { system, prompt } = whole ?? buildPrompt(node, languages, context, lines, choiceOptions);
  return {
    unitKey,
    choices: list,
    picked: { workflowId: picked.workflowId, nodeId: picked.nodeId },
    batch: { mode: config.mode, size: config.size, keys: batch.map((row) => row.key) },
    precedingLines: contextConfigSchema.parse(node.config.context ?? {}).precedingLines,
    /** This line's own preceding lines; empty when the lines before it are in the batch or shown for an earlier line. */
    preceding: context.preceding[unit.id] ?? null,
    items: context.items,
    budget: context.budget,
    system,
    prompt,
    promptTokens: estimateTokens(`${system}\n\n${prompt}`),
  };
}
