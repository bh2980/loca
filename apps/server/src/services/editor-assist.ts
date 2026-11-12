import { eq } from 'drizzle-orm';
import * as ai from '@loca/ai';
import { editorAiSchema, editorNodeConfig } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { promptLineId } from '../engine/prompts.ts';
import { buildRequest } from '../engine/request.ts';
import { logged } from '../domain/ai-calls.ts';
import { limited } from './editor-complete.ts';
import { badRequest } from '../refusal.ts';
import { liveChoice } from '../domain/model-target.ts';
import type { SecretStore } from '../domain/secrets.ts';
import { addCandidate } from '../domain/candidates.ts';
import { resolvedNode } from '../engine/node-budgets.ts';

export type AssistMode = 'translate' | 'refine';

const KIND_LABELS: Record<string, string> = { meaning: '의미', rule: '규칙', language: '표현' };

/**
 * The editor's 'AI 번역' and '다듬기' for one line: the AI node their settings make (설정 › 에디터: one
 * model, context and time limit for both, each button's instructions from the AI 번역 / AI 다듬기 presets), the same
 * prompt and context as a workflow's AI node. The answer becomes an AI candidate of the line (with
 * 다듬기's "changes" as its note), or with `suggest` the line's waiting AI 제안; the line's translation does not change. 다듬기 with nothing to fix
 * makes no candidate (`unchanged`).
 */
export async function assistLine(db: Db, secrets: SecretStore, unitId: string, request: { mode: AssistMode; draft: string; suggest?: boolean }, signal?: AbortSignal, generate: typeof ai.generate = ai.generate) {
  const unit = db.select().from(s.units).where(eq(s.units.id, unitId)).get();
  if (!unit) badRequest('대사가 없습니다.');
  const project = db.select().from(s.projects).where(eq(s.projects.id, unit.projectId)).get()!;
  const settings = editorAiSchema.parse(project.editorAi ?? {});
  const refine = request.mode === 'refine';
  const config = editorNodeConfig(settings, request.mode);
  if (!config.model.model) badRequest('설정 › 에디터에서 AI 번역·다듬기 모델을 고르세요.');
  if (refine && !request.draft.trim()) badRequest('다듬을 번역이 없습니다.');
  const { snapshot, target } = liveChoice(db, config.model, secrets, 'generate');

  // The context cap follows the button's model window (auto), like an AI node's. The draft in the editor is the line's working text.
  const node = resolvedNode(db, { id: 'editor', type: 'ai', position: { x: 0, y: 0 }, config });
  const { system, prompt, schema } = buildRequest(db, unit.projectId, node, 'lines', [{ id: unit.id, candidate: request.draft || undefined }]);
  const label = `편집기 ${refine ? '다듬기' : 'AI 번역'}`;
  const call = { projectId: unit.projectId, kind: 'editor' as const, refId: unitId, label, request: `${system}\n\n---\n\n${prompt}` };
  const result = await ai
    .callOnce(() => logged(db, call, target, () => generate(target, { system, prompt, schema, maxOutputTokens: snapshot.maxOutputTokens, timeoutMs: settings.timeoutSeconds * 1000, signal })), signal)
    .catch((error: unknown) => {
      if (error instanceof ai.ModelError && error.code === 'rate-limit') limited('모델 요청 한도에 걸렸습니다. 잠시 뒤 다시.', 60);
      throw error;
    });
  // A text answer or a json one with a "text" field (AI 다듬기's), its "changes" if it has them.
  const entry = (result.object as { results?: ({ id: string; text?: unknown; changes?: unknown } & Record<string, unknown>)[] }).results?.find((item) => item.id === promptLineId(0));
  const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
  if (!text) badRequest('모델이 번역을 돌려주지 않았습니다. 다시 해 보세요.');
  // Whitespace alone is not a change worth a candidate.
  if (refine && text.replace(/\s+/g, ' ') === request.draft.trim().replace(/\s+/g, ' ')) return { unchanged: true as const };
  // An AI 제안 the same as the line's translation would only be a mark with nothing to decide.
  if (request.suggest && text.replace(/\s+/g, ' ') === (unit.translation ?? '').trim().replace(/\s+/g, ' ')) return { unchanged: true as const };
  const changes = Array.isArray(entry?.changes) ? (entry.changes as { kind?: unknown; why?: unknown }[]) : [];
  const reasons = changes.flatMap((change) => (typeof change.why === 'string' && change.why.trim() ? [`${KIND_LABELS[String(change.kind)] ?? '표현'} · ${change.why.trim()}`] : []));
  const note = refine ? ['다듬기', ...reasons].join(' — ') : 'AI 번역';
  // `suggest` (the line's pane): it waits as the line's AI 제안 (적용 · 거절) instead of going into an open box.
  const candidateId = addCandidate(db, { unitId, text, origin: 'ai', model: target.model, note, ...(request.suggest && { state: 'pending' as const }) });
  return { candidateId, text, reasons };
}
