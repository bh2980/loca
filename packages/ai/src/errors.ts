import { APICallError } from 'ai';
import { APIConnectionError, APIError } from '@typesafe-ai/sdk';

export type ModelErrorCode =
  | 'auth'
  | 'config'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'invalid-output'
  | 'cli'
  | 'unknown';

/** Only transient failures are retried or sent to a fallback route; everything else surfaces as is. */
export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
    readonly transient = code === 'rate-limit' || code === 'network' || code === 'timeout',
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export function toModelError(error: unknown, signal?: AbortSignal): ModelError {
  if (error instanceof ModelError) return error;
  if (signal?.aborted) return new ModelError('cancelled', '작업이 취소되었습니다.');
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    if (status === 401 || status === 403) return new ModelError('auth', `인증에 실패했습니다 (HTTP ${status}). API 키를 확인하세요.`);
    if (status === 429) return new ModelError('rate-limit', '요청 한도에 도달했습니다 (HTTP 429).');
    if (status >= 500 || status === 408) return new ModelError('network', `서버 오류 (HTTP ${status}).`);
    if (status) return new ModelError('config', `요청이 거부되었습니다 (HTTP ${status}). 모델·설정을 확인하세요.`);
    return new ModelError('network', 'API 서버에 연결하지 못했습니다.');
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) return new ModelError('auth', 'TypeSafe 인증에 실패했습니다. API 키를 확인하세요.');
    if (error.status === 429) return new ModelError('rate-limit', 'TypeSafe 요청 한도에 도달했습니다.');
    if (error.status >= 500) return new ModelError('network', `TypeSafe 서버 오류 (HTTP ${error.status}).`);
    return new ModelError('config', `TypeSafe 요청이 거부되었습니다 (HTTP ${error.status}).`);
  }
  if (error instanceof APIConnectionError) return new ModelError('network', 'TypeSafe 서버에 연결하지 못했습니다.');
  if (error instanceof Error && error.name === 'TimeoutError') return new ModelError('timeout', '제한 시간을 초과했습니다.');
  if (error instanceof Error && error.name === 'AbortError') return new ModelError('cancelled', '작업이 취소되었습니다.');
  return new ModelError('unknown', error instanceof Error ? error.message : String(error));
}
