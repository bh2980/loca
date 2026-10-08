import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import { ModelError, toModelError } from './errors.ts';
import type { JudgeRequest, JudgeResult, ResolvedRoute } from './types.ts';

const client = (route: Pick<ResolvedRoute, 'apiKey' | 'baseUrl'>) => {
  if (!route.apiKey) throw new ModelError('auth', 'TypeSafe API 키가 필요합니다.', false);
  return new TypeSafeClient({ apiKey: route.apiKey, baseURL: route.baseUrl, retry: { maxRetries: 0 }, logLevel: 'off' });
};

/** System One answers typed questions; a review becomes a single pass/fail choice. */
export async function systemOneJudge(route: ResolvedRoute, request: JudgeRequest): Promise<JudgeResult> {
  try {
    const result = await client(route).systemOne(
      {
        model: route.model,
        state: request.state as never,
        questions: {
          verdict: choice(request.instructions, {
            pass: '번역이 원문의 의미·문맥·말투·용어를 지키며 그대로 써도 된다.',
            fail: '수정이 필요한 문제가 있다.',
          }),
        },
      },
      { timeout: request.timeoutMs, signal: request.signal },
    );
    const verdict = result.answers.verdict;
    return {
      passed: verdict.choice === 'pass',
      confidence: verdict.confidence,
      usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
    };
  } catch (error) {
    throw toModelError(error, request.signal);
  }
}

export async function systemOneModels(route: Pick<ResolvedRoute, 'apiKey' | 'baseUrl'>): Promise<string[]> {
  try {
    return (await client(route).models.list({ timeout: 15_000 })).map((model) => model.name);
  } catch (error) {
    throw toModelError(error);
  }
}
