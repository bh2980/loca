import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { toModelError } from './errors.ts';

const apiError = (statusCode: number, message: string, responseBody?: string) => new APICallError({ message, url: 'http://x', requestBodyValues: {}, statusCode, responseBody, isRetryable: false });

describe('toModelError', () => {
  it('tells a request longer than the context window from other rejected requests', () => {
    expect(toModelError(apiError(400, 'Bad Request', JSON.stringify({ error: { message: "This model's maximum context length is 128000 tokens." } }))).code).toBe('too-long');
    expect(toModelError(apiError(413, 'Payload Too Large')).code).toBe('too-long');
    expect(toModelError(apiError(400, 'Invalid schema')).code).toBe('config');
    expect(toModelError(new Error('prompt is too long: 220000 tokens > 200000 maximum')).code).toBe('too-long');
    expect(toModelError(new Error('socket hang up')).code).toBe('unknown');
  });

  it('keeps a token rate limit a rate limit', () => {
    expect(toModelError(apiError(429, 'Rate limit reached for tokens per min')).code).toBe('rate-limit');
  });
});
