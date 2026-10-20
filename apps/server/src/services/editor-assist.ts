import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { AI_PRESETS, aiNodeConfigSchema, CALL_TIMEOUT_MS, editorAiSchema, type AiNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildPrompt, outputSchema, promptLineId } from '../engine/prompts.ts';
import { events } from '../events.ts';
import { logged } from './ai-calls.ts';
import { buildContext } from './context.ts';
import { CompleteRefused } from './editor-complete.ts';
import { liveChoice } from './routes.ts';
import type { SecretStore } from './secrets.ts';
import { addCandidate } from './candidates.ts';
import { modelLimitsOf, resolveNodeBudgets } from './budgets.ts';

export type AssistMode = 'translate' | 'refine';

/**
 * 다듬기: the draft is the translator's own work, so only what has a reason
 * changes — meaning, then the project's rules, then the target language — and each change says why.
 * Nothing to fix is an answer too: the draft comes back as it is and no candidate is made.
 */
const REFINE = [
  'The candidate translation ("candidate") is the translator\'s own draft. Keep their wording, word choice and style; change only what one of these requires, checked in this order:',
  '1. meaning: something of the source is missing, added or mistranslated (negation, numbers, who does what);',
  '2. rule: a confirmed glossary term, the speech level and address the speech rules give for this speaker and listener, a placeholder or rich-text tag of the source that is missing, extra or misplaced, a particle after a variable;',
  '3. language: translationese, an unnatural particle or word order, spacing or spelling in the target language.',
  'Do not rephrase what is already correct. If nothing needs fixing, return the candidate exactly as it is with no changes.',
  'For every change add an entry to "changes": its kind (meaning, rule or language) and why, one short Korean phrase naming what changed (e.g. "용어: 펜 항구 → 쿠헤스마", "말투: 상관에게 존댓말").',
  'Keep every placeholder, rich-text tag and line break the source has.',
].join('\n');

/** Why 다듬기 changed something, by the order it checks. */
export const REFINE_KINDS = ['meaning', 'rule', 'language'] as const;
const refineSchema = z.object({
  results: z
    .array(z.object({ id: z.string(), text: z.string(), changes: z.array(z.object({ kind: z.enum(REFINE_KINDS), why: z.string() })).default([]) }))
    .describe(`Exactly 1 entry, for line id ${promptLineId(0)}.`),
});
const KIND_LABELS: Record<(typeof REFINE_KINDS)[number], string> = { meaning: '의미', rule: '규칙', language: '표현' };

/**
 * The editor's 'AI 번역' and '다듬기' for one line: the same prompt and
 * context as a workflow's AI node (speech rule, glossary, preceding lines, voices), sent to the
 * model picked in AI › 사용 방식 (a CLI too). The answer becomes an AI candidate of the line (its
 * note says what 다듬기 changed and why); the line's translation does not change. 다듬기 with
 * nothing to fix makes no candidate (`unchanged`).
 */
export async function assistLine(db: Db, secrets: SecretStore, unitId: string, request: { mode: AssistMode; draft: string }, signal?: AbortSignal, generate: typeof ai.generate = ai.generate) {
  const unit = db.select().from(s.units).where(eq(s.units.id, unitId)).get();
  if (!unit) throw new CompleteRefused('대사가 없습니다.', 400);
  const project = db.select().from(s.projects).where(eq(s.projects.id, unit.projectId)).get()!;
  const settings = editorAiSchema.parse(project.editorAi ?? {});
  if (!settings.assistModel) throw new CompleteRefused('AI › 사용 방식에서 편집기 AI 번역 모델을 고르세요.', 400);
  if (request.mode === 'refine' && !request.draft.trim()) throw new CompleteRefused('다듬을 번역이 없습니다.', 400);
  const { snapshot, routes } = liveChoice(db, settings.assistModel, secrets, 'generate');

  const refine = request.mode === 'refine';
  const node = {
    id: 'editor',
    type: 'ai',
    position: { x: 0, y: 0 },
    config: aiNodeConfigSchema.parse({
      instructions: refine ? REFINE : AI_PRESETS.translate.instructions,
      output: 'text',
      include: { candidate: refine, issues: false },
    }),
  } as AiNode;
  // The context cap follows the assist model's window (auto), like an AI node's.
  const context = buildContext(db, unit.projectId, [unit], resolveNodeBudgets(node, modelLimitsOf(db, settings.assistModel)).config.context);
  const line = { id: promptLineId(0), unitId: unit.id, groupId: unit.groupId, key: unit.key, kind: unit.kind, speaker: unit.speaker, source: unit.source, candidate: refine ? request.draft : undefined };
  const { system, prompt } = buildPrompt(node, { source: project.sourceLanguage, target: project.targetLanguage }, context, [line]);
  const label = `편집기 ${refine ? '다듬기' : 'AI 번역'}`;
  const call = { projectId: unit.projectId, kind: 'editor' as const, refId: unitId, label, request: `${system}\n\n---\n\n${prompt}` };
  const result = await ai
    .withFallback(routes, snapshot.maxAttempts, (route) => logged(db, call, route, () => generate(route, { system, prompt, schema: refine ? refineSchema : outputSchema(node, [promptLineId(0)]), maxOutputTokens: snapshot.maxOutputTokens, timeoutMs: CALL_TIMEOUT_MS.assist, signal })), signal)
    .catch((error: unknown) => {
      if (error instanceof ai.ModelError && error.code === 'rate-limit') throw new CompleteRefused('모델 요청 한도에 걸렸습니다. 잠시 뒤 다시.', 429, 60);
      throw error;
    });
  const entry = (result.result.object as { results?: { id: string; text: string; changes?: { kind: (typeof REFINE_KINDS)[number]; why: string }[] }[] }).results?.find((item) => item.id === promptLineId(0));
  const text = entry?.text?.trim();
  if (!text) throw new CompleteRefused('모델이 번역을 돌려주지 않았습니다. 다시 해 보세요.', 400);
  // Whitespace alone is not a change worth a candidate.
  if (refine && text.replace(/\s+/g, ' ') === request.draft.trim().replace(/\s+/g, ' ')) return { unchanged: true as const };
  const reasons = (entry?.changes ?? []).map((change) => `${KIND_LABELS[change.kind]} · ${change.why.trim()}`).filter((reason) => !reason.endsWith('· '));
  const note = refine ? ['다듬기', ...reasons].join(' — ') : 'AI 번역';
  const candidateId = addCandidate(db, { unitId, text, origin: 'ai', model: result.route.model, note });
  events.changed(unit.projectId, 'units');
  return { candidateId, text, reasons };
}
