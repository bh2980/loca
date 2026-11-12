import { TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import { ModelError, toModelError } from './errors.ts';
import type { AskRequest, AskResult, ModelTarget } from './types.ts';

const client = (target: Pick<ModelTarget, 'apiKey' | 'baseUrl'>) => {
  if (!target.apiKey) throw new ModelError('auth', 'TypeSafe API 키가 필요합니다.', false);
  // The SDK adds /v1 itself; a saved "https://api.typesafe.ai/v1" would become /v1/v1 and 404.
  return new TypeSafeClient({ apiKey: target.apiKey, baseURL: target.baseUrl?.trim().replace(/\/v1\/?$/, '') || undefined, retry: { maxRetries: 0 }, logLevel: 'off' });
};

/**
 * Several typed questions about one state in a single request (System One answers them in
 * parallel): yes/no, a choice between labels, or a score on a rubric. Answers carry probabilities;
 * they are judgments, not verified facts.
 */
export async function systemOneAsk(target: ModelTarget, request: AskRequest): Promise<AskResult> {
  try {
    const result = await client(target).systemOne(
      { model: target.model, state: request.state as never, questions: request.questions as unknown as Questions },
      { timeout: request.timeoutMs, signal: request.signal },
    );
    const answers = Object.fromEntries(
      Object.entries(result.answers as Record<string, { type: string; noul?: number; choice?: string; score?: number; confidence?: number; probabilities?: Record<string, number> }>).map(([name, answer]) => [
        name,
        answer.type === 'noul'
          ? { type: 'noul' as const, yes: answer.noul ?? 0 }
          : answer.type === 'choice'
            ? { type: 'choice' as const, choice: answer.choice ?? '', confidence: answer.confidence ?? 0, probabilities: answer.probabilities ?? {} }
            : { type: 'score' as const, score: answer.score ?? 0, confidence: answer.confidence ?? 0, probabilities: answer.probabilities ?? {} },
      ]),
    );
    return { answers, usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens } };
  } catch (error) {
    throw toModelError(error, request.signal);
  }
}

export async function systemOneModels(target: Pick<ModelTarget, 'apiKey' | 'baseUrl'>): Promise<string[]> {
  try {
    return (await client(target).models.list({ timeout: 15_000 })).map((model) => model.name);
  } catch (error) {
    throw toModelError(error);
  }
}
