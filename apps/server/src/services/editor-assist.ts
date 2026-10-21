import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { editorAiSchema, editorNodeConfig, type AiNode } from '@tw/shared';
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
import { autoOf, modelLimitsOf, resolveNodeBudgets } from './budgets.ts';

export type AssistMode = 'translate' | 'refine';

/** Why 다듬기 changed something, by the order its preset checks. */
export const REFINE_KINDS = ['meaning', 'rule', 'language'] as const;
const KIND_LABELS: Record<string, string> = { meaning: '의미', rule: '규칙', language: '표현' };

/**
 * The editor's 'AI 번역' and '다듬기' for one line: the AI node their settings make (설정 › 에디터: one
 * model, context and time limit for both, each button's instructions from the AI 번역 / AI 다듬기 presets), the same
 * prompt and context as a workflow's AI node. The answer becomes an AI candidate of the line (with
 * 다듬기's "changes" as its note); the line's translation does not change. 다듬기 with nothing to fix
 * makes no candidate (`unchanged`).
 */
export async function assistLine(db: Db, secrets: SecretStore, unitId: string, request: { mode: AssistMode; draft: string }, signal?: AbortSignal, generate: typeof ai.generate = ai.generate) {
  const unit = db.select().from(s.units).where(eq(s.units.id, unitId)).get();
  if (!unit) throw new CompleteRefused('대사가 없습니다.', 400);
  const project = db.select().from(s.projects).where(eq(s.projects.id, unit.projectId)).get()!;
  const settings = editorAiSchema.parse(project.editorAi ?? {});
  const refine = request.mode === 'refine';
  const config = editorNodeConfig(settings, request.mode);
  if (!config.model.model) throw new CompleteRefused('설정 › 에디터에서 AI 번역·다듬기 모델을 고르세요.', 400);
  if (refine && !request.draft.trim()) throw new CompleteRefused('다듬을 번역이 없습니다.', 400);
  const { snapshot, routes } = liveChoice(db, config.model, secrets, 'generate');

  const node = { id: 'editor', type: 'ai', position: { x: 0, y: 0 }, config } as AiNode;
  // The context cap follows the button's model window (auto), like an AI node's.
  const context = buildContext(db, unit.projectId, [unit], resolveNodeBudgets(node, autoOf(node, modelLimitsOf(db, config.model))).config.context);
  const line = { id: promptLineId(0), unitId: unit.id, groupId: unit.groupId, key: unit.key, kind: unit.kind, speaker: unit.speaker, source: unit.source, candidate: node.config.include.candidate ? request.draft || unit.translation || undefined : undefined };
  const { system, prompt } = buildPrompt(node, { source: project.sourceLanguage, target: project.targetLanguage }, context, [line]);
  const label = `편집기 ${refine ? '다듬기' : 'AI 번역'}`;
  const call = { projectId: unit.projectId, kind: 'editor' as const, refId: unitId, label, request: `${system}\n\n---\n\n${prompt}` };
  const result = await ai
    .withFallback(routes, snapshot.maxAttempts, (route) => logged(db, call, route, () => generate(route, { system, prompt, schema: outputSchema(node, [promptLineId(0)]), maxOutputTokens: snapshot.maxOutputTokens, timeoutMs: settings.timeoutSeconds * 1000, signal })), signal)
    .catch((error: unknown) => {
      if (error instanceof ai.ModelError && error.code === 'rate-limit') throw new CompleteRefused('모델 요청 한도에 걸렸습니다. 잠시 뒤 다시.', 429, 60);
      throw error;
    });
  // A text answer or a json one with a "text" field (AI 다듬기's), its "changes" if it has them.
  const entry = (result.result.object as { results?: ({ id: string; text?: unknown; changes?: unknown } & Record<string, unknown>)[] }).results?.find((item) => item.id === promptLineId(0));
  const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
  if (!text) throw new CompleteRefused('모델이 번역을 돌려주지 않았습니다. 다시 해 보세요.', 400);
  // Whitespace alone is not a change worth a candidate.
  if (refine && text.replace(/\s+/g, ' ') === request.draft.trim().replace(/\s+/g, ' ')) return { unchanged: true as const };
  const changes = Array.isArray(entry?.changes) ? (entry.changes as { kind?: unknown; why?: unknown }[]) : [];
  const reasons = changes.flatMap((change) => (typeof change.why === 'string' && change.why.trim() ? [`${KIND_LABELS[String(change.kind)] ?? '표현'} · ${change.why.trim()}`] : []));
  const note = refine ? ['다듬기', ...reasons].join(' — ') : 'AI 번역';
  const candidateId = addCandidate(db, { unitId, text, origin: 'ai', model: result.route.model, note });
  events.changed(unit.projectId, 'units');
  return { candidateId, text, reasons };
}
