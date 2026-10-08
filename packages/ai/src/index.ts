import pRetry from 'p-retry';
import type { LanguageModel } from 'ai';
import { CONNECTION_KIND_INFO } from '@tw/shared';
import { cliGenerate, cliVersion } from './cli.ts';
import { ModelError, toModelError } from './errors.ts';
import { openaiChatModel, openaiGenerate, openaiModels } from './openai.ts';
import { systemOneJudge, systemOneModels } from './systemone.ts';
import type { GenerateRequest, GenerateResult, JudgeRequest, JudgeResult, ResolvedRoute } from './types.ts';

export * from './types.ts';
export { ModelError } from './errors.ts';
export { cliLoginStatus, cliVersion, openLoginTerminal, LOGIN_COMMANDS } from './cli.ts';
export { openaiProviderOptions } from './openai.ts';

export function generate<T>(route: ResolvedRoute, request: GenerateRequest<T>): Promise<GenerateResult<T>> {
  if (route.kind === 'openai') return openaiGenerate(route, request);
  if (route.kind === 'systemone') throw new ModelError('config', 'System One은 판정(검수)에만 사용할 수 있습니다.', false);
  return cliGenerate(route, request);
}

export function judge(route: ResolvedRoute, request: JudgeRequest): Promise<JudgeResult> {
  if (route.kind !== 'systemone') throw new ModelError('config', '판정 전용 연결이 아닙니다.', false);
  return systemOneJudge(route, request);
}

export function chatModel(route: ResolvedRoute): LanguageModel {
  if (!CONNECTION_KIND_INFO[route.kind].capabilities.includes('chat'))
    throw new ModelError('config', '이 연결은 채팅(도구 호출)을 지원하지 않습니다.', false);
  return openaiChatModel(route);
}

/** Model ids the connection can serve. CLIs do not expose a reliable list, so the user types the id. */
export async function listModels(route: Omit<ResolvedRoute, 'model'>): Promise<string[] | null> {
  if (route.kind === 'openai') return openaiModels(route);
  if (route.kind === 'systemone') return systemOneModels(route);
  return null;
}

/** Cheap reachability check: API → model list, CLI → `--version`. */
export async function probe(route: Omit<ResolvedRoute, 'model'>): Promise<string> {
  if (route.kind === 'openai' || route.kind === 'systemone') {
    const models = await listModels(route);
    return `모델 ${models?.length ?? 0}개를 확인했습니다.`;
  }
  return `CLI ${await cliVersion(route.kind, route.executable)}`;
}

export interface Attempt {
  route: number;
  model: string;
  ok: boolean;
  error?: string;
  code?: string;
}

/**
 * Try the primary route, then each fallback in order. A route is retried with backoff only on
 * transient failures (rate limit, network, timeout); anything else stops immediately.
 */
export async function withFallback<R>(
  routes: ResolvedRoute[],
  maxAttempts: number,
  call: (route: ResolvedRoute) => Promise<R>,
  signal?: AbortSignal,
): Promise<{ result: R; route: ResolvedRoute; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  let last: ModelError | undefined;
  for (const [index, route] of routes.entries()) {
    try {
      const result = await pRetry(() => call(route), {
        retries: maxAttempts - 1,
        minTimeout: 1000,
        maxTimeout: 15_000,
        signal,
        shouldRetry: ({ error }) => toModelError(error, signal).transient,
        onFailedAttempt: ({ error }) => {
          const failure = toModelError(error, signal);
          attempts.push({ route: index, model: route.model, ok: false, error: failure.message, code: failure.code });
        },
      });
      attempts.push({ route: index, model: route.model, ok: true });
      return { result, route, attempts };
    } catch (error) {
      last = toModelError(error, signal);
      if (!last.transient) break;
    }
  }
  throw Object.assign(last ?? new ModelError('config', '사용할 AI 경로가 없습니다.', false), { attempts });
}
