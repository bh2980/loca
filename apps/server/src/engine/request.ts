import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AiNode, Subject } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { resolveChoiceOptions } from '../services/choice-options.ts';
import { isBatchScope, outputSchema } from './prompts.ts';
import { subjectOf, type RequestItem, type RequestParts } from './subjects.ts';

export type { RequestItem };

/** One model request of an AI node: the subject's prompt for its items (RequestParts), with the answer it asks for. */
export interface BuiltRequest extends RequestParts {
  /** The structured answer the request asks for. */
  schema: z.ZodType<unknown>;
  /** A choice node's options as resolved for this request. */
  choiceOptions?: string[];
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
export function buildRequest(db: Db, projectId: string, node: AiNode, subject: Subject, items: RequestItem[], runId?: string): BuiltRequest {
  const project = db.select({ source: s.projects.sourceLanguage, target: s.projects.targetLanguage }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
  const languages = { source: project.source, target: project.target };
  const choiceOptions = node.config.output === 'choice' ? resolveChoiceOptions(db, projectId, node.config.choice) : undefined;
  const parts = subjectOf(subject).request(db, projectId, node, languages, items, choiceOptions, runId);
  // A per-item answer names the ids it must cover; one answer for the whole request (a batch scope, a whole-script read) does not.
  const schema = outputSchema(node, parts.whole || isBatchScope(node) ? undefined : parts.lines.map((line) => line.id), choiceOptions);
  return { ...parts, schema, choiceOptions };
}
