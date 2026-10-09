import { and, asc, eq } from 'drizzle-orm';
import { contextConfigSchema, estimateTokens, nodeName, type AiNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildPrompt } from '../engine/prompts.ts';
import { buildContext } from './context.ts';

/**
 * What an AI node would send for a line, built exactly as a run builds it but without calling a
 * model. The batch is the one the runner forms inside the line's scene; a run's scope and entry
 * statuses can make it smaller, and "count" batches can cross scenes.
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
  const picked = choices.find((choice) => (!pick.workflowId || choice.workflowId === pick.workflowId) && choice.nodeId === pick.nodeId) ?? choices.find((choice) => choice.output === 'candidate') ?? choices[0];
  const list = choices.map(({ node: _node, ...choice }) => choice);
  if (!picked) return { unitKey, choices: list, picked: null };
  const node = picked.node;

  const { mode, size } = node.config.batch;
  let batch = [unit];
  if (mode !== 'unit') {
    const scene = db.select().from(s.units).where(eq(s.units.groupId, unit.groupId)).orderBy(asc(s.units.sort)).all();
    const at = scene.findIndex((row) => row.id === unit.id);
    batch = scene.slice(Math.floor(at / size) * size, Math.floor(at / size) * size + size);
  }
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  const profile = node.config.profileId ? db.select().from(s.profiles).where(eq(s.profiles.id, node.config.profileId)).get() : undefined;
  const context = buildContext(db, projectId, batch, node.config.context);
  const lines = batch.map((row, index) => ({ id: String(index + 1), unitId: row.id, key: row.key, speaker: row.speaker, source: row.source, candidate: row.translation ?? undefined }));
  const { system, prompt } = buildPrompt(node, profile?.instructions ?? '', { source: project.sourceLanguage, target: project.targetLanguage }, context, lines);
  return {
    unitKey,
    choices: list,
    picked: { workflowId: picked.workflowId, nodeId: picked.nodeId },
    batch: { mode, size, keys: batch.map((row) => row.key) },
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
