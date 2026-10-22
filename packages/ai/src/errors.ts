import { APICallError, NoObjectGeneratedError, type LanguageModelUsage } from 'ai';
import { APIConnectionError, APIError } from '@typesafe-ai/sdk';
import type { Usage } from './types.ts';

export type ModelErrorCode =
  | 'auth'
  | 'config'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'invalid-output'
  /** The request is longer than the model's context window: send less (split the batch or part). */
  | 'too-long'
  | 'cli'
  | 'unknown';

/** A failed call. Nothing here retries it or tries another route; `transient` only says whether trying again later could work (a workflow's 재요청 node decides). */
export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
    readonly transient = code === 'rate-limit' || code === 'network' || code === 'timeout',
    /** What the call used before it failed, when the connection reported it. */
    readonly usage?: Usage,
    /** What the call printed before it failed (raw CLI output or the partial text), kept for the run record. */
    readonly output?: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/** How providers and CLIs word a request that does not fit the model's context window. */
export const TOO_LONG = /context(_| )?(length|window)|maximum context|prompt is too long|input is too long|too many (input )?tokens|exceeds? (the )?(model'?s? )?(max(imum)?|context)|request (entity )?too large/i;
const tooLong = (message: string) => new ModelError('too-long', `요청이 모델의 문맥 창보다 깁니다. ${message}`.slice(0, 400), false);

const OUTPUT_KEPT = 200_000;
/** The tail of what a failed call printed (the end is where it stopped), or undefined when it printed nothing. */
export const keepOutput = (...parts: (string | undefined)[]) => parts.filter((part) => part?.trim()).join('\n').slice(-OUTPUT_KEPT) || undefined;

/** The same error carrying `output`, for failures raised where the output was not at hand. */
export const withOutput = (error: ModelError, ...parts: (string | undefined)[]) =>
  error.output ? error : new ModelError(error.code, error.message, error.transient, error.usage, keepOutput(...parts));

/** AI SDK 7 `LanguageModelUsage` → `Usage`. */
export function readAiSdkUsage(usage: LanguageModelUsage | undefined): Usage {
  const result: Usage = {
    inputTokens: usage?.inputTokens,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens,
    outputTokens: usage?.outputTokens,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
  };
  for (const key of Object.keys(result) as (keyof Usage)[]) if (result[key] === undefined) delete result[key];
  return result;
}

export function toModelError(error: unknown, signal?: AbortSignal): ModelError {
  if (error instanceof ModelError) return error;
  if (signal?.aborted) return new ModelError('cancelled', '작업이 취소되었습니다.');
  if (NoObjectGeneratedError.isInstance(error)) {
    const usage = readAiSdkUsage(error.usage);
    return new ModelError('invalid-output', `모델이 형식에 맞는 결과를 만들지 못했습니다 (finishReason: ${error.finishReason ?? 'unknown'}). ${error.message}`.slice(0, 400), false, usage, keepOutput(error.text));
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    // What the provider said, when it said something: a 403 is not always the key (a model limited to some apps, a region).
    const said = providerMessage(error.responseBody);
    const detail = said ? ` 제공자: “${said}”` : '';
    if (status === 401) return new ModelError('auth', `인증에 실패했습니다 (HTTP 401). API 키를 확인하세요.${detail}`);
    if (status === 403) return new ModelError('auth', said ? `요청이 거부되었습니다 (HTTP 403).${detail}` : '인증에 실패했습니다 (HTTP 403). API 키를 확인하세요.');
    if (status === 429) return new ModelError('rate-limit', '요청 한도에 도달했습니다 (HTTP 429).');
    if (status === 413 || ((status === 400 || status === 422) && TOO_LONG.test(`${error.message} ${error.responseBody ?? ''}`))) return tooLong(`(HTTP ${status})`);
    if (status >= 500 || status === 408) return new ModelError('network', `서버 오류 (HTTP ${status}).`);
    if (status) return new ModelError('config', `요청이 거부되었습니다 (HTTP ${status}). 모델·설정을 확인하세요.${detail}`);
    return new ModelError('network', 'API 서버에 연결하지 못했습니다.');
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) return new ModelError('auth', 'TypeSafe 인증에 실패했습니다. API 키를 확인하세요.');
    if (error.status === 429) return new ModelError('rate-limit', 'TypeSafe 요청 한도에 도달했습니다.');
    if (error.status === 413 || (error.status === 400 && TOO_LONG.test(error.message))) return tooLong(`(TypeSafe HTTP ${error.status})`);
    if (error.status >= 500) return new ModelError('network', `TypeSafe 서버 오류 (HTTP ${error.status}).`);
    return new ModelError('config', `TypeSafe 요청이 거부되었습니다 (HTTP ${error.status}).`);
  }
  if (error instanceof APIConnectionError) return new ModelError('network', 'TypeSafe 서버에 연결하지 못했습니다.');
  if (error instanceof Error && error.name === 'TimeoutError') return new ModelError('timeout', '제한 시간을 초과했습니다.');
  if (error instanceof Error && error.name === 'AbortError') return new ModelError('cancelled', '작업이 취소되었습니다.');
  const message = error instanceof Error ? error.message : String(error);
  if (TOO_LONG.test(message)) return tooLong(message);
  return new ModelError('unknown', message);
}

/** The error message in a provider's JSON error body ({"error":{"message":…}} or {"message":…}), shortened. */
function providerMessage(body: string | undefined) {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message);
    return typeof message === 'string' ? message.slice(0, 240) : '';
  } catch {
    return '';
  }
}
