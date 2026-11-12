import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { AiNode, WorkflowSubject } from '@tw/shared';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { resolveChoiceOptions } from '../services/choice-options.ts';
import { buildContext, runPairLines, type BatchContext } from '../services/context.ts';
import { buildPrompt, isBatchScope, outputSchema, promptLineId, type PromptLine } from './prompts.ts';
import { TERM_GROUP } from './subjects.ts';
import { wholeScriptRequest } from './whole-script.ts';

type Unit = typeof s.units.$inferSelect;

/**
 * One subject of a request: a line or a term by id, with what a run has for it so far. A preview knows
 * only the id: the request then shows what is stored (the line's translation, the term's Korean form).
 */
export interface RequestItem {
  id: string;
  /** The run's working text for it (ItemData.candidateText). */
  candidate?: string;
  /** What the last failing check or verdict found (ItemData.issues). */
  issues?: string[];
  /** The previous step's result for it (input.previous, trimmed to input.fields), when the node reads one. */
  previous?: unknown;
}

/** One model request of an AI node. */
export interface BuiltRequest {
  system: string;
  prompt: string;
  /** The structured answer the request asks for. */
  schema: z.ZodType<unknown>;
  /** What went into the prompt besides the items, why, and what was dropped for the cap. */
  context: BatchContext;
  /** The items as the prompt numbers them, in request order: an answer is read back against these (readAiOutput). */
  lines: PromptLine[];
  /** A choice node's options as resolved for this request. */
  choiceOptions?: string[];
  /** Sent as script text (batch mode "whole") instead of the per-line prompt. */
  whole: boolean;
}

/** Whether a node's request reads an earlier node's result: it exists only inside a run, so nothing outside one can show the request. */
export const readsPrevious = (node: AiNode) => node.config.input.previous;

/**
 * The one request an AI node makes of `items` (lines or terms, in request order): prompt, answer schema
 * and context. Everything that sends or shows a node's request builds it here — a run, the run estimate,
 * the previews, the editor's AI buttons — so they cannot differ. `node` has its budgets fixed (a run's
 * stored node, or resolvedNode). `runId`: the run the request belongs to; a request that reads earlier
 * results counts its 대화 쌍 over that run's lines.
 */
export function buildRequest(db: Db, projectId: string, node: AiNode, subject: WorkflowSubject, items: RequestItem[], runId?: string): BuiltRequest {
  const project = db.select({ source: s.projects.sourceLanguage, target: s.projects.targetLanguage }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
  const languages = { source: project.source, target: project.target };
  const choiceOptions = node.config.output === 'choice' ? resolveChoiceOptions(db, projectId, node.config.choice) : undefined;
  // A per-line answer names the ids it must cover; one answer for the whole request does not.
  const schemaFor = (lines?: PromptLine[]) => outputSchema(node, lines && !isBatchScope(node) ? lines.map((line) => line.id) : undefined, choiceOptions);

  if (subject === 'terms') {
    const { lines, context } = termLines(db, projectId, node, items);
    return { ...buildPrompt(node, languages, context, lines, choiceOptions), schema: schemaFor(lines), context, lines, choiceOptions, whole: false };
  }

  const { rows, lines } = unitLines(db, items);
  // A node reading the script whole sends it as compact script text (whole-script.ts), its lines
  // numbered L1… over the whole request; every other node gets the batch prompt with the context it asks for.
  if (node.config.batch.mode === 'whole') {
    const whole = wholeScriptRequest(db, projectId, node, languages, rows, choiceOptions);
    for (const line of lines) line.id = whole.idOf.get(line.key) ?? line.id;
    return { system: whole.system, prompt: whole.prompt, schema: schemaFor(), context: whole.context, lines, choiceOptions, whole: true };
  }
  // A request that reads earlier results instead of lines (a merge) asks about the people those results name.
  const parts = !node.config.input.lines && node.config.input.previous ? JSON.stringify(lines.flatMap((line) => (line.previous === undefined ? [] : [line.previous]))) : undefined;
  const context = buildContext(db, projectId, rows, node.config.context, parts, parts !== undefined && node.config.context.pairs && runId ? runPairLines(db, runId) : undefined);
  return { ...buildPrompt(node, languages, context, lines, choiceOptions), schema: schemaFor(lines), context, lines, choiceOptions, whole: false };
}

/** Lines as a request numbers them ("L1"…), in the order given, with their rows (what the context is chosen from). */
function unitLines(db: Db, items: RequestItem[]): { rows: Unit[]; lines: PromptLine[] } {
  const units = new Map(inChunks(items.map((item) => item.id), (ids) => db.select().from(s.units).where(inArray(s.units.id, ids)).all()).map((unit) => [unit.id, unit]));
  const rows = items.map((item) => {
    const unit = units.get(item.id);
    if (!unit) throw new Error('요청에 넣을 대사를 찾을 수 없습니다 (지워졌을 수 있습니다).');
    return unit;
  });
  const lines = items.map((item, index): PromptLine => {
    const unit = rows[index]!;
    return {
      id: promptLineId(index),
      unitId: unit.id,
      groupId: unit.groupId,
      key: unit.key,
      kind: unit.kind,
      speaker: unit.speaker,
      source: unit.source,
      candidate: item.candidate ?? unit.translation ?? undefined,
      issues: item.issues,
      ...(item.previous !== undefined && { previous: item.previous }),
    };
  });
  return { rows, lines };
}

/**
 * Terms as a request shows them ("T1"…): the term, its current Korean form and note, how many lines use
 * it, and up to `context.examples` of those lines with their translations. The request's context
 * (glossary, characters, documents…) is chosen from the terms themselves and from those example lines.
 */
function termLines(db: Db, projectId: string, node: AiNode, items: RequestItem[]): { lines: PromptLine[]; context: BatchContext } {
  const terms = new Map(inChunks(items.map((item) => item.id), (ids) => db.select().from(s.terms).where(inArray(s.terms.id, ids)).all()).map((term) => [term.id, term]));
  const count = node.config.context.examples;
  const keys = [...new Set(items.flatMap((item) => terms.get(item.id)?.examples.slice(0, count) ?? []))];
  const units = new Map(inChunks(keys, (chunk) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, chunk))).all()).map((unit) => [unit.key, unit]));
  // One prompt item per request item, in order: the answer is read back by position.
  const lines = items.map((item, index): PromptLine => {
    const term = terms.get(item.id);
    const previous = item.previous !== undefined && { previous: item.previous };
    if (!term) return { id: promptLineId(index, 'T'), unitId: item.id, groupId: TERM_GROUP, key: item.id, kind: 'term', speaker: null, source: '', term: { examples: [] }, ...previous };
    const examples = term.examples.slice(0, count).flatMap((key) => {
      const unit = units.get(key);
      return unit ? [{ speaker: unit.speaker ?? undefined, source: unit.source, translation: unit.translation ?? undefined }] : [];
    });
    return {
      id: promptLineId(index, 'T'),
      unitId: term.id,
      groupId: TERM_GROUP,
      key: term.source,
      kind: 'term',
      speaker: null,
      source: term.source,
      candidate: item.candidate ?? (term.target || undefined),
      issues: item.issues,
      term: { target: term.target || undefined, note: term.note || undefined, uses: term.lines ?? undefined, examples },
      ...previous,
    };
  });
  // The context is chosen from the terms themselves (a confirmed "Brin" goes with "Brin Guild") and
  // from their example lines, so 확정 용어 works without examples too.
  const own = items.flatMap((item) => {
    const term = terms.get(item.id);
    return term ? [{ id: `term:${term.id}`, key: `term:${term.id}`, groupId: TERM_GROUP, sort: 0, speaker: null, source: term.source }] : [];
  });
  const context = buildContext(db, projectId, [...own, ...units.values()], { ...node.config.context, precedingLines: 0, previousScenes: 0, speech: false });
  // A term being translated is not its own context.
  const asked = new Set(own.map((row) => row.source.toLowerCase()));
  context.terms = context.terms.filter((term) => !asked.has(term.source.toLowerCase()));
  context.items = context.items.filter((item) => item.kind !== 'term' || !asked.has(item.label.split(' → ')[0]!.toLowerCase()));
  return { lines, context };
}
