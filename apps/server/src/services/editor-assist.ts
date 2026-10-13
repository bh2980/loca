import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { AI_PRESETS, aiNodeConfigSchema, editorAiSchema, type AiNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildPrompt, outputSchema } from '../engine/prompts.ts';
import { events } from '../events.ts';
import { logged } from './ai-calls.ts';
import { buildContext } from './context.ts';
import { CompleteRefused, editorCallsToday } from './editor-complete.ts';
import { liveChoice } from './routes.ts';
import type { SecretStore } from './secrets.ts';

export type AssistMode = 'translate' | 'refine';

const REFINE =
  'Revise the candidate translation ("candidate") as the translator asks, keeping what the request does not touch. ' +
  'With no request, make it read naturally in the target language without changing its meaning. Keep every placeholder, rich-text tag and line break exactly.';

/**
 * The editor's 'AI 번역' and '다듬기' for one line (docs/DESIGN.md J3b C): the same prompt and
 * context as a workflow's AI node (speech rule, glossary, preceding lines, voices), sent to the
 * model picked in AI › 사용 방식 (a CLI too), with the translator's instruction added. The answer
 * becomes an AI candidate of the line; the line's translation does not change.
 */
export async function assistLine(db: Db, secrets: SecretStore, unitId: string, request: { mode: AssistMode; draft: string; instruction: string }, signal?: AbortSignal, generate: typeof ai.generate = ai.generate) {
  const unit = db.select().from(s.units).where(eq(s.units.id, unitId)).get();
  if (!unit) throw new CompleteRefused('대사가 없습니다.', 400);
  const project = db.select().from(s.projects).where(eq(s.projects.id, unit.projectId)).get()!;
  const settings = editorAiSchema.parse(project.editorAi ?? {});
  if (!settings.assistModel) throw new CompleteRefused('AI › 사용 방식에서 편집기 AI 번역 모델을 고르세요.', 400);
  if (request.mode === 'refine' && !request.draft.trim()) throw new CompleteRefused('다듬을 번역이 없습니다.', 400);
  if (editorCallsToday(db, unit.projectId) >= settings.dailyCap) {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    throw new CompleteRefused(`오늘 편집기 AI 한도(${settings.dailyCap}회)를 다 썼습니다.`, 429, Math.ceil((midnight.getTime() - Date.now()) / 1000));
  }
  const { snapshot, routes } = liveChoice(db, settings.assistModel, secrets, 'generate');

  const instruction = request.instruction.trim();
  const base = request.mode === 'translate' ? AI_PRESETS.translate.instructions : REFINE;
  const node = {
    id: 'editor',
    type: 'ai',
    position: { x: 0, y: 0 },
    config: aiNodeConfigSchema.parse({
      instructions: instruction ? `${base}\n\nThe translator's request for this line (follow it): ${instruction}` : base,
      output: 'candidate',
      include: { candidate: request.mode === 'refine', issues: false },
    }),
  } as AiNode;
  const context = buildContext(db, unit.projectId, [unit], node.config.context);
  const line = { id: '1', unitId: unit.id, groupId: unit.groupId, key: unit.key, speaker: unit.speaker, source: unit.source, candidate: request.mode === 'refine' ? request.draft : undefined };
  const { system, prompt } = buildPrompt(node, { source: project.sourceLanguage, target: project.targetLanguage }, context, [line]);
  const label = `편집기 ${request.mode === 'translate' ? 'AI 번역' : '다듬기'}`;
  const call = { projectId: unit.projectId, kind: 'editor' as const, refId: unitId, label, request: `${system}\n\n---\n\n${prompt}` };
  const result = await ai
    .withFallback(routes, snapshot.maxAttempts, (route) => logged(db, call, route, () => generate(route, { system, prompt, schema: outputSchema(node, ['1']), maxOutputTokens: snapshot.maxOutputTokens, timeoutMs: snapshot.timeoutSeconds * 1000, signal })), signal)
    .catch((error: unknown) => {
      if (error instanceof ai.ModelError && error.code === 'rate-limit') throw new CompleteRefused('모델 요청 한도에 걸렸습니다. 잠시 뒤 다시.', 429, 60);
      throw error;
    });
  const text = (result.result.object as { translations?: { id: string; text: string }[] }).translations?.find((entry) => entry.id === '1')?.text?.trim();
  if (!text) throw new CompleteRefused('모델이 번역을 돌려주지 않았습니다. 다시 해 보세요.', 400);
  const note = [request.mode === 'refine' ? '다듬기' : 'AI 번역', instruction].filter(Boolean).join(': ');
  const candidate = db.insert(s.candidates).values({ unitId, text, origin: 'ai', model: result.route.model, note }).returning().get();
  events.changed(unit.projectId, 'units');
  return { candidateId: candidate.id, text, callsToday: editorCallsToday(db, unit.projectId), dailyCap: settings.dailyCap };
}
