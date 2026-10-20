import { and, asc, eq, inArray } from 'drizzle-orm';
import { batchConfigSchema, estimateTokens, workflowInput, type AiNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildPrompt } from '../engine/prompts.ts';
import { selectRunTerms } from '../engine/run-create.ts';
import { termPrompt } from '../engine/subjects.ts';
import { modelLimitsOf, resolveNodeBudgets } from './budgets.ts';
import { previewContext } from './context-preview.ts';

/** Items of the request listed before "외 N개". */
const SHOWN = 5;

/**
 * 보낼 내용: one request of a saved AI node, built as a run builds it but without calling a model —
 * the request that holds `sample` (a line key, or a term id), else the first. The editor shows its
 * size, instructions, answer form, context by kind and its first items; the full text is there too.
 */
export function previewRequest(db: Db, workflow: typeof s.workflows.$inferSelect, nodeId: string, sample?: string) {
  const node = workflow.definition.nodes.find((candidate): candidate is AiNode => candidate.id === nodeId && candidate.type === 'ai');
  if (!node) return null;
  const subject = workflowInput(workflow.definition);
  const projectId = workflow.projectId;
  const base = { subject, instructions: node.config.instructions, output: node.config.output, fields: node.config.fields };

  if (subject === 'lines') {
    const key = sample ?? db.select({ key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.groupId), asc(s.units.seq)).limit(1).get()?.key;
    const preview = key ? previewContext(db, projectId, key, { workflowId: workflow.id, nodeId }) : null;
    if (!preview?.picked) return { ...base, sample: null, total: 0, items: [], context: [], system: '', prompt: '', promptTokens: 0 };
    const shown = preview.batch.keys.slice(0, SHOWN);
    const rows = new Map(db.select({ key: s.units.key, speaker: s.units.speaker, source: s.units.source }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, shown))).all().map((row) => [row.key, row]));
    return {
      ...base,
      sample: { value: key!, label: key! },
      total: preview.batch.keys.length,
      items: shown.map((itemKey) => ({ label: itemKey, text: `${rows.get(itemKey)?.speaker ? `${rows.get(itemKey)!.speaker}: ` : ''}${rows.get(itemKey)?.source ?? ''}` })),
      context: preview.items,
      system: preview.system,
      prompt: preview.prompt,
      promptTokens: preview.promptTokens,
    };
  }

  // Terms: the batch the run forms from every term (most used first) that holds the sample.
  const ids = selectRunTerms(db, projectId, {});
  const config = batchConfigSchema.parse(node.config.batch ?? {});
  const size = config.mode === 'unit' ? 1 : Math.max(1, config.size ?? 1);
  const at = Math.max(0, sample ? ids.indexOf(sample) : 0);
  const batchIds = ids.slice(Math.floor(at / size) * size, Math.floor(at / size) * size + size);
  if (!batchIds.length) return { ...base, sample: null, total: 0, items: [], context: [], system: '', prompt: '', promptTokens: 0 };
  const resolved = resolveNodeBudgets(node, modelLimitsOf(db, node.config.model));
  const { lines, context } = termPrompt(db, projectId, batchIds.map((id) => ({ subjectId: id, data: {} })) as never, resolved);
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  const { system, prompt } = buildPrompt(resolved, { source: project.sourceLanguage, target: project.targetLanguage }, context, lines);
  const terms = new Map(db.select({ id: s.terms.id, source: s.terms.source, target: s.terms.target }).from(s.terms).where(inArray(s.terms.id, batchIds)).all().map((row) => [row.id, row]));
  const first = terms.get(batchIds[0]!);
  return {
    ...base,
    sample: { value: sample && ids.includes(sample) ? sample : batchIds[0]!, label: (sample && terms.get(sample)?.source) || first?.source || '' },
    total: batchIds.length,
    items: batchIds.slice(0, SHOWN).map((id) => ({ label: terms.get(id)?.source ?? id, text: terms.get(id)?.target || '—' })),
    context: context.items,
    system,
    prompt,
    promptTokens: estimateTokens(`${system}\n\n${prompt}`),
  };
}
